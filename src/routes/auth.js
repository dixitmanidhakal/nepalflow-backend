/**
 * Auth Routes - Facebook, Google, TikTok, Instagram OAuth + Profile management
 */
const express = require('express');
const router = express.Router();
const passport = require('passport');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const db = require('../db/database');
const { generateToken, authenticate } = require('../middleware/auth');

// ─── DEV / DEMO LOGIN ────────────────────────────────────────────────────────
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
  } else {
    db.run("UPDATE users SET updated_at = datetime('now') WHERE id = ?", [user.id]);
    user = db.get('SELECT * FROM users WHERE id = ?', [user.id]);
  }
  const token = generateToken(user);
  res.json({ token, user });
});

// ─── FACEBOOK OAUTH (Server-side redirect) ───────────────────────────────────
router.get('/facebook', passport.authenticate('facebook', {
  scope: [
    'email',
    'pages_show_list',
    'pages_read_engagement',
    'pages_manage_posts',
    'pages_messaging',
    'instagram_basic',
    'instagram_content_publish',
    'instagram_manage_comments',
  ],
}));

router.get('/facebook/callback',
  passport.authenticate('facebook', { failureRedirect: '/auth/failure' }),
  (req, res) => {
    const token = generateToken(req.user);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    // Send popup-friendly response or redirect
    res.send(`
      <script>
        if (window.opener) {
          window.opener.postMessage({ type: 'OAUTH_SUCCESS', token: '${token}', provider: 'facebook' }, '${frontendUrl}');
          window.close();
        } else {
          window.location.href = '${frontendUrl}/auth/callback?token=${token}&provider=facebook';
        }
      </script>
    `);
  }
);

// ─── FACEBOOK TOKEN EXCHANGE (Client-side FB SDK → server) ──────────────────
// When user logs in via Facebook JS SDK on frontend, exchange their short-lived token
router.post('/facebook/token', async (req, res) => {
  const { accessToken, userID } = req.body;
  if (!accessToken || !userID) {
    return res.status(400).json({ error: 'accessToken and userID are required' });
  }
  try {
    // Verify token with Facebook
    const verifyRes = await axios.get(`https://graph.facebook.com/v19.0/me`, {
      params: {
        access_token: accessToken,
        fields: 'id,name,email,picture.type(large)',
      },
    });
    const profile = verifyRes.data;

    if (profile.id !== userID) {
      return res.status(401).json({ error: 'Token verification failed' });
    }

    const email = profile.email || `fb_${profile.id}@nepalflow.local`;
    let user = db.get("SELECT * FROM users WHERE provider_id = ? AND provider = 'facebook'", [profile.id]);
    if (!user) {
      // Check by email
      user = db.get('SELECT * FROM users WHERE email = ?', [email]);
    }
    if (!user) {
      const id = uuidv4();
      const avatar = profile.picture?.data?.url || null;
      db.run(
        'INSERT INTO users (id, email, name, avatar_url, provider, provider_id) VALUES (?, ?, ?, ?, ?, ?)',
        [id, email, profile.name, avatar, 'facebook', profile.id]
      );
      user = db.get('SELECT * FROM users WHERE id = ?', [id]);
    } else {
      // Update avatar and name
      db.run(
        "UPDATE users SET name = ?, avatar_url = ?, provider_id = ?, updated_at = datetime('now') WHERE id = ?",
        [profile.name, profile.picture?.data?.url || user.avatar_url, profile.id, user.id]
      );
      user = db.get('SELECT * FROM users WHERE id = ?', [user.id]);
    }

    // Store the access token for this user to connect their pages
    db.run("UPDATE users SET fb_access_token = ? WHERE id = ?", [accessToken, user.id]);

    const token = generateToken(user);
    res.json({ token, user, fbAccessToken: accessToken });
  } catch (err) {
    console.error('Facebook token exchange error:', err.message);
    res.status(500).json({ error: 'Facebook authentication failed: ' + err.message });
  }
});

// ─── INSTAGRAM (via Facebook) ────────────────────────────────────────────────
// Instagram uses same Facebook OAuth flow - handled via accounts route after FB login
router.get('/instagram', (req, res) => {
  // Redirect to Facebook OAuth with Instagram permissions
  const fbAppId = process.env.FACEBOOK_APP_ID;
  const redirectUri = encodeURIComponent(`${process.env.BACKEND_URL || 'http://localhost:5001'}/auth/facebook/callback`);
  const scope = encodeURIComponent('instagram_basic,instagram_content_publish,instagram_manage_comments,pages_show_list');
  res.redirect(`https://www.facebook.com/v19.0/dialog/oauth?client_id=${fbAppId}&redirect_uri=${redirectUri}&scope=${scope}&response_type=code`);
});

// ─── TIKTOK OAUTH ─────────────────────────────────────────────────────────────
router.get('/tiktok', (req, res) => {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  if (!clientKey || clientKey === 'your_tiktok_client_key_here') {
    return res.status(400).json({
      error: 'TikTok API not configured',
      message: 'Add TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET to your .env file',
      docs: 'https://developers.tiktok.com/doc/login-kit-web',
    });
  }
  const redirectUri = encodeURIComponent(`${process.env.BACKEND_URL || 'http://localhost:5001'}/auth/tiktok/callback`);
  const scope = encodeURIComponent('user.info.basic,video.list,video.publish');
  const state = uuidv4();
  // TikTok OAuth 2.0
  const authUrl = `https://www.tiktok.com/v2/auth/authorize/?client_key=${clientKey}&redirect_uri=${redirectUri}&scope=${scope}&response_type=code&state=${state}`;
  res.redirect(authUrl);
});

router.get('/tiktok/callback', async (req, res) => {
  const { code, error } = req.query;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

  if (error) {
    return res.redirect(`${frontendUrl}/auth/callback?error=tiktok_denied`);
  }

  try {
    // Exchange code for access token
    const tokenRes = await axios.post('https://open.tiktokapis.com/v2/oauth/token/', {
      client_key: process.env.TIKTOK_CLIENT_KEY,
      client_secret: process.env.TIKTOK_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: `${process.env.BACKEND_URL || 'http://localhost:5001'}/auth/tiktok/callback`,
    });

    const { access_token, open_id, refresh_token } = tokenRes.data;

    // Get user info
    const userRes = await axios.get('https://open.tiktokapis.com/v2/user/info/', {
      headers: { Authorization: `Bearer ${access_token}` },
      params: { fields: 'open_id,union_id,avatar_url,display_name' },
    });
    const ttUser = userRes.data.data.user;

    // Upsert in DB
    let user = db.get("SELECT * FROM users WHERE provider_id = ? AND provider = 'tiktok'", [open_id]);
    if (!user) {
      const id = uuidv4();
      db.run(
        'INSERT INTO users (id, email, name, avatar_url, provider, provider_id) VALUES (?, ?, ?, ?, ?, ?)',
        [id, `tiktok_${open_id}@nepalflow.local`, ttUser.display_name, ttUser.avatar_url, 'tiktok', open_id]
      );
      user = db.get('SELECT * FROM users WHERE id = ?', [id]);
    }

    // Store TikTok account
    const existing = db.get(
      "SELECT id FROM social_accounts WHERE user_id = ? AND platform = 'tiktok' AND account_id = ?",
      [user.id, open_id]
    );
    if (!existing) {
      db.run(
        "INSERT INTO social_accounts (id, user_id, platform, account_id, account_name, access_token, profile_pic) VALUES (?, ?, 'tiktok', ?, ?, ?, ?)",
        [uuidv4(), user.id, open_id, ttUser.display_name, access_token, ttUser.avatar_url]
      );
    } else {
      db.run('UPDATE social_accounts SET access_token = ? WHERE id = ?', [access_token, existing.id]);
    }

    const jwtToken = generateToken(user);
    res.send(`
      <script>
        if (window.opener) {
          window.opener.postMessage({ type: 'OAUTH_SUCCESS', token: '${jwtToken}', provider: 'tiktok' }, '${frontendUrl}');
          window.close();
        } else {
          window.location.href = '${frontendUrl}/auth/callback?token=${jwtToken}&provider=tiktok';
        }
      </script>
    `);
  } catch (err) {
    console.error('TikTok callback error:', err.message);
    res.redirect(`${frontendUrl}/auth/callback?error=tiktok_failed`);
  }
});

// ─── GOOGLE OAUTH ─────────────────────────────────────────────────────────────
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/auth/failure' }),
  (req, res) => {
    const token = generateToken(req.user);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.send(`
      <script>
        if (window.opener) {
          window.opener.postMessage({ type: 'OAUTH_SUCCESS', token: '${token}', provider: 'google' }, '${frontendUrl}');
          window.close();
        } else {
          window.location.href = '${frontendUrl}/auth/callback?token=${token}&provider=google';
        }
      </script>
    `);
  }
);

// ─── PROFILE MANAGEMENT ───────────────────────────────────────────────────────
router.get('/me', authenticate, (req, res) => {
  const accounts = db.all(
    'SELECT id, platform, account_name, profile_pic, is_active, created_at FROM social_accounts WHERE user_id = ? ORDER BY platform',
    [req.user.id]
  );
  res.json({ user: req.user, connectedAccounts: accounts });
});

router.patch('/me', authenticate, (req, res) => {
  const { name, language, timezone } = req.body;
  const updates = [];
  const params = [];
  if (name) { updates.push('name = ?'); params.push(name); }
  if (language && ['en', 'ne'].includes(language)) { updates.push('language = ?'); params.push(language); }
  if (timezone) { updates.push('timezone = ?'); params.push(timezone); }
  if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
  updates.push("updated_at = datetime('now')");
  params.push(req.user.id);
  db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
  const updated = db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  res.json({ user: updated });
});

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
