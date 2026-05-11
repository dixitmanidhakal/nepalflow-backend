/**
 * Notifications Routes
 */
import express, { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/database';
import { authenticate } from '../middleware/auth';
import { Notification } from '../types';

const router = express.Router();

interface CreateNotificationOptions {
  type?: string;
  title: string;
  message?: string;
  link?: string;
  icon?: string;
}

// Helper to create a notification
export function createNotification(userId: string, { type = 'info', title, message = '', link = '', icon = '' }: CreateNotificationOptions): string {
  const id = uuidv4();
  db.run(
    'INSERT INTO notifications (id, user_id, type, title, message, link, icon) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, userId, type, title, message, link, icon]
  );
  return id;
}

// GET /api/notifications
router.get('/', authenticate, (req: Request, res: Response) => {
  const limit = Math.min(parseInt(String(req.query.limit)) || 20, 50);
  const offset = parseInt(String(req.query.offset)) || 0;
  const unreadOnly = req.query.unread === 'true';

  let sql = 'SELECT * FROM notifications WHERE user_id = ?';
  const params: unknown[] = [req.user!.id];
  if (unreadOnly) { sql += ' AND is_read = 0'; }
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const notifications = db.all<Notification>(sql, params);
  const total = db.get<{ count: number }>('SELECT COUNT(*) as count FROM notifications WHERE user_id = ?', [req.user!.id])!.count;
  const unread = db.get<{ count: number }>('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0', [req.user!.id])!.count;

  res.json({ notifications, total, unread });
});

// GET /api/notifications/unread-count
router.get('/unread-count', authenticate, (req: Request, res: Response) => {
  const row = db.get<{ count: number }>('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0', [req.user!.id]);
  res.json({ unread: row!.count });
});

// PATCH /api/notifications/mark-all-read
router.patch('/mark-all-read', authenticate, (req: Request, res: Response) => {
  db.run("UPDATE notifications SET is_read = 1 WHERE user_id = ?", [req.user!.id]);
  res.json({ success: true });
});

// PATCH /api/notifications/:id/read
router.patch('/:id/read', authenticate, (req: Request, res: Response) => {
  const notif = db.get('SELECT id FROM notifications WHERE id = ? AND user_id = ?', [req.params.id, req.user!.id]);
  if (!notif) return res.status(404).json({ error: 'Notification not found' });
  db.run('UPDATE notifications SET is_read = 1 WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// DELETE /api/notifications/clear
router.delete('/clear', authenticate, (req: Request, res: Response) => {
  db.run('DELETE FROM notifications WHERE user_id = ? AND is_read = 1', [req.user!.id]);
  res.json({ success: true });
});

// DELETE /api/notifications/:id
router.delete('/:id', authenticate, (req: Request, res: Response) => {
  db.run('DELETE FROM notifications WHERE id = ? AND user_id = ?', [req.params.id, req.user!.id]);
  res.json({ success: true });
});

export default router;
