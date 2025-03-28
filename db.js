const mysql = require("mysql2/promise");
const dotenv = require("dotenv");

dotenv.config();

const db = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "Santosh.12",
  database: process.env.DB_DATABASE || "betting",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

async function initDatabase() {
  try {
    await db.query(`
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

    await db.query(`
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

    await db.query(`
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

    await db.query(`
            CREATE TABLE IF NOT EXISTS transactions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                type ENUM('bet', 'win', 'deposit', 'withdraw') NOT NULL,
                amount INT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        `);

    await db.query(`
            CREATE TABLE IF NOT EXISTS admin_controls (
                id INT PRIMARY KEY AUTO_INCREMENT,
                winning_number INT NOT NULL,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

    await db.query(`
            CREATE TABLE IF NOT EXISTS admin_logs (
                id INT PRIMARY KEY AUTO_INCREMENT,
                admin_id INT,
                action ENUM('set_winning_number', 'end_game_session', 'host_game_session') NOT NULL,
                details TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (admin_id) REFERENCES users(id)
            )
        `);

    await db.query(`
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

    await db.query(`
            CREATE TABLE IF NOT EXISTS coin_withdrawal_requests (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                amount DECIMAL(10,2) NOT NULL,
                withdrawal_method ENUM('upi', 'bank') NOT NULL,
                account_details TEXT NOT NULL,
                status ENUM('pending', 'processing', 'completed', 'rejected') DEFAULT 'pending',
                request_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                upi_id VARCHAR(255) NULL,
                bank_account_number VARCHAR(255) NULL,
                bank_ifsc VARCHAR(20) NULL,
                bank_account_holder VARCHAR(255) NULL,
                withdrawal_status ENUM('pending', 'processing', 'completed', 'rejected') DEFAULT 'pending',
                processed_at TIMESTAMP NULL,
                rejection_reason TEXT NULL,
                transaction_id VARCHAR(255) NULL,
                admin_notes TEXT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        `);

    await db.query(`CREATE TABLE IF NOT EXISTS coin_addition_requests_backup (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    reason TEXT,
    status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
    request_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    backup_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
)`);

    await db.query(`CREATE TABLE IF NOT EXISTS coin_withdrawal_requests_backup (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    withdrawal_method VARCHAR(50) NOT NULL,
    account_details TEXT NOT NULL,
    status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
    request_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    backup_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
)`);

    // Verify table existence and structure
    await verifyDatabase();

    console.log("Database initialized or already exists.");
  } catch (error) {
    console.error("Database initialization failed:", error);
  }
}

// Add a verification function to check critical tables and structure
async function verifyDatabase() {
  try {
    // Check if coin request tables exist
    const [tables] = await db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = DATABASE() 
      AND table_name IN ('coin_addition_requests', 'coin_withdrawal_requests')
    `);

    if (tables.length < 2) {
      console.warn(
        "Missing coin request tables. Found:",
        tables.map((t) => t.table_name).join(", ")
      );
    }

    // Verify column types for amount
    const [additionColumns] = await db.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = DATABASE() 
      AND table_name = 'coin_addition_requests' 
      AND column_name = 'amount'
    `);

    if (additionColumns.length > 0 && additionColumns[0].data_type === "int") {
      console.log(
        "Converting coin_addition_requests.amount from INT to DECIMAL(10,2)"
      );
      await db.query(
        `ALTER TABLE coin_addition_requests MODIFY amount DECIMAL(10,2) NOT NULL`
      );
    }

    const [withdrawalColumns] = await db.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = DATABASE() 
      AND table_name = 'coin_withdrawal_requests' 
      AND column_name = 'amount'
    `);

    if (
      withdrawalColumns.length > 0 &&
      withdrawalColumns[0].data_type === "int"
    ) {
      console.log(
        "Converting coin_withdrawal_requests.amount from INT to DECIMAL(10,2)"
      );
      await db.query(
        `ALTER TABLE coin_withdrawal_requests MODIFY amount DECIMAL(10,2) NOT NULL`
      );
    }
  } catch (error) {
    console.error("Database verification failed:", error);
  }
}

// Function to repair coin request tables - call this when experiencing issues
async function repairCoinRequestTables() {
  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    console.log("Starting coin request tables repair...");

    // 1. Check if tables exist and create them if not
    const [tables] = await connection.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = DATABASE() 
      AND table_name IN ('coin_addition_requests', 'coin_withdrawal_requests')
    `);

    const tableNames = tables.map((t) => t.table_name);

    if (!tableNames.includes("coin_addition_requests")) {
      console.log("Creating missing coin_addition_requests table");
      await connection.query(`
        CREATE TABLE coin_addition_requests (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          amount DECIMAL(10,2) NOT NULL,
          reason TEXT,
          status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
          request_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id)
        )
      `);
    }

    if (!tableNames.includes("coin_withdrawal_requests")) {
      console.log("Creating missing coin_withdrawal_requests table");
      await connection.query(`
        CREATE TABLE coin_withdrawal_requests (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          amount DECIMAL(10,2) NOT NULL,
          withdrawal_method ENUM('upi', 'bank') NOT NULL,
          account_details TEXT NOT NULL,
          status ENUM('pending', 'processing', 'completed', 'rejected') DEFAULT 'pending',
          request_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          upi_id VARCHAR(255) NULL,
          bank_account_number VARCHAR(255) NULL,
          bank_ifsc VARCHAR(20) NULL,
          bank_account_holder VARCHAR(255) NULL,
          withdrawal_status ENUM('pending', 'processing', 'completed', 'rejected') DEFAULT 'pending',
          processed_at TIMESTAMP NULL,
          rejection_reason TEXT NULL,
          transaction_id VARCHAR(255) NULL,
          admin_notes TEXT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id)
        )
      `);
    }

    // 2. Ensure amount columns are DECIMAL
    await connection.query(`
      ALTER TABLE coin_addition_requests 
      MODIFY COLUMN amount DECIMAL(10,2) NOT NULL
    `);

    await connection.query(`
      ALTER TABLE coin_withdrawal_requests 
      MODIFY COLUMN amount DECIMAL(10,2) NOT NULL
    `);

    // 3. Get max IDs from both tables
    const [[addMaxResult]] = await connection.query(`
      SELECT COALESCE(MAX(id), 0) as max_id FROM coin_addition_requests
    `);

    const [[withdrawMaxResult]] = await connection.query(`
      SELECT COALESCE(MAX(id), 0) as max_id FROM coin_withdrawal_requests
    `);

    const addMaxId = addMaxResult.max_id;
    const withdrawMaxId = withdrawMaxResult.max_id;
    const maxId = Math.max(addMaxId, withdrawMaxId, 0);

    console.log(
      `Current max IDs - Addition: ${addMaxId}, Withdrawal: ${withdrawMaxId}`
    );

    // 4. Reset auto-increment to ensure consistency
    await connection.query(`
      ALTER TABLE coin_addition_requests AUTO_INCREMENT = ${maxId + 1}
    `);

    await connection.query(`
      ALTER TABLE coin_withdrawal_requests AUTO_INCREMENT = ${maxId + 1}
    `);

    // 5. Reset pending status for any issues with specific IDs
    for (let id of [3, 4]) {
      // Check if these IDs exist and update them if needed
      const [addRequests] = await connection.query(
        `SELECT id, status FROM coin_addition_requests WHERE id = ?`,
        [id]
      );

      if (addRequests.length > 0 && addRequests[0].status !== "pending") {
        console.log(
          `Resetting status for addition request ID ${id} to pending`
        );
        await connection.query(
          `UPDATE coin_addition_requests SET status = 'pending' WHERE id = ?`,
          [id]
        );
      }

      const [withdrawRequests] = await connection.query(
        `SELECT id, status FROM coin_withdrawal_requests WHERE id = ?`,
        [id]
      );

      if (
        withdrawRequests.length > 0 &&
        withdrawRequests[0].status !== "pending"
      ) {
        console.log(
          `Resetting status for withdrawal request ID ${id} to pending`
        );
        await connection.query(
          `UPDATE coin_withdrawal_requests SET status = 'pending' WHERE id = ?`,
          [id]
        );
      }
    }

    await connection.commit();
    console.log("Coin request tables repaired successfully!");

    return {
      success: true,
      message: "Coin request tables repaired successfully",
      details: {
        additionMaxId: addMaxId,
        withdrawalMaxId: withdrawMaxId,
        newAutoIncrement: maxId + 1,
      },
    };
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Error repairing coin request tables:", error);
    return {
      success: false,
      error: error.message,
    };
  } finally {
    if (connection) connection.release();
  }
}

module.exports = {
  db,
  initDatabase,
  repairCoinRequestTables,
};
