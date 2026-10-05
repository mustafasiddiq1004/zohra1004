import { createClient } from '@libsql/client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

/* ---- Initialize Tables ---- */
async function initDb() {
  await db.batch([
    `CREATE TABLE IF NOT EXISTS posts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      title       TEXT,
      content     TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS likes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id     INTEGER NOT NULL,
      ip          TEXT NOT NULL,
      user_agent  TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(post_id, ip)
    )`,
    `CREATE TABLE IF NOT EXISTS visits (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      ip          TEXT NOT NULL,
      user_agent  TEXT,
      page        TEXT,
      referrer    TEXT,
      visited_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS admins (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_likes_post  ON likes(post_id)`,
    `CREATE INDEX IF NOT EXISTS idx_visits_time ON visits(visited_at)`,
  ]);

  /* ---- Seed default admin ---- */
  const adminCount = await db.execute('SELECT COUNT(*) AS c FROM admins');
  if (adminCount.rows[0].c === 0) {
    const username = process.env.ADMIN_USERNAME || 'admin';
    const password = process.env.ADMIN_PASSWORD || 'admin123';
    await db.execute({
      sql: 'INSERT INTO admins (username, password_hash) VALUES (?, ?)',
      args: [username, bcrypt.hashSync(password, 10)],
    });
    console.log(`✔ Admin created → username: ${username}`);
  }

  /* ---- Seed a welcome shayari ---- */
  const postCount = await db.execute('SELECT COUNT(*) AS c FROM posts');
  if (postCount.rows[0].c === 0) {
    await db.execute({
      sql: 'INSERT INTO posts (title, content) VALUES (?, ?)',
      args: [
        'خوش آمدید',
        'دل کی بات لبوں پر لا کر ہم نے سب کچھ کھو دیا\nتم سے کیا کہتے، اپنے آپ سے ہار گئے',
      ],
    });
  }
}

// Run initialization
initDb().catch(console.error);

export default db;