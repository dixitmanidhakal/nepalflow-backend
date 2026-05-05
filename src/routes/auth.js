/**
 * Auth Routes
 */
const express = require('express');
const router = express.Router();
const passport = require('passport');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { generateToken, authenticate } = require('../middleware/auth');

// DEV login (no OAuth needed for testing)
router.post('/dev-login', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Not available in production' });
  }
  const { email = 'demo@nepalflow.com', name = 'Demo User' } = req.body;
  let user = db.get('SELECT * FROM users WHERE email = ?', [email]);
  if (!user) {
    const id = uuidv4();
    db.run('INSERT INTO users (id, email, name, provider) VALUES (?, ?, ?, ?)', [id, email, name, 'local']);
    user = db.get('SELECT * FROM users WHERE id = ?', [id]);
  }
  const token = generateToken(user);
  res.json({ token, user });
});

// Facebook OAuth
router.get('/facebook', passport.authenticate('facebook', {
  scope: ['email', 'pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'pages_messaging', 'instagram_basic', 'instagram_content_publish'],
}));

router.get('/facebook/callback',
  passport.authenticate('facebook', { failureRedirect: '/auth/failure' }),
  (req, res) => {
    const token = generateToken(req.user);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}/auth/callback?token=${token}`);
  }
);

// Google OAuth
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/auth/failure' }),
  (req, res) => {
    const token = generateToken(req.user);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}/auth/callback?token=${token}`);
  }
);

// Get current user
router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

// Update language preference
router.patch('/me/language', authenticate, (req, res) => {
  const { language } = req.body;
  if (!['en', 'ne'].includes(language)) {
    return res.status(400).json({ error: 'Invalid language. Use "en" or "ne"' });
  }
  db.run('UPDATE users SET language = ? WHERE id = ?', [language, req.user.id]);
  res.json({ success: true, language });
});

router.get('/failure', (req, res) => {
  res.status(401).json({ error: 'OAuth authentication failed' });
});

module.exports = router;
