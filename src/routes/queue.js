/**
 * Bulk Post Queue Routes
 * GET    /api/queue            - list queue items
 * POST   /api/queue            - add item to queue
 * POST   /api/queue/bulk       - add multiple items (JSON array)
 * PATCH  /api/queue/:id        - update queue item
 * DELETE /api/queue/:id        - remove from queue
 * POST   /api/queue/publish-all - convert all queued → posts
 * DELETE /api/queue/clear       - clear entire queue
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { authenticate } = require('../middleware/auth');

function tryParse(s, fb) { try { return JSON.parse(s); } catch { return fb; } }

// GET /api/queue
router.get('/', authenticate, (req, res) => {
  const { status = 'queued' } = req.query;
  const items = db.all(
    `SELECT q.*, sa.account_name, sa.platform, sa.profile_pic
     FROM post_queue q
     LEFT JOIN social_accounts sa ON q.account_id = sa.id
     WHERE q.user_id = ? ${status ? 'AND q.status = ?' : ''}
     ORDER BY q.scheduled_at ASC`,
    status ? [req.user.id, status] : [req.user.id]
  );
  const counts = db.all(
    'SELECT status, COUNT(*) as count FROM post_queue WHERE user_id = ? GROUP BY status',
    [req.user.id]
  );
  res.json({
    items: items.map(i => ({ ...i, media_urls: tryParse(i.media_urls, []), hashtags: tryParse(i.hashtags, []) })),
    counts: Object.fromEntries(counts.map(c => [c.status, c.count])),
  });
});

// POST /api/queue — add single item
router.post('/', authenticate, (req, res) => {
  const { account_id, content, media_urls = [], hashtags = [], scheduled_at } = req.body;
  if (!account_id) return res.status(400).json({ error: 'Account is required' });
  if (!content?.trim()) return res.status(400).json({ error: 'Content is required' });
  if (!scheduled_at) return res.status(400).json({ error: 'Scheduled time is required' });

  const id = uuidv4();
  db.run(
    'INSERT INTO post_queue (id, user_id, account_id, content, media_urls, hashtags, scheduled_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, req.user.id, account_id, content.trim(), JSON.stringify(media_urls), JSON.stringify(hashtags), new Date(scheduled_at).toISOString()]
  );
  const item = db.get('SELECT * FROM post_queue WHERE id = ?', [id]);
  res.status(201).json({ item });
});

// POST /api/queue/bulk — add multiple items at once
router.post('/bulk', authenticate, (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Items array is required' });
  }
  if (items.length > 100) {
    return res.status(400).json({ error: 'Maximum 100 items per bulk upload' });
  }

  const created = [];
  const errors = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item.account_id || !item.content?.trim() || !item.scheduled_at) {
      errors.push({ index: i, error: 'account_id, content, and scheduled_at are required' });
      continue;
    }
    const id = uuidv4();
    try {
      db.run(
        'INSERT INTO post_queue (id, user_id, account_id, content, media_urls, hashtags, scheduled_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, req.user.id, item.account_id, item.content.trim(),
         JSON.stringify(item.media_urls || []),
         JSON.stringify(item.hashtags || []),
         new Date(item.scheduled_at).toISOString()]
      );
      created.push(id);
    } catch (err) {
      errors.push({ index: i, error: err.message });
    }
  }

  res.status(201).json({
    created: created.length,
    errors: errors.length,
    error_details: errors,
    message: `${created.length} items added to queue${errors.length ? `, ${errors.length} failed` : ''}`,
  });
});

// PATCH /api/queue/:id
router.patch('/:id', authenticate, (req, res) => {
  const item = db.get('SELECT id FROM post_queue WHERE id = ? AND user_id = ? AND status = ?', [req.params.id, req.user.id, 'queued']);
  if (!item) return res.status(404).json({ error: 'Queue item not found or not editable' });
  const { content, scheduled_at, account_id, hashtags, media_urls } = req.body;
  const updates = []; const params = [];
  if (content !== undefined)      { updates.push('content = ?');      params.push(content); }
  if (scheduled_at !== undefined) { updates.push('scheduled_at = ?'); params.push(new Date(scheduled_at).toISOString()); }
  if (account_id !== undefined)   { updates.push('account_id = ?');   params.push(account_id); }
  if (hashtags !== undefined)     { updates.push('hashtags = ?');     params.push(JSON.stringify(hashtags)); }
  if (media_urls !== undefined)   { updates.push('media_urls = ?');   params.push(JSON.stringify(media_urls)); }
  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
  params.push(req.params.id);
  db.run(`UPDATE post_queue SET ${updates.join(', ')} WHERE id = ?`, params);
  const updated = db.get('SELECT * FROM post_queue WHERE id = ?', [req.params.id]);
  res.json({ item: updated });
});

// DELETE /api/queue/:id
router.delete('/:id', authenticate, (req, res) => {
  db.run('DELETE FROM post_queue WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  res.json({ success: true });
});

// POST /api/queue/publish-all — convert all queued items into actual posts
router.post('/publish-all', authenticate, (req, res) => {
  const items = db.all(
    "SELECT * FROM post_queue WHERE user_id = ? AND status = 'queued'",
    [req.user.id]
  );
  if (items.length === 0) return res.status(400).json({ error: 'No queued items to publish' });

  let created = 0;
  for (const item of items) {
    const postId = uuidv4();
    const hashtags = tryParse(item.hashtags, []);
    const mediaUrls = tryParse(item.media_urls, []);
    let content = item.content;
    if (hashtags.length) content += '\n\n' + hashtags.join(' ');
    try {
      db.run(
        `INSERT INTO posts (id, user_id, account_id, content, media_urls, hashtags, scheduled_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled')`,
        [postId, req.user.id, item.account_id, content, JSON.stringify(mediaUrls), JSON.stringify(hashtags), item.scheduled_at]
      );
      db.run('UPDATE post_queue SET status = ?, post_id = ? WHERE id = ?', ['published', postId, item.id]);
      created++;
    } catch (err) {
      db.run('UPDATE post_queue SET status = ?, error = ? WHERE id = ?', ['error', err.message, item.id]);
    }
  }

  res.json({ created, total: items.length, message: `${created} posts scheduled from queue` });
});

// DELETE /api/queue/clear — clear all queued items
router.delete('/clear', authenticate, (req, res) => {
  const { status = 'queued' } = req.query;
  db.run('DELETE FROM post_queue WHERE user_id = ? AND status = ?', [req.user.id, status]);
  res.json({ success: true });
});

module.exports = router;
