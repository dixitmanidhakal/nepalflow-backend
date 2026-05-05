/**
 * Posts Routes
 * GET    /posts              - list posts for user (with filters)
 * POST   /posts              - schedule a new post
 * GET    /posts/:id          - get single post
 * PATCH  /posts/:id          - update a scheduled post
 * DELETE /posts/:id          - delete a post
 * GET    /posts/calendar     - get posts for calendar view
 * POST   /posts/bulk-import  - import posts from CSV
 * GET    /posts/export       - export posts as CSV
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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'video/mp4', 'text/csv'];
    cb(null, allowed.includes(file.mimetype));
  },
});

// ── GET /posts ──────────────────────────────────────────────────────────────
router.get('/', [
  query('status').optional().isIn(['scheduled', 'published', 'failed', 'draft']),
  query('platform').optional().isIn(['facebook', 'instagram']),
  query('from').optional().isISO8601(),
  query('to').optional().isISO8601(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('offset').optional().isInt({ min: 0 }).toInt(),
], (req, res) => {
  const { status, platform, from, to, limit = 20, offset = 0 } = req.query;

  let sql = `
    SELECT p.*, sa.platform, sa.account_name, sa.profile_pic
    FROM posts p
    JOIN social_accounts sa ON p.account_id = sa.id
    WHERE p.user_id = ?
  `;
  const params = [req.user.id];

  if (status) { sql += ' AND p.status = ?'; params.push(status); }
  if (platform) { sql += ' AND sa.platform = ?'; params.push(platform); }
  if (from) { sql += ' AND p.scheduled_at >= ?'; params.push(from); }
  if (to) { sql += ' AND p.scheduled_at <= ?'; params.push(to); }

  sql += ' ORDER BY p.scheduled_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const posts = db.prepare(sql).all(...params);
  const total = db.prepare(`
    SELECT COUNT(*) as count FROM posts WHERE user_id = ?
  `).get(req.user.id).count;

  res.json({ posts: posts.map(formatPost), total, limit, offset });
});

// ── GET /posts/calendar ────────────────────────────────────────────────────
router.get('/calendar', (req, res) => {
  const { month, year } = req.query;
  const y = year || new Date().getFullYear();
  const m = (month || new Date().getMonth() + 1).toString().padStart(2, '0');

  const from = `${y}-${m}-01`;
  const to = `${y}-${m}-31`;

  const posts = db.prepare(`
    SELECT p.id, p.content, p.status, p.scheduled_at, p.media_urls,
           sa.platform, sa.account_name, sa.profile_pic
    FROM posts p
    JOIN social_accounts sa ON p.account_id = sa.id
    WHERE p.user_id = ? AND p.scheduled_at BETWEEN ? AND ?
    ORDER BY p.scheduled_at ASC
  `).all(req.user.id, from, to);

  res.json({ posts: posts.map(formatPost) });
});

// ── POST /posts ─────────────────────────────────────────────────────────────
router.post('/', [
  body('accountId').notEmpty().withMessage('accountId is required'),
  body('content').notEmpty().withMessage('content is required').isLength({ max: 63206 }),
  body('scheduledAt').isISO8601().withMessage('scheduledAt must be a valid datetime'),
  body('hashtags').optional().isArray(),
  body('mediaUrls').optional().isArray(),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

  const { accountId, content, scheduledAt, hashtags = [], mediaUrls = [] } = req.body;

  // Verify account belongs to user
  const account = db.prepare(
    'SELECT * FROM social_accounts WHERE id = ? AND user_id = ? AND is_active = 1'
  ).get(accountId, req.user.id);
  if (!account) return res.status(404).json({ error: 'Social account not found' });

  // Ensure scheduled time is in the future
  if (new Date(scheduledAt) <= new Date()) {
    return res.status(400).json({ error: 'scheduledAt must be in the future' });
  }

  const post = schedulePost({
    userId: req.user.id,
    accountId,
    content,
    mediaUrls,
    scheduledAt,
    hashtags,
  });

  res.status(201).json({ post: formatPost(post), message: 'Post scheduled successfully' });
});

// ── GET /posts/:id ──────────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const post = db.prepare(`
    SELECT p.*, sa.platform, sa.account_name, sa.profile_pic
    FROM posts p
    JOIN social_accounts sa ON p.account_id = sa.id
    WHERE p.id = ? AND p.user_id = ?
  `).get(req.params.id, req.user.id);

  if (!post) return res.status(404).json({ error: 'Post not found' });

  const analytics = db.prepare(
    'SELECT * FROM analytics WHERE post_id = ? ORDER BY recorded_at DESC LIMIT 1'
  ).get(post.id);

  res.json({ post: formatPost(post), analytics });
});

// ── PATCH /posts/:id ────────────────────────────────────────────────────────
router.patch('/:id', [
  body('content').optional().notEmpty().isLength({ max: 63206 }),
  body('scheduledAt').optional().isISO8601(),
  body('hashtags').optional().isArray(),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

  const post = db.prepare(
    'SELECT * FROM posts WHERE id = ? AND user_id = ?'
  ).get(req.params.id, req.user.id);

  if (!post) return res.status(404).json({ error: 'Post not found' });
  if (post.status !== 'scheduled' && post.status !== 'draft') {
    return res.status(400).json({ error: 'Only scheduled/draft posts can be edited' });
  }

  const { content, scheduledAt, hashtags } = req.body;
  const updates = [];
  const params = [];

  if (content !== undefined) { updates.push('content = ?'); params.push(content); }
  if (scheduledAt !== undefined) {
    if (new Date(scheduledAt) <= new Date()) {
      return res.status(400).json({ error: 'scheduledAt must be in the future' });
    }
    updates.push('scheduled_at = ?');
    params.push(scheduledAt);
  }
  if (hashtags !== undefined) { updates.push('hashtags = ?'); params.push(JSON.stringify(hashtags)); }

  if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(req.params.id);

  db.prepare(`UPDATE posts SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  const updated = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  res.json({ post: formatPost(updated), message: 'Post updated successfully' });
});

// ── DELETE /posts/:id ───────────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  const post = db.prepare(
    'SELECT * FROM posts WHERE id = ? AND user_id = ?'
  ).get(req.params.id, req.user.id);

  if (!post) return res.status(404).json({ error: 'Post not found' });
  if (post.status === 'published') {
    return res.status(400).json({ error: 'Cannot delete a published post' });
  }

  db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id);
  res.json({ success: true, message: 'Post deleted' });
});

// ── POST /posts/bulk-import (CSV) ───────────────────────────────────────────
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
      const account = db.prepare(
        'SELECT * FROM social_accounts WHERE account_name = ? AND user_id = ?'
      ).get(row.account_name, req.user.id);

      if (!account) throw new Error(`Account "${row.account_name}" not found`);
      if (!row.content) throw new Error('Content is required');
      if (!row.scheduled_at) throw new Error('scheduled_at is required');

      const post = schedulePost({
        userId: req.user.id,
        accountId: account.id,
        content: row.content,
        scheduledAt: row.scheduled_at,
        hashtags: row.hashtags ? row.hashtags.split('#').filter(Boolean).map(h => `#${h.trim()}`) : [],
        mediaUrls: row.media_url ? [row.media_url] : [],
      });
      imported.push(post.id);
    } catch (err) {
      errors.push({ row: i, error: err.message });
    }
  }

  res.json({
    imported: imported.length,
    errors,
    message: `Imported ${imported.length} post(s). ${errors.length} error(s).`,
  });
});

// ── GET /posts/export ────────────────────────────────────────────────────────
router.get('/export', (req, res) => {
  const posts = db.prepare(`
    SELECT p.content, p.scheduled_at, p.status, p.hashtags, sa.account_name, sa.platform
    FROM posts p
    JOIN social_accounts sa ON p.account_id = sa.id
    WHERE p.user_id = ?
    ORDER BY p.scheduled_at ASC
  `).all(req.user.id);

  const headers = ['account_name', 'platform', 'content', 'scheduled_at', 'status', 'hashtags'];
  const csv = [
    headers.join(','),
    ...posts.map(p => [
      `"${p.account_name}"`,
      p.platform,
      `"${p.content?.replace(/"/g, '""')}"`,
      p.scheduled_at,
      p.status,
      `"${(p.hashtags || '[]')}"`,
    ].join(',')),
  ].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="nepalflow_posts.csv"');
  res.send(csv);
});

function formatPost(post) {
  return {
    ...post,
    media_urls: post.media_urls ? JSON.parse(post.media_urls) : [],
    hashtags: post.hashtags ? JSON.parse(post.hashtags) : [],
  };
}

module.exports = router;
