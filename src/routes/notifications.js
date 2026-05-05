/**
 * Notifications Routes
 * GET   /api/notifications          - list (paginated)
 * GET   /api/notifications/unread-count
 * PATCH /api/notifications/:id/read - mark one read
 * PATCH /api/notifications/mark-all-read
 * DELETE /api/notifications/:id     - delete one
 * DELETE /api/notifications/clear   - clear all read
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { authenticate } = require('../middleware/auth');

// Helper to create a notification
function createNotification(userId, { type = 'info', title, message = '', link = '', icon = '' } = {}) {
  const id = uuidv4();
  db.run(
    'INSERT INTO notifications (id, user_id, type, title, message, link, icon) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, userId, type, title, message, link, icon]
  );
  return id;
}

// GET /api/notifications
router.get('/', authenticate, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  const offset = parseInt(req.query.offset) || 0;
  const unreadOnly = req.query.unread === 'true';

  let sql = 'SELECT * FROM notifications WHERE user_id = ?';
  const params = [req.user.id];
  if (unreadOnly) { sql += ' AND is_read = 0'; }
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const notifications = db.all(sql, params);
  const total = db.get('SELECT COUNT(*) as count FROM notifications WHERE user_id = ?', [req.user.id]).count;
  const unread = db.get('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0', [req.user.id]).count;

  res.json({ notifications, total, unread });
});

// GET /api/notifications/unread-count
router.get('/unread-count', authenticate, (req, res) => {
  const row = db.get('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0', [req.user.id]);
  res.json({ unread: row.count });
});

// PATCH /api/notifications/mark-all-read
router.patch('/mark-all-read', authenticate, (req, res) => {
  db.run("UPDATE notifications SET is_read = 1 WHERE user_id = ?", [req.user.id]);
  res.json({ success: true });
});

// PATCH /api/notifications/:id/read
router.patch('/:id/read', authenticate, (req, res) => {
  const notif = db.get('SELECT id FROM notifications WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!notif) return res.status(404).json({ error: 'Notification not found' });
  db.run('UPDATE notifications SET is_read = 1 WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// DELETE /api/notifications/clear — clear all read notifications
router.delete('/clear', authenticate, (req, res) => {
  db.run('DELETE FROM notifications WHERE user_id = ? AND is_read = 1', [req.user.id]);
  res.json({ success: true });
});

// DELETE /api/notifications/:id
router.delete('/:id', authenticate, (req, res) => {
  db.run('DELETE FROM notifications WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  res.json({ success: true });
});

module.exports = router;
module.exports.createNotification = createNotification;
