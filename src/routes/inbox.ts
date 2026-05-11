/**
 * Unified Inbox Routes
 */
import express, { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/database';
import { authenticate } from '../middleware/auth';
import * as facebookService from '../services/facebookService';
import { Comment, SocialAccount } from '../types';

const router = express.Router();

router.use(authenticate);

// GET /inbox
router.get('/', (req: Request, res: Response) => {
  const { platform, is_read, comment_type, limit = 30, offset = 0 } = req.query as Record<string, string | undefined>;
  let sql = `
    SELECT c.*, sa.platform, sa.account_name, sa.profile_pic as page_pic, p.content as post_content
    FROM comments c
    JOIN social_accounts sa ON c.account_id = sa.id
    LEFT JOIN posts p ON c.post_id = p.id
    WHERE sa.user_id = ?
  `;
  const params: unknown[] = [req.user!.id];
  if (platform) { sql += ' AND sa.platform = ?'; params.push(platform); }
  if (is_read !== undefined) { sql += ' AND c.is_read = ?'; params.push(Number(is_read)); }
  if (comment_type) { sql += ' AND c.comment_type = ?'; params.push(comment_type); }
  sql += ' ORDER BY c.platform_time DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));

  const comments = db.all(sql, params);
  const totalRow = db.get<{ count: number }>(
    'SELECT COUNT(*) as count FROM comments c JOIN social_accounts sa ON c.account_id = sa.id WHERE sa.user_id = ?',
    [req.user!.id]
  );
  res.json({ comments, total: totalRow ? totalRow.count : 0 });
});

// GET /inbox/unread-count
router.get('/unread-count', (req: Request, res: Response) => {
  const result = db.get<{ count: number }>(
    'SELECT COUNT(*) as count FROM comments c JOIN social_accounts sa ON c.account_id = sa.id WHERE sa.user_id = ? AND c.is_read = 0',
    [req.user!.id]
  );
  res.json({ unread: result ? result.count : 0 });
});

// POST /inbox/sync
router.post('/sync', async (req: Request, res: Response) => {
  const accounts = db.all<SocialAccount>(
    'SELECT * FROM social_accounts WHERE user_id = ? AND is_active = 1',
    [req.user!.id]
  );
  if (accounts.length === 0) {
    return res.status(400).json({ error: 'No active social accounts found' });
  }
  const synced = { comments: 0, dms: 0, errors: [] as Array<{ account: string; error: string }> };
  for (const account of accounts) {
    try {
      if (account.platform === 'facebook') {
        const comments = await facebookService.fetchPageComments({
          pageId: account.account_id,
          accessToken: account.access_token,
        });
        for (const c of comments) {
          const post = db.get<{ id: string }>('SELECT id FROM posts WHERE platform_post_id = ?', [c.post_platform_id]);
          const existing = db.get('SELECT id FROM comments WHERE platform_comment_id = ?', [c.platform_comment_id]);
          if (!existing) {
            db.run(
              `INSERT INTO comments (id, account_id, post_id, platform_comment_id, commenter_name, commenter_id, message, comment_type, platform_time)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'comment', ?)`,
              [uuidv4(), account.id, post ? post.id : null, c.platform_comment_id, c.commenter_name, c.commenter_id, c.message, c.platform_time]
            );
            synced.comments++;
          }
        }
        const dms = await facebookService.fetchPageDMs({
          pageId: account.account_id,
          accessToken: account.access_token,
        });
        for (const dm of dms) {
          const existing = db.get('SELECT id FROM comments WHERE platform_comment_id = ?', [dm.platform_comment_id]);
          if (!existing) {
            db.run(
              `INSERT INTO comments (id, account_id, platform_comment_id, commenter_name, commenter_id, message, comment_type, platform_time)
               VALUES (?, ?, ?, ?, ?, ?, 'dm', ?)`,
              [uuidv4(), account.id, dm.platform_comment_id, dm.commenter_name, dm.commenter_id, dm.message, dm.platform_time]
            );
            synced.dms++;
          }
        }
      }
    } catch (error: unknown) {
      const err = error as Error;
      console.error('Sync error:', err.message);
      synced.errors.push({ account: account.account_name, error: err.message });
    }
  }
  res.json({ synced, message: `Synced ${synced.comments} comments, ${synced.dms} DMs` });
});

// PATCH /inbox/:id/read
router.patch('/:id/read', (req: Request, res: Response) => {
  const comment = db.get<Comment>(
    'SELECT c.* FROM comments c JOIN social_accounts sa ON c.account_id = sa.id WHERE c.id = ? AND sa.user_id = ?',
    [req.params.id, req.user!.id]
  );
  if (!comment) return res.status(404).json({ error: 'Comment not found' });
  db.run('UPDATE comments SET is_read = 1 WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// PATCH /inbox/mark-all-read
router.patch('/mark-all-read', (req: Request, res: Response) => {
  db.run(
    'UPDATE comments SET is_read = 1 WHERE account_id IN (SELECT id FROM social_accounts WHERE user_id = ?)',
    [req.user!.id]
  );
  res.json({ success: true });
});

// POST /inbox/:id/reply
router.post('/:id/reply', async (req: Request, res: Response) => {
  const { message } = req.body as { message: string };
  if (!message || !message.trim()) return res.status(400).json({ error: 'message is required' });
  const comment = db.get(
    'SELECT c.*, sa.access_token, sa.platform FROM comments c JOIN social_accounts sa ON c.account_id = sa.id WHERE c.id = ? AND sa.user_id = ?',
    [req.params.id, req.user!.id]
  ) as (Comment & { access_token: string; platform: string }) | undefined;
  if (!comment) return res.status(404).json({ error: 'Comment not found' });
  try {
    await facebookService.replyToComment({
      commentId: comment.platform_comment_id!.replace('dm_', ''),
      message,
      accessToken: comment.access_token,
    });
    db.run(
      'UPDATE comments SET is_replied = 1, reply_text = ?, is_read = 1 WHERE id = ?',
      [message, req.params.id]
    );
    res.json({ success: true, message: 'Reply sent successfully' });
  } catch (error: unknown) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
