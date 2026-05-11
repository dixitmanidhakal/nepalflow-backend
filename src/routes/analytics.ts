/**
 * Analytics Routes
 */
import express, { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/database';
import { authenticate } from '../middleware/auth';
import * as facebookService from '../services/facebookService';

const router = express.Router();

router.use(authenticate);

// GET /analytics/overview
router.get('/overview', (req: Request, res: Response) => {
  const days = Number(req.query.days) || 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const summary = db.get(`
    SELECT
      COUNT(DISTINCT p.id) AS total_posts,
      SUM(a.likes_count) AS total_likes,
      SUM(a.comments_count) AS total_comments,
      SUM(a.shares_count) AS total_shares,
      SUM(a.reach) AS total_reach,
      ROUND(AVG(a.likes_count), 1) AS avg_likes,
      ROUND(AVG(a.comments_count), 1) AS avg_comments
    FROM posts p
    LEFT JOIN analytics a ON p.id = a.post_id
    WHERE p.user_id = ? AND p.status = 'published' AND p.published_at >= ?
  `, [req.user!.id, since]);

  const scheduled = db.get<{ count: number }>('SELECT COUNT(*) as count FROM posts WHERE user_id = ? AND status = ?', [req.user!.id, 'scheduled']);
  const failed = db.get<{ count: number }>('SELECT COUNT(*) as count FROM posts WHERE user_id = ? AND status = ?', [req.user!.id, 'failed']);
  const unread = db.get<{ count: number }>(
    'SELECT COUNT(*) as count FROM comments c JOIN social_accounts sa ON c.account_id = sa.id WHERE sa.user_id = ? AND c.is_read = 0',
    [req.user!.id]
  );

  res.json({
    summary: {
      ...(summary || {}),
      scheduled_posts: scheduled ? scheduled.count : 0,
      failed_posts: failed ? failed.count : 0,
      unread_inbox: unread ? unread.count : 0,
    },
    period_days: days,
  });
});

// GET /analytics/posts
router.get('/posts', (req: Request, res: Response) => {
  const limit = Number(req.query.limit) || 10;
  const offset = Number(req.query.offset) || 0;
  const posts = db.all(`
    SELECT p.id, p.content, p.published_at, p.status,
           sa.platform, sa.account_name,
           COALESCE(a.likes_count, 0) AS likes,
           COALESCE(a.comments_count, 0) AS comments,
           COALESCE(a.shares_count, 0) AS shares,
           COALESCE(a.reach, 0) AS reach,
           COALESCE(a.impressions, 0) AS impressions,
           (COALESCE(a.likes_count,0) + COALESCE(a.comments_count,0) + COALESCE(a.shares_count,0)) AS engagement
    FROM posts p
    JOIN social_accounts sa ON p.account_id = sa.id
    LEFT JOIN analytics a ON p.id = a.post_id
    WHERE p.user_id = ? AND p.status = 'published'
    ORDER BY engagement DESC, p.published_at DESC
    LIMIT ? OFFSET ?
  `, [req.user!.id, limit, offset]);
  res.json({ posts });
});

// GET /analytics/chart-data
router.get('/chart-data', (req: Request, res: Response) => {
  const days = Number(req.query.days) || 14;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const daily = db.all(`
    SELECT DATE(p.published_at) AS date,
           SUM(a.likes_count) AS likes,
           SUM(a.comments_count) AS comments,
           SUM(a.shares_count) AS shares,
           COUNT(p.id) AS post_count,
           SUM(a.likes_count + a.comments_count + a.shares_count) AS engagement
    FROM posts p
    LEFT JOIN analytics a ON p.id = a.post_id
    WHERE p.user_id = ? AND p.status = 'published' AND p.published_at >= ?
    GROUP BY DATE(p.published_at)
    ORDER BY date ASC
  `, [req.user!.id, since]);

  const platformBreakdown = db.all(`
    SELECT sa.platform, COUNT(p.id) AS post_count,
           SUM(a.likes_count) AS total_likes,
           SUM(a.comments_count) AS total_comments
    FROM posts p
    JOIN social_accounts sa ON p.account_id = sa.id
    LEFT JOIN analytics a ON p.id = a.post_id
    WHERE p.user_id = ? AND p.status = 'published'
    GROUP BY sa.platform
  `, [req.user!.id]);

  res.json({ daily, platformBreakdown });
});

// POST /analytics/sync
router.post('/sync', async (req: Request, res: Response) => {
  const recentPosts = db.all(`
    SELECT p.*, sa.access_token, sa.platform
    FROM posts p JOIN social_accounts sa ON p.account_id = sa.id
    WHERE p.user_id = ? AND p.status = 'published' AND p.platform_post_id IS NOT NULL
      AND p.published_at >= datetime('now', '-7 days')
    ORDER BY p.published_at DESC LIMIT 20
  `, [req.user!.id]) as Array<{ id: string; platform_post_id: string; access_token: string }>;

  let updated = 0;
  for (const post of recentPosts) {
    try {
      const metrics = await facebookService.fetchPostInsights({ postId: post.platform_post_id, accessToken: post.access_token });
      const existing = db.get<{ id: string }>('SELECT id FROM analytics WHERE post_id = ?', [post.id]);
      if (existing) {
        db.run(
          "UPDATE analytics SET likes_count = ?, comments_count = ?, shares_count = ?, reach = ?, impressions = ?, recorded_at = datetime('now') WHERE post_id = ?",
          [metrics.likes_count, metrics.comments_count, metrics.shares_count, metrics.reach, metrics.impressions, post.id]
        );
      } else {
        db.run(
          'INSERT INTO analytics (id, post_id, likes_count, comments_count, shares_count, reach, impressions) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [uuidv4(), post.id, metrics.likes_count, metrics.comments_count, metrics.shares_count, metrics.reach, metrics.impressions]
        );
      }
      updated++;
    } catch (_) {}
  }
  res.json({ updated, message: 'Synced analytics for ' + updated + ' post(s)' });
});

export default router;
