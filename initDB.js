// initDB.js - Complete database initialization script for betting platform
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const dotenv = require("dotenv");

dotenv.config();

// Database connection configuration
const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "Santosh.12",
};

const dbName = process.env.DB_DATABASE || "betting";

async function initializeDatabase() {
  let connection;
  let dbConnection;

  try {
    console.log("Starting database initialization...");

    // Connect to MySQL server without database selection
    connection = await mysql.createConnection({
      host: dbConfig.host,
      user: dbConfig.user,
      password: dbConfig.password,
    });

    // Create database if it doesn't exist
    console.log(`Creating database '${dbName}' if it doesn't exist...`);
    await connection.query(`CREATE DATABASE IF NOT EXISTS ${dbName}`);

    // Close initial connection
    await connection.end();

    // Connect to the newly created database
    dbConnection = await mysql.createConnection({
      ...dbConfig,
      database: dbName,
    });

    // Create database tables
    console.log("Creating tables...");

    // 1. Users table
    console.log("Creating users table...");
    await dbConnection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT PRIMARY KEY AUTO_INCREMENT,
        username VARCHAR(255) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        wallet_balance DECIMAL(10,2) DEFAULT 100.00,
        role ENUM('user', 'admin') DEFAULT 'user',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. Game Sessions table
    console.log("Creating game_sessions table...");
    await dbConnection.query(`
      CREATE TABLE IF NOT EXISTS game_sessions (
        id INT PRIMARY KEY AUTO_INCREMENT,
        start_time DATETIME NOT NULL,
        end_time DATETIME NOT NULL,
        status ENUM('active', 'ended') DEFAULT 'active',
        winning_number INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        game_name VARCHAR(255) NULL,
        betting_time_window INT NULL
      )
    `);

    // 3. Games table
    console.log("Creating games table...");
    await dbConnection.query(`
      CREATE TABLE IF NOT EXISTS games (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT,
        selected_number INT NOT NULL,
        bet_amount DECIMAL(10,2) NOT NULL,
        winning_number INT NULL,
        result ENUM('win', 'lose') NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        game_session_id INT NULL,
        bet_group_id VARCHAR(255) NULL,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (game_session_id) REFERENCES game_sessions(id)
      )
    `);

    // 4. Transactions table
    console.log("Creating transactions table...");
    await dbConnection.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        type ENUM('bet', 'win', 'deposit', 'withdraw', 'purchase') NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        game_session_id INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (game_session_id) REFERENCES game_sessions(id)
      )
    `);

    // 5. Admin Controls table
    console.log("Creating admin_controls table...");
    await dbConnection.query(`
      CREATE TABLE IF NOT EXISTS admin_controls (
        id INT PRIMARY KEY AUTO_INCREMENT,
        winning_number INT NOT NULL,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 6. Admin Logs table
    console.log("Creating admin_logs table...");
    await dbConnection.query(`
      CREATE TABLE IF NOT EXISTS admin_logs (
        id INT PRIMARY KEY AUTO_INCREMENT,
        admin_id INT,
        action ENUM('set_winning_number', 'end_game_session', 'host_game_session', 
                   'approve_addition_request', 'reject_addition_request', 
                   'approve_withdrawal_request', 'reject_withdrawal_request',
                   'repair_coin_requests') NOT NULL,
        details TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (admin_id) REFERENCES users(id)
      )
    `);

    // 7. Coin Addition Requests table
    console.log("Creating coin_addition_requests table...");
    await dbConnection.query(`
      CREATE TABLE IF NOT EXISTS coin_addition_requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        reason TEXT,
        status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
        request_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    // 8. Coin Withdrawal Requests table
    console.log("Creating coin_withdrawal_requests table...");
    await dbConnection.query(`
      CREATE TABLE IF NOT EXISTS coin_withdrawal_requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        withdrawal_method VARCHAR(50) NOT NULL,
        account_details TEXT NOT NULL,
        status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
        request_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    // 9. Backup tables for coin requests
    console.log("Creating backup tables...");
    await dbConnection.query(`
      CREATE TABLE IF NOT EXISTS coin_addition_requests_backup (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        reason TEXT,
        status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
        request_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        backup_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    await dbConnection.query(`
      CREATE TABLE IF NOT EXISTS coin_withdrawal_requests_backup (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        withdrawal_method VARCHAR(50) NOT NULL,
        account_details TEXT NOT NULL,
        status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
        request_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        backup_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    // Create indexes for better performance
    console.log("Creating indexes for better performance...");
    await dbConnection.query(
      "CREATE INDEX idx_games_user_id ON games(user_id)"
    );
    await dbConnection.query(
      "CREATE INDEX idx_games_session_id ON games(game_session_id)"
    );
    await dbConnection.query(
      "CREATE INDEX idx_transactions_user_id ON transactions(user_id)"
    );
    await dbConnection.query(
      "CREATE INDEX idx_transactions_type ON transactions(type)"
    );
    await dbConnection.query(
      "CREATE INDEX idx_sessions_status ON game_sessions(status)"
    );

    // Seed admin user
    await seedAdminUser(dbConnection);

    console.log("Database initialization completed successfully!");
  } catch (error) {
    console.error("Error initializing database:", error);
    throw error;
  } finally {
    if (connection) await connection.end();
    if (dbConnection) await dbConnection.end();
  }
}

async function seedAdminUser(dbConnection) {
  try {
    console.log("Checking if admin user already exists...");
    const [existingAdmin] = await dbConnection.execute(
      'SELECT * FROM users WHERE role = "admin" LIMIT 1'
    );

    if (existingAdmin.length > 0) {
      console.log("Admin user already exists. Skipping admin creation.");
      return;
    }

    console.log("Creating admin user...");
    const adminEmail = "admin@gmail.com";
    const adminPassword = "Admin123";
    const adminUsername = "Admin";

    const hashedPassword = await bcrypt.hash(adminPassword, 10);

    const [result] = await dbConnection.execute(
      "INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)",
      [adminUsername, adminEmail, hashedPassword, "admin"]
    );

    console.log("Admin user created successfully:", {
      id: result.insertId,
      username: adminUsername,
      email: adminEmail,
      role: "admin",
    });

    console.log(
      "\n-----------------------------------------------------------"
    );
    console.log("ADMIN LOGIN CREDENTIALS (SAVE THESE):");
    console.log("-----------------------------------------------------------");
    console.log("Email:    ", adminEmail);
    console.log("Password: ", adminPassword);
    console.log(
      "-----------------------------------------------------------\n"
    );
  } catch (error) {
    console.error("Error seeding admin user:", error);
    throw error;
  }
}

// Verify database structure
async function verifyDatabase() {
  let connection;

  try {
    console.log("Verifying database structure...");

    connection = await mysql.createConnection({
      ...dbConfig,
      database: dbName,
    });

    // Check if all tables exist
    const requiredTables = [
      "users",
      "game_sessions",
      "games",
      "transactions",
      "admin_controls",
      "admin_logs",
      "coin_addition_requests",
      "coin_withdrawal_requests",
      "coin_addition_requests_backup",
      "coin_withdrawal_requests_backup",
    ];

    const [tables] = await connection.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = DATABASE() 
    `);

    const existingTables = tables.map((t) => t.TABLE_NAME || t.table_name);

    const missingTables = requiredTables.filter(
      (table) => !existingTables.includes(table)
    );

    if (missingTables.length > 0) {
      console.warn("WARNING: Missing tables:", missingTables.join(", "));
    } else {
      console.log("All required tables exist.");
    }

    // Verify column types for amount fields
    for (const table of [
      "coin_addition_requests",
      "coin_withdrawal_requests",
      "transactions",
    ]) {
      const [columns] = await connection.query(
        `
        SELECT column_name, data_type, column_type
        FROM information_schema.columns 
        WHERE table_schema = DATABASE() 
        AND table_name = ? 
        AND column_name = 'amount'
      `,
        [table]
      );

      if (columns.length > 0) {
        const columnInfo = columns[0];
        const dataType = columnInfo.DATA_TYPE || columnInfo.data_type;

        if (dataType === "int") {
          console.log(`Converting ${table}.amount from INT to DECIMAL(10,2)`);
          await connection.query(
            `ALTER TABLE ${table} MODIFY amount DECIMAL(10,2) NOT NULL`
          );
        } else {
          console.log(`${table}.amount has correct type: ${dataType}`);
        }
      }
    }

    console.log("Database verification completed!");
  } catch (error) {
    console.error("Error verifying database:", error);
    throw error;
  } finally {
    if (connection) await connection.end();
  }
}

// Run the initialization
(async () => {
  try {
    await initializeDatabase();
    await verifyDatabase();
    console.log("Database setup completed successfully.");
  } catch (error) {
    console.error("Database setup failed:", error);
    process.exit(1);
  }
})();
