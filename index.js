const {
  app,
  server,
  broadcastBetToAdmins,
  broadcastGameSessionUpdateToUsers,
  userClients,
  adminClients,
  broadcastWalletUpdate,
  broadcastCoinRequestUpdate,
} = require("./server");

app.use(
  "/api/user",
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
