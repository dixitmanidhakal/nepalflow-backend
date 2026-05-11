/**
 * Auth Routes - Facebook, Google, TikTok, Instagram OAuth + Profile management
 */
import express, { Request, Response } from 'express';
import passport from 'passport';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import db from '../db/database';
import { generateToken, authenticate } from '../middleware/auth';
import { User } from '../types';

const router = express.Router();

// ─── DEV / DEMO LOGIN ────────────────────────────────────────────────────────
router.post('/dev-login', (req: Request, res: Response) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Not available in production' });
  }
  const { email = 'demo@nepalflow.com', name = 'Demo User' } = req.body;
  let user = db.get<User>('SELECT * FROM users WHERE email = ?', [email]);
  if (!user) {
    const id = uuidv4();
    db.run('INSERT INTO users (id, email, name, provider) VALUES (?, ?, ?, ?)', [id, email, name, 'local']);
    user = db.get<User>('SELECT * FROM users WHERE id = ?', [id]);
  } else {
    db.run("UPDATE users SET updated_at = datetime('now') WHERE id = ?", [user.id]);
    user = db.get<User>('SELECT * FROM users WHERE id = ?', [user.id]);
  }
  const token = generateToken(user!);
  res.json({ token, user });
});

// ─── AUTH CONFIG (tells frontend which providers are configured) ──────────────
router.get('/config', (_req: Request, res: Response) => {
  const fbConfigured  = !!(process.env.FACEBOOK_APP_ID   && process.env.FACEBOOK_APP_ID   !== 'your_facebook_app_id_here');
  const gConfigured   = !!(process.env.GOOGLE_CLIENT_ID  && process.env.GOOGLE_CLIENT_ID  !== 'your_google_client_id_here');
  const ttConfigured  = !!(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_KEY !== 'your_tiktok_client_key_here');
  res.json({
    facebook:  fbConfigured,
    instagram: fbConfigured,
    tiktok:    ttConfigured,
    google:    gConfigured,
    demo:      process.env.NODE_ENV !== 'production',
  });
});

// ─── FACEBOOK OAUTH (Server-side redirect) ───────────────────────────────────
router.get('/facebook', (req: Request, res: Response, next) => {
  const fbConfigured = !!(process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_ID !== 'your_facebook_app_id_here');
  if (!fbConfigured) {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    return res.send(`
      <script>
        if (window.opener) {
          window.opener.postMessage({ type: 'OAUTH_ERROR', provider: 'facebook', message: 'Facebook app credentials not configured. Add FACEBOOK_APP_ID and FACEBOOK_APP_SECRET to your .env file.' }, '${frontendUrl}');
          window.close();
        } else {
          window.location.href = '${frontendUrl}/login?error=facebook_not_configured';
        }
      </script>
    `);
  }
  passport.authenticate('facebook', { scope: ['email', 'public_profile'] })(req, res, next);
});

router.get('/facebook/callback', (req: Request, res: Response, next) => {
  const fbConfigured = !!(process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_ID !== 'your_facebook_app_id_here');
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  if (!fbConfigured) return res.redirect(`${frontendUrl}/login?error=facebook_not_configured`);
  passport.authenticate('facebook', { failureRedirect: '/auth/failure' })(req, res, () => {
    const token = generateToken(req.user as User);
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
  });
});

// ─── FACEBOOK TOKEN EXCHANGE (Client-side FB SDK → server) ──────────────────
router.post('/facebook/token', async (req: Request, res: Response) => {
  const { accessToken, userID } = req.body;
  if (!accessToken || !userID) {
    return res.status(400).json({ error: 'accessToken and userID are required' });
  }
  try {
    const verifyRes = await axios.get(`https://graph.facebook.com/v19.0/me`, {
      params: {
        access_token: accessToken,
        fields: 'id,name,email,picture.type(large)',
      },
    });
    const profile = verifyRes.data as {
      id: string;
      name: string;
      email?: string;
      picture?: { data?: { url?: string } };
    };

    if (profile.id !== userID) {
      return res.status(401).json({ error: 'Token verification failed' });
    }

    const email = profile.email || `fb_${profile.id}@nepalflow.local`;
    let user = db.get<User>("SELECT * FROM users WHERE provider_id = ? AND provider = 'facebook'", [profile.id]);
    if (!user) {
      user = db.get<User>('SELECT * FROM users WHERE email = ?', [email]);
    }
    if (!user) {
      const id = uuidv4();
      const avatar = profile.picture?.data?.url || null;
      db.run(
        'INSERT INTO users (id, email, name, avatar_url, provider, provider_id) VALUES (?, ?, ?, ?, ?, ?)',
        [id, email, profile.name, avatar, 'facebook', profile.id]
      );
      user = db.get<User>('SELECT * FROM users WHERE id = ?', [id]);
    } else {
      db.run(
        "UPDATE users SET name = ?, avatar_url = ?, provider_id = ?, updated_at = datetime('now') WHERE id = ?",
        [profile.name, profile.picture?.data?.url || user.avatar_url, profile.id, user.id]
      );
      user = db.get<User>('SELECT * FROM users WHERE id = ?', [user!.id]);
    }

    db.run("UPDATE users SET fb_access_token = ? WHERE id = ?", [accessToken, user!.id]);

    const token = generateToken(user!);
    res.json({ token, user, fbAccessToken: accessToken });
  } catch (err: unknown) {
    const error = err as Error;
    console.error('Facebook token exchange error:', error.message);
    res.status(500).json({ error: 'Facebook authentication failed: ' + error.message });
  }
});

// ─── INSTAGRAM (via Facebook) ────────────────────────────────────────────────
router.get('/instagram', (req: Request, res: Response) => {
  const fbAppId = process.env.FACEBOOK_APP_ID;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

  if (!fbAppId || fbAppId === 'your_facebook_app_id_here') {
    return res.send(`
      <script>
        if (window.opener) {
          window.opener.postMessage({ type: 'OAUTH_ERROR', provider: 'instagram', message: 'Instagram requires Facebook app credentials. Add FACEBOOK_APP_ID and FACEBOOK_APP_SECRET to your .env file.' }, '${frontendUrl}');
          window.close();
        } else {
          window.location.href = '${frontendUrl}/login?error=instagram_not_configured';
        }
      </script>
    `);
  }

  const redirectUri = encodeURIComponent(`${process.env.BACKEND_URL || 'http://localhost:5001'}/auth/facebook/callback`);
  const scope = encodeURIComponent('email,public_profile,pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish,instagram_manage_comments');
  res.redirect(`https://www.facebook.com/v19.0/dialog/oauth?client_id=${fbAppId}&redirect_uri=${redirectUri}&scope=${scope}&response_type=code`);
});

// ─── TIKTOK OAUTH ─────────────────────────────────────────────────────────────
router.get('/tiktok', (req: Request, res: Response) => {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  if (!clientKey || clientKey === 'your_tiktok_client_key_here') {
    return res.send(`
      <script>
        if (window.opener) {
          window.opener.postMessage({ type: 'OAUTH_ERROR', provider: 'tiktok', message: 'TikTok app credentials not configured. Add TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET to your .env file.' }, '${frontendUrl}');
          window.close();
        } else {
          window.location.href = '${frontendUrl}/login?error=tiktok_not_configured';
        }
      </script>
    `);
  }
  const redirectUri = encodeURIComponent(`${process.env.BACKEND_URL || 'http://localhost:5001'}/auth/tiktok/callback`);
  const scope = encodeURIComponent('user.info.basic,video.list,video.publish');
  const state = uuidv4();
  const authUrl = `https://www.tiktok.com/v2/auth/authorize/?client_key=${clientKey}&redirect_uri=${redirectUri}&scope=${scope}&response_type=code&state=${state}`;
  res.redirect(authUrl);
});

router.get('/tiktok/callback', async (req: Request, res: Response) => {
  const { code, error } = req.query as { code?: string; error?: string };
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

  if (error) {
    return res.redirect(`${frontendUrl}/auth/callback?error=tiktok_denied`);
  }

  try {
    const tokenRes = await axios.post('https://open.tiktokapis.com/v2/oauth/token/', {
      client_key: process.env.TIKTOK_CLIENT_KEY,
      client_secret: process.env.TIKTOK_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: `${process.env.BACKEND_URL || 'http://localhost:5001'}/auth/tiktok/callback`,
    });

    const { access_token, open_id } = tokenRes.data as { access_token: string; open_id: string; refresh_token: string };

    const userRes = await axios.get('https://open.tiktokapis.com/v2/user/info/', {
      headers: { Authorization: `Bearer ${access_token}` },
      params: { fields: 'open_id,union_id,avatar_url,display_name' },
    });
    const ttUser = userRes.data.data.user as { display_name: string; avatar_url: string };

    let user = db.get<User>("SELECT * FROM users WHERE provider_id = ? AND provider = 'tiktok'", [open_id]);
    if (!user) {
      const id = uuidv4();
      db.run(
        'INSERT INTO users (id, email, name, avatar_url, provider, provider_id) VALUES (?, ?, ?, ?, ?, ?)',
        [id, `tiktok_${open_id}@nepalflow.local`, ttUser.display_name, ttUser.avatar_url, 'tiktok', open_id]
      );
      user = db.get<User>('SELECT * FROM users WHERE id = ?', [id]);
    }

    const existing = db.get(
      "SELECT id FROM social_accounts WHERE user_id = ? AND platform = 'tiktok' AND account_id = ?",
      [user!.id, open_id]
    ) as { id: string } | undefined;
    if (!existing) {
      db.run(
        "INSERT INTO social_accounts (id, user_id, platform, account_id, account_name, access_token, profile_pic) VALUES (?, ?, 'tiktok', ?, ?, ?, ?)",
        [uuidv4(), user!.id, open_id, ttUser.display_name, access_token, ttUser.avatar_url]
      );
    } else {
      db.run('UPDATE social_accounts SET access_token = ? WHERE id = ?', [access_token, existing.id]);
    }

    const jwtToken = generateToken(user!);
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
  } catch (err: unknown) {
    const error = err as Error;
    console.error('TikTok callback error:', error.message);
    res.redirect(`${frontendUrl}/auth/callback?error=tiktok_failed`);
  }
});

// ─── GOOGLE OAUTH ─────────────────────────────────────────────────────────────
router.get('/google', (req: Request, res: Response, next) => {
  const gConfigured = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_ID !== 'your_google_client_id_here');
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  if (!gConfigured) {
    return res.send(`
      <script>
        if (window.opener) {
          window.opener.postMessage({ type: 'OAUTH_ERROR', provider: 'google', message: 'Google OAuth credentials not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to your .env file.' }, '${frontendUrl}');
          window.close();
        } else {
          window.location.href = '${frontendUrl}/login?error=google_not_configured';
        }
      </script>
    `);
  }
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

router.get('/google/callback', (req: Request, res: Response, next) => {
  const gConfigured = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_ID !== 'your_google_client_id_here');
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  if (!gConfigured) return res.redirect(`${frontendUrl}/login?error=google_not_configured`);
  passport.authenticate('google', { failureRedirect: '/auth/failure' })(req, res, () => {
    const token = generateToken(req.user as User);
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
  });
});

// ─── PROFILE MANAGEMENT ───────────────────────────────────────────────────────
router.get('/me', authenticate, (req: Request, res: Response) => {
  const accounts = db.all(
    'SELECT id, platform, account_name, profile_pic, is_active, created_at FROM social_accounts WHERE user_id = ? ORDER BY platform',
    [req.user!.id]
  );
  res.json({ user: req.user, connectedAccounts: accounts });
});

router.patch('/me', authenticate, (req: Request, res: Response) => {
  const { name, language, timezone, bio, website, avatar_url } = req.body as {
    name?: string;
    language?: string;
    timezone?: string;
    bio?: string;
    website?: string;
    avatar_url?: string;
  };
  const updates: string[] = [];
  const params: unknown[] = [];
  if (name !== undefined)       { updates.push('name = ?');       params.push(name); }
  if (bio !== undefined)        { updates.push('bio = ?');        params.push(bio); }
  if (website !== undefined)    { updates.push('website = ?');    params.push(website); }
  if (avatar_url !== undefined) { updates.push('avatar_url = ?'); params.push(avatar_url); }
  if (language && ['en', 'ne'].includes(language)) { updates.push('language = ?'); params.push(language); }
  if (timezone) { updates.push('timezone = ?'); params.push(timezone); }
  if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
  updates.push("updated_at = datetime('now')");
  params.push(req.user!.id);
  db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
  const updated = db.get<User>('SELECT * FROM users WHERE id = ?', [req.user!.id]);
  res.json({ user: updated });
});

router.patch('/me/language', authenticate, (req: Request, res: Response) => {
  const { language } = req.body as { language: string };
  if (!['en', 'ne'].includes(language)) {
    return res.status(400).json({ error: 'Invalid language. Use "en" or "ne"' });
  }
  db.run('UPDATE users SET language = ? WHERE id = ?', [language, req.user!.id]);
  res.json({ success: true, language });
});

router.get('/failure', (_req: Request, res: Response) => {
  res.status(401).json({ error: 'OAuth authentication failed' });
});

export default router;
