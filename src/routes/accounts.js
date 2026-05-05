/**
 * Social Accounts Routes
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { authenticate } = require('../middleware/auth');
const facebookService = require('../services/facebookService');

router.use(authenticate);

// GET /accounts
router.get('/', (req, res) => {
  const accounts = db.all(
    'SELECT id, platform, account_id, account_name, profile_pic, is_active, created_at FROM social_accounts WHERE user_id = ? ORDER BY created_at DESC',
    [req.user.id]
  );
  res.json({ accounts });
});

// POST /accounts/facebook
router.post('/facebook', async (req, res) => {
  const { userAccessToken } = req.body;
  if (!userAccessToken) return res.status(400).json({ error: 'userAccessToken is required' });
  try {
    const pages = await facebookService.getUserPages(userAccessToken);
    const linked = [];
    for (const page of pages) {
      let pageToken = page.access_token;
      try { pageToken = await facebookService.getLongLivedToken(page.access_token); } catch (_) {}

      const existing = db.get(
        "SELECT id FROM social_accounts WHERE user_id = ? AND platform = 'facebook' AND account_id = ?",
        [req.user.id, page.id]
      );
      if (existing) {
        db.run('UPDATE social_accounts SET access_token = ?, is_active = 1 WHERE id = ?', [pageToken, existing.id]);
        linked.push({ id: existing.id, account_name: page.name, platform: 'facebook', updated: true });
      } else {
        const id = uuidv4();
        db.run(
          "INSERT INTO social_accounts (id, user_id, platform, account_id, account_name, access_token, profile_pic) VALUES (?, ?, 'facebook', ?, ?, ?, ?)",
          [id, req.user.id, page.id, page.name, pageToken, page.picture && page.picture.data ? page.picture.data.url : null]
        );
        linked.push({ id, account_name: page.name, platform: 'facebook', updated: false });
      }
      if (page.instagram_business_account) {
        const igId = page.instagram_business_account.id;
        const igName = page.name + ' (Instagram)';
        const igExisting = db.get(
          "SELECT id FROM social_accounts WHERE user_id = ? AND platform = 'instagram' AND account_id = ?",
          [req.user.id, igId]
        );
        if (!igExisting) {
          const igSaId = uuidv4();
          db.run(
            "INSERT INTO social_accounts (id, user_id, platform, account_id, account_name, access_token) VALUES (?, ?, 'instagram', ?, ?, ?)",
            [igSaId, req.user.id, igId, igName, pageToken]
          );
          linked.push({ id: igSaId, account_name: igName, platform: 'instagram', updated: false });
        }
      }
    }
    res.json({ linked, message: linked.length + ' account(s) connected' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /accounts/:id
router.delete('/:id', (req, res) => {
  const account = db.get('SELECT * FROM social_accounts WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  db.run('DELETE FROM social_accounts WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// PATCH /accounts/:id/toggle
router.patch('/:id/toggle', (req, res) => {
  const account = db.get('SELECT * FROM social_accounts WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  const newStatus = account.is_active ? 0 : 1;
  db.run('UPDATE social_accounts SET is_active = ? WHERE id = ?', [newStatus, req.params.id]);
  res.json({ success: true, is_active: newStatus });
});

module.exports = router;
