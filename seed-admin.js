import { createClient } from '@libsql/client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
dotenv.config();

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const username = process.env.ADMIN_USERNAME || 'admin';
const password = process.env.ADMIN_PASSWORD || 'admin123';

// Delete any existing row with that username to avoid conflicts
await db.execute({ sql: 'DELETE FROM admins WHERE username = ?', args: [username] });

const hash = bcrypt.hashSync(password, 10);
await db.execute({
  sql: 'INSERT INTO admins (username, password_hash) VALUES (?, ?)',
  args: [username, hash],
});

console.log(`✔ Admin "${username}" inserted with password "${password}"`);
process.exit(0);
