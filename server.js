import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app  = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', true);          // so req.ip works behind Render/Cloudflare
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 } // 8h
}));
app.use(express.static(path.join(__dirname, 'public')));

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

// All posts + like count + whether this visitor already liked
app.get('/api/posts', (req, res) => {
  const ip = getClientIp(req);
  const rows = db.prepare(`
    SELECT p.id, p.title, p.content, p.created_at,
           (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
           EXISTS(SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.ip = ?) AS liked
    FROM posts p
    ORDER BY p.created_at DESC, p.id DESC
  `).all(ip);

  res.json(rows.map(r => ({ ...r, liked: !!r.liked })));
});

// Toggle like
app.post('/api/posts/:id/like', (req, res) => {
  const postId = Number(req.params.id);
  const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(postId);
  if (!post) return res.status(404).json({ error: 'Post not found' });

  const ip = getClientIp(req);
  const existing = db.prepare('SELECT id FROM likes WHERE post_id = ? AND ip = ?')
                     .get(postId, ip);

  if (existing) {
    db.prepare('DELETE FROM likes WHERE id = ?').run(existing.id);
  } else {
    db.prepare('INSERT INTO likes (post_id, ip, user_agent) VALUES (?, ?, ?)')
      .run(postId, ip, req.headers['user-agent'] || '');
  }

  const count = db.prepare('SELECT COUNT(*) AS c FROM likes WHERE post_id = ?')
                  .get(postId).c;
  res.json({ liked: !existing, like_count: count });
});

// Track a page visit
app.post('/api/track-visit', (req, res) => {
  db.prepare('INSERT INTO visits (ip, user_agent, page, referrer) VALUES (?, ?, ?, ?)')
    .run(
      getClientIp(req),
      req.headers['user-agent'] || '',
      req.body?.page || '/',
      req.body?.referrer || ''
    );
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* AUTH                                                                */
/* ------------------------------------------------------------------ */

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body || {};
  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);

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

app.get('/api/admin/posts', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT p.*, (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count
    FROM posts p ORDER BY p.created_at DESC, p.id DESC
  `).all();
  res.json(rows);
});

app.post('/api/admin/posts', requireAdmin, (req, res) => {
  const { title = '', content } = req.body || {};
  if (!content || !content.trim()) return res.status(400).json({ error: 'Content is required' });

  const info = db.prepare('INSERT INTO posts (title, content) VALUES (?, ?)')
                 .run(title.trim(), content.trim());
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(info.lastInsertRowid);
  res.json(post);
});

app.put('/api/admin/posts/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { title = '', content } = req.body || {};
  if (!content || !content.trim()) return res.status(400).json({ error: 'Content is required' });

  const info = db.prepare(
    "UPDATE posts SET title = ?, content = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(title.trim(), content.trim(), id);

  if (info.changes === 0) return res.status(404).json({ error: 'Post not found' });
  res.json(db.prepare('SELECT * FROM posts WHERE id = ?').get(id));
});

app.delete('/api/admin/posts/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM likes WHERE post_id = ?').run(id);
  db.prepare('DELETE FROM posts WHERE id = ?').run(id);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* ADMIN — ANALYTICS                                                   */
/* ------------------------------------------------------------------ */

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const one = (sql) => db.prepare(sql).get().c;

  const stats = {
    totalPosts:      one('SELECT COUNT(*) c FROM posts'),
    totalLikes:      one('SELECT COUNT(*) c FROM likes'),
    totalVisits:     one('SELECT COUNT(*) c FROM visits'),
    uniqueVisitors:  one('SELECT COUNT(DISTINCT ip) c FROM visits'),
    visitsToday:     one("SELECT COUNT(*) c FROM visits WHERE date(visited_at) = date('now')"),
    likesToday:      one("SELECT COUNT(*) c FROM likes  WHERE date(created_at) = date('now')")
  };

  // Last 7 days of visits (fill gaps with 0)
  const raw = db.prepare(`
    SELECT date(visited_at) AS day, COUNT(*) AS count
    FROM visits
    WHERE visited_at >= datetime('now', '-6 days')
    GROUP BY day ORDER BY day
  `).all();

  const map  = Object.fromEntries(raw.map(r => [r.day, r.count]));
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    days.push({ day: key, count: map[key] || 0 });
  }

  // Top 5 most-liked posts
  const topPosts = db.prepare(`
    SELECT p.id, p.title, substr(p.content, 1, 50) AS excerpt,
           COUNT(l.id) AS like_count
    FROM posts p LEFT JOIN likes l ON l.post_id = p.id
    GROUP BY p.id ORDER BY like_count DESC LIMIT 5
  `).all();

  res.json({ ...stats, dailyVisits: days, topPosts });
});

app.get('/api/admin/likes', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT l.id, l.post_id, l.ip, l.user_agent, l.created_at,
           p.title, substr(p.content, 1, 60) AS post_excerpt
    FROM likes l JOIN posts p ON p.id = l.post_id
    ORDER BY l.created_at DESC LIMIT 1000
  `).all();
  res.json(rows);
});

app.get('/api/admin/visits', requireAdmin, (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM visits ORDER BY visited_at DESC LIMIT 1000'
  ).all();
  res.json(rows);
});

/* ------------------------------------------------------------------ */

app.listen(PORT, () => {
  console.log(`\n🚀 Shayari site running → http://localhost:${PORT}`);
  console.log(`🔐 Admin panel         → http://localhost:${PORT}/admin.html\n`);
});