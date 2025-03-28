// seedAdmin.js
const mysql = require('mysql2/promise'); // Use promise-based mysql
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');

dotenv.config();

async function seedAdminUser() {
    const dbConfig = {
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || 'Santosh.12',
        database: process.env.DB_DATABASE || 'betting',
    };

    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);

        const adminEmail = 'admin@gmail.com'; // Set your desired admin email
        const adminPassword = 'Admin123'; // Set a strong initial admin password
        const adminUsername = 'Admin';

        const hashedPassword = await bcrypt.hash(adminPassword, 10);

        // Check if an admin user already exists
        const [existingAdmin] = await connection.execute('SELECT * FROM users WHERE role = "admin" LIMIT 1');
        if (existingAdmin.length > 0) {
            console.log('Admin user already exists. Skipping seeding.');
            return;
        }

        const [result] = await connection.execute(
            'INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)',
            [adminUsername, adminEmail, hashedPassword, 'admin']
        );

        console.log('Admin user created successfully:', {
            id: result.insertId,
            username: adminUsername,
            email: adminEmail,
            role: 'admin'
        });

    } catch (error) {
        console.error('Error seeding admin user:', error);
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}

seedAdminUser();