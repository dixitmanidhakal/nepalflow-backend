/**
 * Auth Routes: Google OAuth, Facebook OAuth, dev login
 */

const express = require('express');
const router = express.Router();
const passport = require('passport');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { generateToken, authenticate } = require('../middleware/auth');

// ─── DEV / DEMO LOGIN (no OAuth required for testing) ───────────────────────
router.post('/dev-login', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Not available in production' });
  }

  const { email = 'demo@nepalflow.com', name = 'Demo User' } = req.body;

  let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) {
    const id = uuidv4();
    db.prepare(`
      INSERT INTO users (id, email, name, provider)
      VALUES (?, ?, ?, 'local')
    `).run(id, email, name);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  }

  const token = generateToken(user);
  res.json({ token, user: sanitizeUser(user) });
});

// ─── FACEBOOK OAUTH ──────────────────────────────────────────────────────────
router.get('/facebook', passport.authenticate('facebook', {
  scope: [
    'email',
    'pages_show_list',
    'pages_read_engagement',
    'pages_manage_posts',
    'pages_messaging',
    'instagram_basic',
    'instagram_content_publish',
  ],
}));

router.get('/facebook/callback',
  passport.authenticate('facebook', { failureRedirect: '/auth/failure' }),
  (req, res) => {
    const token = generateToken(req.user);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}/auth/callback?token=${token}`);
  }
);

// ─── GOOGLE OAUTH ─────────────────────────────────────────────────────────────
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/auth/failure' }),
  (req, res) => {
    const token = generateToken(req.user);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}/auth/callback?token=${token}`);
  }
);

// ─── CURRENT USER ─────────────────────────────────────────────────────────────
router.get('/me', authenticate, (req, res) => {
  res.json({ user: sanitizeUser(req.user) });
});

// ─── UPDATE LANGUAGE PREFERENCE ──────────────────────────────────────────────
router.patch('/me/language', authenticate, (req, res) => {
  const { language } = req.body;
  if (!['en', 'ne'].includes(language)) {
    return res.status(400).json({ error: 'Invalid language. Use "en" or "ne"' });
  }
  db.prepare('UPDATE users SET language = ? WHERE id = ?').run(language, req.user.id);
  res.json({ success: true, language });
});

router.get('/failure', (req, res) => {
  res.status(401).json({ error: 'OAuth authentication failed' });
});

function sanitizeUser(user) {
  const { ...safe } = user;
  return safe;
}

module.exports = router;
