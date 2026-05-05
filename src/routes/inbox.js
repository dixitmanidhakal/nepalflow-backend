/**
 * Unified Inbox Routes
 * GET  /inbox              - fetch all comments/DMs (paginated)
 * POST /inbox/sync         - sync latest comments from FB/IG APIs
 * PATCH /inbox/:id/read    - mark as read
 * POST  /inbox/:id/reply   - reply to a comment/DM
 * GET  /inbox/unread-count - unread count badge
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { authenticate } = require('../middleware/auth');
const facebookService = require('../services/facebookService');

router.use(authenticate);

// ── GET /inbox ───────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const { platform, is_read, comment_type, limit = 30, offset = 0 } = req.query;

  let sql = `
    SELECT c.*,
           sa.platform,
           sa.account_name,
           sa.profile_pic as page_pic,
           p.content as post_content
    FROM comments c
    JOIN social_accounts sa ON c.account_id = sa.id
    LEFT JOIN posts p ON c.post_id = p.id
    WHERE sa.user_id = ?
  `;
  const params = [req.user.id];

  if (platform) { sql += ' AND sa.platform = ?'; params.push(platform); }
  if (is_read !== undefined) { sql += ' AND c.is_read = ?'; params.push(Number(is_read)); }
  if (comment_type) { sql += ' AND c.comment_type = ?'; params.push(comment_type); }

  sql += ' ORDER BY c.platform_time DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));

  const comments = db.prepare(sql).all(...params);
  const total = db.prepare(`
    SELECT COUNT(*) as count FROM comments c
    JOIN social_accounts sa ON c.account_id = sa.id
    WHERE sa.user_id = ?
  `).get(req.user.id).count;

  res.json({ comments, total });
});

// ── GET /inbox/unread-count ──────────────────────────────────────────────────
router.get('/unread-count', (req, res) => {
  const result = db.prepare(`
    SELECT COUNT(*) as count FROM comments c
    JOIN social_accounts sa ON c.account_id = sa.id
    WHERE sa.user_id = ? AND c.is_read = 0
  `).get(req.user.id);

  res.json({ unread: result.count });
});

// ── POST /inbox/sync ─────────────────────────────────────────────────────────
router.post('/sync', async (req, res) => {
  const accounts = db.prepare(
    'SELECT * FROM social_accounts WHERE user_id = ? AND is_active = 1'
  ).all(req.user.id);

  if (accounts.length === 0) {
    return res.status(400).json({ error: 'No active social accounts found' });
  }

  const synced = { comments: 0, dms: 0, errors: [] };

  for (const account of accounts) {
    try {
      if (account.platform === 'facebook') {
        // Fetch comments
        const comments = await facebookService.fetchPageComments({
          pageId: account.account_id,
          accessToken: account.access_token,
        });

        for (const c of comments) {
          // Find matching post in our DB
          const post = db.prepare(
            'SELECT id FROM posts WHERE platform_post_id = ?'
          ).get(c.post_platform_id);

          const existing = db.prepare(
            'SELECT id FROM comments WHERE platform_comment_id = ?'
          ).get(c.platform_comment_id);

          if (!existing) {
            db.prepare(`
              INSERT INTO comments
                (id, account_id, post_id, platform_comment_id, commenter_name,
                 commenter_id, message, comment_type, platform_time)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'comment', ?)
            `).run(
              uuidv4(), account.id, post?.id || null,
              c.platform_comment_id, c.commenter_name,
              c.commenter_id, c.message, c.platform_time
            );
            synced.comments++;
          }
        }

        // Fetch DMs
        const dms = await facebookService.fetchPageDMs({
          pageId: account.account_id,
          accessToken: account.access_token,
        });

        for (const dm of dms) {
          const existing = db.prepare(
            'SELECT id FROM comments WHERE platform_comment_id = ?'
          ).get(dm.platform_comment_id);

          if (!existing) {
            db.prepare(`
              INSERT INTO comments
                (id, account_id, platform_comment_id, commenter_name,
                 commenter_id, message, comment_type, platform_time)
              VALUES (?, ?, ?, ?, ?, ?, 'dm', ?)
            `).run(
              uuidv4(), account.id, dm.platform_comment_id,
              dm.commenter_name, dm.commenter_id, dm.message, dm.platform_time
            );
            synced.dms++;
          }
        }
      }
    } catch (error) {
      console.error(`Sync error for account ${account.account_name}:`, error.message);
      synced.errors.push({ account: account.account_name, error: error.message });
    }
  }

  res.json({ synced, message: `Synced ${synced.comments} comments, ${synced.dms} DMs` });
});

// ── PATCH /inbox/:id/read ────────────────────────────────────────────────────
router.patch('/:id/read', (req, res) => {
  const comment = db.prepare(`
    SELECT c.* FROM comments c
    JOIN social_accounts sa ON c.account_id = sa.id
    WHERE c.id = ? AND sa.user_id = ?
  `).get(req.params.id, req.user.id);

  if (!comment) return res.status(404).json({ error: 'Comment not found' });

  db.prepare('UPDATE comments SET is_read = 1 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ── PATCH /inbox/mark-all-read ───────────────────────────────────────────────
router.patch('/mark-all-read', (req, res) => {
  db.prepare(`
    UPDATE comments SET is_read = 1
    WHERE account_id IN (
      SELECT id FROM social_accounts WHERE user_id = ?
    )
  `).run(req.user.id);
  res.json({ success: true });
});

// ── POST /inbox/:id/reply ────────────────────────────────────────────────────
router.post('/:id/reply', async (req, res) => {
  const { message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'message is required' });

  const comment = db.prepare(`
    SELECT c.*, sa.access_token, sa.platform
    FROM comments c
    JOIN social_accounts sa ON c.account_id = sa.id
    WHERE c.id = ? AND sa.user_id = ?
  `).get(req.params.id, req.user.id);

  if (!comment) return res.status(404).json({ error: 'Comment not found' });

  try {
    await facebookService.replyToComment({
      commentId: comment.platform_comment_id.replace('dm_', ''),
      message,
      accessToken: comment.access_token,
    });

    db.prepare(`
      UPDATE comments
      SET is_replied = 1, reply_text = ?, is_read = 1
      WHERE id = ?
    `).run(message, req.params.id);

    res.json({ success: true, message: 'Reply sent successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
