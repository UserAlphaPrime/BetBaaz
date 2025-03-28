const express = require("express");
const path = require("path");
const dotenv = require("dotenv");
const rateLimit = require("express-rate-limit");
const ws = require("ws");
const cron = require("node-cron");

const userRoutes = require("./api/user-routes");
const adminRoutes = require("./api/admin-routes");
const { initDatabase, db } = require("./db");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const WS_PORT = process.env.WS_PORT || 7668;

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: "Too many requests from this IP, please try again after 15 minutes",
});
app.use("/api/", limiter);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

initDatabase();

const wss = new ws.Server({ port: WS_PORT });
const adminClients = new Set();
const userClients = new Map();

function handleWebSocketError(wsClient, role, userId) {
  console.error("WebSocket client error, closing connection");
  if (role === "admin") adminClients.delete(wsClient);
  else if (role === "user" && userId) userClients.delete(userId);
  wsClient.terminate();
}

wss.on("connection", (wsClient, req) => {
  const userId = req.headers["user-id"];
  const role = req.headers["role"];

  if (role === "admin") {
    adminClients.add(wsClient);
  } else if (role === "user" && userId) {
    userClients.set(userId, wsClient);
  } else {
    console.log(
      "Invalid WebSocket connection attempt: role=",
      role,
      "userId=",
      userId
    );
    wsClient.terminate();
    return;
  }

  wsClient.on("close", () => {
    if (role === "admin") adminClients.delete(wsClient);
    else if (role === "user" && userId) userClients.delete(userId);
    console.log(
      `WebSocket connection closed for role: ${role}, userId: ${
        userId || "N/A"
      }`
    );
  });

  wsClient.on("error", (error) => {
    console.error(
      `WebSocket error for role: ${role}, userId: ${userId || "N/A"}:`,
      error
    );
    handleWebSocketError(wsClient, role, userId);
  });
});

function broadcastBetToAdmins(betData) {
  const message = JSON.stringify({ type: "newBet", payload: betData });
  adminClients.forEach((client) => {
    if (client.readyState === ws.OPEN) {
      client.send(message, (error) => {
        if (error) console.error("WebSocket send error to admin:", error);
      });
    }
  });
}

function broadcastGameSessionUpdateToUsers(sessionId, updateType, payload) {
  const message = JSON.stringify({
    type: updateType,
    payload: { sessionId, ...payload },
  });
  console.log(
    `Broadcasting ${updateType} message for session ${sessionId}:`,
    payload
  );

  userClients.forEach((client) => {
    if (client.readyState === ws.OPEN) {
      client.send(message, (error) => {
        if (error) console.error("WebSocket send error to user:", error);
      });
    }
  });

  adminClients.forEach((client) => {
    if (client.readyState === ws.OPEN) {
      client.send(message, (error) => {
        if (error) console.error("WebSocket send error to admin:", error);
      });
    }
  });
}

function broadcastWalletUpdate(userId, balance) {
  // Send balance update to specific user
  const client = userClients.get(userId);
  if (client && client.readyState === ws.OPEN) {
    const message = JSON.stringify({
      type: "balanceUpdate",
      payload: { balance },
    });
    client.send(message, (error) => {
      if (error) console.error("WebSocket send error to user:", error);
    });
  }

  // Also broadcast to all admins
  const adminMessage = JSON.stringify({
    type: "userBalanceUpdate",
    payload: { userId, balance },
  });

  adminClients.forEach((client) => {
    if (client.readyState === ws.OPEN) {
      client.send(adminMessage, (error) => {
        if (error) console.error("WebSocket send error to admin:", error);
      });
    }
  });
}

// Add new function to broadcast coin requests updates to admins
function broadcastCoinRequestUpdate() {
  // Notify all admins about new coin request
  const adminMessage = JSON.stringify({
    type: "coinRequestsUpdate",
    payload: { updateTime: new Date().toISOString() },
  });

  adminClients.forEach((client) => {
    if (client.readyState === ws.OPEN) {
      client.send(adminMessage, (error) => {
        if (error) console.error("WebSocket send error to admin:", error);
      });
    }
  });
}

app.use(
  "/api",
  userRoutes(
    broadcastBetToAdmins,
    broadcastGameSessionUpdateToUsers,
    userClients,
    adminClients,
    broadcastWalletUpdate,
    broadcastCoinRequestUpdate
  )
);
app.use(
  "/api/admin",
  adminRoutes(
    broadcastBetToAdmins,
    broadcastGameSessionUpdateToUsers,
    userClients,
    adminClients,
    broadcastWalletUpdate,
    broadcastCoinRequestUpdate
  )
);

app.get("/", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html"))
);
app.get("/admin", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "admin.html"))
);

app.use("/api/*", (req, res) =>
  res.status(404).send({ error: "API endpoint not found" })
);

app.use((err, req, res, next) => {
  console.error("Global error handler caught an error:", err);
  res.status(500).send({
    error: "Something went wrong on the server",
    details: err.message,
  });
});

const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);

  const networkInterfaces = require("os").networkInterfaces();
  const addresses = [];

  Object.keys(networkInterfaces).forEach((interfaceName) => {
    networkInterfaces[interfaceName].forEach((interfaceInfo) => {
      if (!interfaceInfo.internal && interfaceInfo.family === "IPv4") {
        addresses.push(interfaceInfo.address);
      }
    });
  });

  if (addresses.length > 0) {
    console.log("\nAvailable on your network at:");
    addresses.forEach((address) => {
      console.log(`http://${address}:${PORT}`);
    });
  }

  console.log("\nPress Ctrl+C to stop the server");
});

server.on("upgrade", (request, socket, head) => {
  const params = new URLSearchParams(request.url.split("?")[1]);
  request.headers["user-id"] = params.get("userId");
  request.headers["role"] = params.get("role");

  wss.handleUpgrade(request, socket, head, (socket) => {
    wss.emit("connection", socket, request);
  });
});

cron.schedule("* * * * *", async () => {
  console.log("Running game session auto-end task");
  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [sessionsToEnd] = await connection.query(
      'SELECT id, game_name, winning_number FROM game_sessions WHERE status = "active" AND end_time <= NOW()'
    );

    if (sessionsToEnd && sessionsToEnd.length > 0) {
      for (const session of sessionsToEnd) {
        const sessionId = session.id;
        const winningNumber = session.winning_number;

        // Update session status to ended
        await connection.query(
          'UPDATE game_sessions SET status = "ended" WHERE id = ?',
          [sessionId]
        );

        await connection.query(
          "INSERT INTO admin_logs (admin_id, action, details) VALUES (?, ?, ?)",
          [
            null,
            "end_game_session",
            `Game session auto-ended: ${
              session.game_name || "Session ID " + sessionId
            }${
              winningNumber
                ? ", Winning number: " + winningNumber
                : " (no winning number set)"
            }`,
          ]
        );

        // If winning number is set, process the results
        if (winningNumber) {
          // Get all bets for this session that need payout processing
          const [gamesToPayout] = await connection.query(
            `
            SELECT g.*, u.wallet_balance, u.id as user_id, u.username
            FROM games g
            JOIN users u ON g.user_id = u.id
            WHERE g.game_session_id = ? AND g.result IS NULL
            FOR UPDATE OF u
            `,
            [sessionId]
          );

          let gameResultsForUsers = [];
          let winningsNotifications = [];
          let totalRevenue = 0;

          // Process each bet
          for (const game of gamesToPayout) {
            let result = "lose";
            let winAmount = 0;
            const selectedNumberStr = String(game.selected_number);
            const winningNumberStr = String(winningNumber);

            // Determine if bet is a win
            if (selectedNumberStr === winningNumberStr) {
              result = "win";
              const multiplier = selectedNumberStr.length === 1 ? 9 : 85;
              winAmount = game.bet_amount * multiplier;
              totalRevenue -= winAmount;

              // Update user's wallet balance
              await connection.query(
                "UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?",
                [winAmount, game.user_id]
              );

              // Record the win transaction
              await connection.query(
                "INSERT INTO transactions (user_id, type, amount, game_session_id) VALUES (?, ?, ?, ?)",
                [game.user_id, "win", winAmount, sessionId]
              );

              // Track winning notification for later
              winningsNotifications.push({
                userId: game.user_id,
                winAmount: winAmount,
              });
            }

            // Update the game record with result
            await connection.query(
              "UPDATE games SET result = ?, winning_number = ? WHERE id = ?",
              [result, winningNumber, game.id]
            );

            // Track this result for later notification
            gameResultsForUsers.push({
              userId: game.user_id,
              username: game.username,
              gameSessionId: sessionId,
              winningNumber: winningNumber,
              result: result,
              betAmount: game.bet_amount,
              selectedNumber: game.selected_number,
            });

            totalRevenue += game.bet_amount;
          }

          // Notify users about session ending and results
          broadcastGameSessionUpdateToUsers(sessionId, "gameSessionEnd", {
            sessionId,
            winningNumber: winningNumber,
            gameName: session.game_name || "Session ID " + sessionId,
          });

          // Send individual results to each affected user
          gameResultsForUsers.forEach((gameResult) => {
            const userWs = userClients.get(String(gameResult.userId));
            if (userWs && userWs.readyState === ws.OPEN) {
              const gameResultForUser = { ...gameResult };
              delete gameResultForUser.username;

              // Fetch all bets made by this user in this session
              db.query(
                "SELECT id, user_id, selected_number AS selectedNumber, bet_amount AS betAmount, result, winning_number AS winningNumber FROM games WHERE user_id = ? AND game_session_id = ?",
                [gameResult.userId, sessionId]
              )
                .then(([userBets]) => {
                  // Map the results to ensure proper camelCase property names
                  const formattedUserBets = userBets.map((bet) => ({
                    id: bet.id,
                    userId: bet.user_id,
                    selectedNumber: bet.selectedNumber,
                    betAmount: bet.betAmount,
                    result: bet.result,
                    winningNumber: bet.winningNumber,
                  }));

                  // Send game result with all user bets for the session
                  userWs.send(
                    JSON.stringify({
                      type: "gameResult",
                      payload: {
                        game: gameResultForUser,
                        userBets: formattedUserBets,
                      },
                    }),
                    (error) => {
                      if (error) {
                        console.error(
                          "WebSocket send error to user for game result:",
                          error
                        );
                      }
                    }
                  );
                })
                .catch((error) => {
                  console.error("Error fetching user bets:", error);
                  // Fall back to sending just the game result without all bets
                  userWs.send(
                    JSON.stringify({
                      type: "gameResult",
                      payload: { game: gameResultForUser },
                    }),
                    (error) => {
                      if (error) {
                        console.error(
                          "WebSocket send error to user for game result:",
                          error
                        );
                      }
                    }
                  );
                });
            }
          });

          // Send win notifications
          winningsNotifications.forEach(async (winNotification) => {
            const userWs = userClients.get(String(winNotification.userId));
            if (userWs && userWs.readyState === ws.OPEN) {
              userWs.send(
                JSON.stringify({
                  type: "winNotification",
                  payload: {
                    message: `You won ${winNotification.winAmount} Rs! Your winnings have been added to your wallet.`,
                  },
                }),
                (error) => {
                  if (error) {
                    console.error(
                      "WebSocket send error for win notification:",
                      error
                    );
                  }
                }
              );
            }

            // Fetch the user's updated wallet balance
            try {
              const [[userData]] = await connection.query(
                "SELECT wallet_balance FROM users WHERE id = ?",
                [winNotification.userId]
              );

              if (userData) {
                // Broadcast the updated wallet balance
                broadcastWalletUpdate(
                  winNotification.userId,
                  userData.wallet_balance
                );
              }
            } catch (error) {
              console.error("Error fetching user wallet balance:", error);
            }
          });
        } else {
          // No winning number set - just notify about session ending
          broadcastGameSessionUpdateToUsers(sessionId, "gameSessionEnd", {
            sessionId,
            winningNumber: null,
            gameName: session.game_name || "Session ID " + sessionId,
            message: `Session ${sessionId} (${
              session.game_name || ""
            }) has ended automatically with no winning number set.`,
          });
        }
      }

      // Broadcast updated active sessions list
      const [activeSessions] = await connection.query(
        'SELECT id, game_name, start_time, end_time, status, betting_time_window, winning_number FROM game_sessions WHERE status = "active" AND end_time > NOW()'
      );
      broadcastGameSessionUpdateToUsers(
        null,
        "activeSessionsUpdate",
        activeSessions
      );
    }
    await connection.commit();
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Error in auto-end game session task:", error);
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

module.exports = {
  app,
  server,
  broadcastBetToAdmins,
  broadcastGameSessionUpdateToUsers,
  userClients,
  adminClients,
  broadcastWalletUpdate,
  broadcastCoinRequestUpdate,
};
