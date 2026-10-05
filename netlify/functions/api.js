import express from 'express';
import serverless from 'serverless-http';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import db from '../../db.js';

dotenv.config();

const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 }
}));

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  let ip = fwd ? fwd.split(',')[0].trim() : (req.socket.remoteAddress || req.ip || 'unknown');
  if (ip === '::1') ip = '127.0.0.1';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  return ip;
}

function requireAdmin(req, res, next) {
  if (req.session?.adminId) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

/* ------------------------------------------------------------------ */
/* PUBLIC API                                                          */
/* ------------------------------------------------------------------ */

app.get('/api/posts', async (req, res) => {
  const ip = getClientIp(req);
  const page   = Math.max(1, parseInt(req.query.page,  10) || 1);
  const limit  = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
  const offset = (page - 1) * limit;

  const totalResult = await db.execute('SELECT COUNT(*) AS c FROM posts');
  const total = totalResult.rows[0].c;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const result = await db.execute({
    sql: `
      SELECT p.id, p.title, p.content, p.created_at,
             (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
             EXISTS(SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.ip = ?) AS liked
      FROM posts p
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT ? OFFSET ?
    `,
    args: [ip, limit, offset]
  });

  res.json({
    posts: result.rows.map(r => ({ ...r, liked: !!r.liked })),
    pagination: {
      page, limit, total, totalPages,
      hasPrev: page > 1,
      hasNext: page < totalPages
    }
  });
});

app.post('/api/posts/:id/like', async (req, res) => {
  const postId = Number(req.params.id);
  const ip = getClientIp(req);

  const postResult = await db.execute({ sql: 'SELECT id FROM posts WHERE id = ?', args: [postId] });
  if (postResult.rows.length === 0) return res.status(404).json({ error: 'Post not found' });

  const existingResult = await db.execute({ sql: 'SELECT id FROM likes WHERE post_id = ? AND ip = ?', args: [postId, ip] });

  if (existingResult.rows.length > 0) {
    await db.execute({ sql: 'DELETE FROM likes WHERE id = ?', args: [existingResult.rows[0].id] });
  } else {
    await db.execute({
      sql: 'INSERT INTO likes (post_id, ip, user_agent) VALUES (?, ?, ?)',
      args: [postId, ip, req.headers['user-agent'] || '']
    });
  }

  const countResult = await db.execute({ sql: 'SELECT COUNT(*) AS c FROM likes WHERE post_id = ?', args: [postId] });
  res.json({ liked: existingResult.rows.length === 0, like_count: countResult.rows[0].c });
});

app.post('/api/track-visit', async (req, res) => {
  await db.execute({
    sql: 'INSERT INTO visits (ip, user_agent, page, referrer) VALUES (?, ?, ?, ?)',
    args: [getClientIp(req), req.headers['user-agent'] || '', req.body?.page || '/', req.body?.referrer || '']
  });
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* AUTH                                                                */
/* ------------------------------------------------------------------ */
app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body || {};
  const result = await db.execute({ sql: 'SELECT * FROM admins WHERE username = ?', args: [username] });
  const admin = result.rows[0];

  if (!admin || !bcrypt.compareSync(password || '', admin.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  req.session.adminId   = admin.id;
  req.session.adminUser = admin.username;
  res.json({ ok: true, username: admin.username });
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/admin/me', (req, res) => {
  if (req.session?.adminId) return res.json({ loggedIn: true, username: req.session.adminUser });
  res.json({ loggedIn: false });
});

/* ------------------------------------------------------------------ */
/* ADMIN — POSTS                                                       */
/* ------------------------------------------------------------------ */
app.get('/api/admin/posts', requireAdmin, async (req, res) => {
  const result = await db.execute(`
    SELECT p.*, (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count
    FROM posts p ORDER BY p.created_at DESC, p.id DESC
  `);
  res.json(result.rows);
});

app.post('/api/admin/posts', requireAdmin, async (req, res) => {
  const { title = '', content } = req.body || {};
  if (!content || !content.trim()) return res.status(400).json({ error: 'Content is required' });

  const result = await db.execute({
    sql: 'INSERT INTO posts (title, content) VALUES (?, ?)',
    args: [title.trim(), content.trim()]
  });
  const postResult = await db.execute({ sql: 'SELECT * FROM posts WHERE id = ?', args: [result.lastInsertRowid] });
  res.json(postResult.rows[0]);
});

app.put('/api/admin/posts/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { title = '', content } = req.body || {};
  if (!content || !content.trim()) return res.status(400).json({ error: 'Content is required' });

  const result = await db.execute({
    sql: "UPDATE posts SET title = ?, content = ?, updated_at = datetime('now') WHERE id = ?",
    args: [title.trim(), content.trim(), id]
  });
  if (result.rowsAffected === 0) return res.status(404).json({ error: 'Post not found' });
  const postResult = await db.execute({ sql: 'SELECT * FROM posts WHERE id = ?', args: [id] });
  res.json(postResult.rows[0]);
});

app.delete('/api/admin/posts/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  await db.batch([
    { sql: 'DELETE FROM likes WHERE post_id = ?', args: [id] },
    { sql: 'DELETE FROM posts WHERE id = ?', args: [id] }
  ]);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* ADMIN — ANALYTICS (IST-aware)                                       */
/* ------------------------------------------------------------------ */
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  const IST = "'+330 minutes'";
  const [totalPosts, totalLikes, totalVisits, uniqueVisitors, visitsToday, likesToday] = await Promise.all([
    db.execute('SELECT COUNT(*) c FROM posts'),
    db.execute('SELECT COUNT(*) c FROM likes'),
    db.execute('SELECT COUNT(*) c FROM visits'),
    db.execute('SELECT COUNT(DISTINCT ip) c FROM visits'),
    db.execute(`SELECT COUNT(*) c FROM visits WHERE date(visited_at, ${IST}) = date('now', ${IST})`),
    db.execute(`SELECT COUNT(*) c FROM likes WHERE date(created_at, ${IST}) = date('now', ${IST})`)
  ]);

  const raw = await db.execute(`
    SELECT date(visited_at, ${IST}) AS day, COUNT(*) AS count
    FROM visits WHERE visited_at >= datetime('now', '-7 days')
    GROUP BY day ORDER BY day
  `);

  const map = Object.fromEntries(raw.rows.map(r => [r.day, r.count]));
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    days.push({ day: key, count: map[key] || 0 });
  }

  const topPosts = await db.execute(`
    SELECT p.id, p.title, substr(p.content, 1, 50) AS excerpt, COUNT(l.id) AS like_count
    FROM posts p LEFT JOIN likes l ON l.post_id = p.id
    GROUP BY p.id ORDER BY like_count DESC LIMIT 5
  `);

  res.json({
    totalPosts: totalPosts.rows[0].c,
    totalLikes: totalLikes.rows[0].c,
    totalVisits: totalVisits.rows[0].c,
    uniqueVisitors: uniqueVisitors.rows[0].c,
    visitsToday: visitsToday.rows[0].c,
    likesToday: likesToday.rows[0].c,
    dailyVisits: days,
    topPosts: topPosts.rows
  });
});

app.get('/api/admin/likes', requireAdmin, async (req, res) => {
  const result = await db.execute(`
    SELECT l.id, l.post_id, l.ip, l.user_agent, l.created_at,
           p.title, substr(p.content, 1, 60) AS post_excerpt
    FROM likes l JOIN posts p ON p.id = l.post_id
    ORDER BY l.created_at DESC LIMIT 1000
  `);
  res.json(result.rows);
});

app.get('/api/admin/visits', requireAdmin, async (req, res) => {
  const result = await db.execute('SELECT * FROM visits ORDER BY visited_at DESC LIMIT 1000');
  res.json(result.rows);
});

/* ------------------------------------------------------------------ */
export const handler = serverless(app);