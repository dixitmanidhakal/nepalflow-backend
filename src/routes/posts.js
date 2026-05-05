/**
 * Posts Routes
 */
const express = require('express');
const router = express.Router();
const { body, validationResult, query } = require('express-validator');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { authenticate } = require('../middleware/auth');
const { schedulePost } = require('../services/schedulerService');

router.use(authenticate);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// GET /posts
router.get('/', (req, res) => {
  const { status, platform, from, to, limit = 20, offset = 0 } = req.query;
  let sql = `
    SELECT p.*, sa.platform, sa.account_name, sa.profile_pic
    FROM posts p JOIN social_accounts sa ON p.account_id = sa.id
    WHERE p.user_id = ?
  `;
  const params = [req.user.id];
  if (status) { sql += ' AND p.status = ?'; params.push(status); }
  if (platform) { sql += ' AND sa.platform = ?'; params.push(platform); }
  if (from) { sql += ' AND p.scheduled_at >= ?'; params.push(from); }
  if (to) { sql += ' AND p.scheduled_at <= ?'; params.push(to); }
  sql += ' ORDER BY p.scheduled_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));

  const posts = db.all(sql, params);
  const totalRow = db.get('SELECT COUNT(*) as count FROM posts WHERE user_id = ?', [req.user.id]);
  res.json({ posts: posts.map(formatPost), total: totalRow ? totalRow.count : 0, limit: Number(limit), offset: Number(offset) });
});

// GET /posts/calendar
router.get('/calendar', (req, res) => {
  const y = req.query.year || new Date().getFullYear();
  const m = String(req.query.month || (new Date().getMonth() + 1)).padStart(2, '0');
  const from = y + '-' + m + '-01';
  const to = y + '-' + m + '-31';
  const posts = db.all(`
    SELECT p.id, p.content, p.status, p.scheduled_at, p.media_urls, p.hashtags,
           sa.platform, sa.account_name, sa.profile_pic
    FROM posts p JOIN social_accounts sa ON p.account_id = sa.id
    WHERE p.user_id = ? AND p.scheduled_at BETWEEN ? AND ?
    ORDER BY p.scheduled_at ASC
  `, [req.user.id, from, to]);
  res.json({ posts: posts.map(formatPost) });
});

// POST /posts
router.post('/', [
  body('accountId').notEmpty(),
  body('content').notEmpty().isLength({ max: 63206 }),
  body('scheduledAt').isISO8601(),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

  const { accountId, content, scheduledAt, hashtags = [], mediaUrls = [] } = req.body;
  const account = db.get(
    'SELECT * FROM social_accounts WHERE id = ? AND user_id = ? AND is_active = 1',
    [accountId, req.user.id]
  );
  if (!account) return res.status(404).json({ error: 'Social account not found' });
  if (new Date(scheduledAt) <= new Date()) return res.status(400).json({ error: 'scheduledAt must be in the future' });

  const post = schedulePost({ userId: req.user.id, accountId, content, mediaUrls, scheduledAt, hashtags });
  res.status(201).json({ post: formatPost(post), message: 'Post scheduled successfully' });
});

// GET /posts/export
router.get('/export', (req, res) => {
  const posts = db.all(`
    SELECT p.content, p.scheduled_at, p.status, p.hashtags, sa.account_name, sa.platform
    FROM posts p JOIN social_accounts sa ON p.account_id = sa.id
    WHERE p.user_id = ? ORDER BY p.scheduled_at ASC
  `, [req.user.id]);
  const headers = ['account_name', 'platform', 'content', 'scheduled_at', 'status', 'hashtags'];
  const csv = [headers.join(','), ...posts.map(p => [
    '"' + p.account_name + '"',
    p.platform,
    '"' + (p.content || '').replace(/"/g, '""') + '"',
    p.scheduled_at,
    p.status,
    '"' + (p.hashtags || '[]') + '"',
  ].join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="nepalflow_posts.csv"');
  res.send(csv);
});

// GET /posts/:id
router.get('/:id', (req, res) => {
  const post = db.get(
    'SELECT p.*, sa.platform, sa.account_name, sa.profile_pic FROM posts p JOIN social_accounts sa ON p.account_id = sa.id WHERE p.id = ? AND p.user_id = ?',
    [req.params.id, req.user.id]
  );
  if (!post) return res.status(404).json({ error: 'Post not found' });
  const analytics = db.get('SELECT * FROM analytics WHERE post_id = ? ORDER BY recorded_at DESC LIMIT 1', [post.id]);
  res.json({ post: formatPost(post), analytics });
});

// PATCH /posts/:id
router.patch('/:id', (req, res) => {
  const post = db.get('SELECT * FROM posts WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  if (post.status !== 'scheduled' && post.status !== 'draft') {
    return res.status(400).json({ error: 'Only scheduled/draft posts can be edited' });
  }
  const { content, scheduledAt, hashtags } = req.body;
  if (scheduledAt && new Date(scheduledAt) <= new Date()) {
    return res.status(400).json({ error: 'scheduledAt must be in the future' });
  }
  if (content) db.run("UPDATE posts SET content = ?, updated_at = datetime('now') WHERE id = ?", [content, req.params.id]);
  if (scheduledAt) db.run("UPDATE posts SET scheduled_at = ?, updated_at = datetime('now') WHERE id = ?", [scheduledAt, req.params.id]);
  if (hashtags) db.run("UPDATE posts SET hashtags = ?, updated_at = datetime('now') WHERE id = ?", [JSON.stringify(hashtags), req.params.id]);
  const updated = db.get('SELECT * FROM posts WHERE id = ?', [req.params.id]);
  res.json({ post: formatPost(updated), message: 'Post updated successfully' });
});

// DELETE /posts/:id
router.delete('/:id', (req, res) => {
  const post = db.get('SELECT * FROM posts WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  if (post.status === 'published') return res.status(400).json({ error: 'Cannot delete a published post' });
  db.run('DELETE FROM posts WHERE id = ?', [req.params.id]);
  res.json({ success: true, message: 'Post deleted' });
});

// POST /posts/bulk-import
router.post('/bulk-import', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'CSV file is required' });
  const csv = req.file.buffer.toString('utf-8');
  const lines = csv.split('\n').filter(Boolean);
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
  const imported = [];
  const errors = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/"/g, ''));
    const row = {};
    headers.forEach((h, idx) => { row[h] = cols[idx]; });
    try {
      const account = db.get('SELECT * FROM social_accounts WHERE account_name = ? AND user_id = ?', [row.account_name, req.user.id]);
      if (!account) throw new Error('Account "' + row.account_name + '" not found');
      if (!row.content) throw new Error('Content is required');
      if (!row.scheduled_at) throw new Error('scheduled_at is required');
      const post = schedulePost({
        userId: req.user.id, accountId: account.id, content: row.content,
        scheduledAt: row.scheduled_at,
        hashtags: row.hashtags ? row.hashtags.split('#').filter(Boolean).map(h => '#' + h.trim()) : [],
        mediaUrls: row.media_url ? [row.media_url] : [],
      });
      imported.push(post.id);
    } catch (err) {
      errors.push({ row: i, error: err.message });
    }
  }
  res.json({ imported: imported.length, errors, message: 'Imported ' + imported.length + ' post(s). ' + errors.length + ' error(s).' });
});

function formatPost(post) {
  return {
    ...post,
    media_urls: post.media_urls ? JSON.parse(post.media_urls) : [],
    hashtags: post.hashtags ? JSON.parse(post.hashtags) : [],
  };
}

module.exports = router;
