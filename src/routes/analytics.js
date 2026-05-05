/**
 * Analytics Routes
 * GET /analytics/overview    - total engagement summary
 * GET /analytics/posts       - per-post metrics
 * GET /analytics/sync        - refresh metrics from FB API
 * GET /analytics/chart-data  - time-series data for charts
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { authenticate } = require('../middleware/auth');
const facebookService = require('../services/facebookService');

router.use(authenticate);

// ── GET /analytics/overview ──────────────────────────────────────────────────
router.get('/overview', (req, res) => {
  const { days = 30 } = req.query;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const summary = db.prepare(`
    SELECT
      COUNT(DISTINCT p.id)           AS total_posts,
      SUM(a.likes_count)             AS total_likes,
      SUM(a.comments_count)          AS total_comments,
      SUM(a.shares_count)            AS total_shares,
      SUM(a.reach)                   AS total_reach,
      ROUND(AVG(a.likes_count), 1)   AS avg_likes,
      ROUND(AVG(a.comments_count), 1) AS avg_comments
    FROM posts p
    LEFT JOIN analytics a ON p.id = a.post_id
    WHERE p.user_id = ?
      AND p.status = 'published'
      AND p.published_at >= ?
  `).get(req.user.id, since);

  const totalScheduled = db.prepare(`
    SELECT COUNT(*) as count FROM posts
    WHERE user_id = ? AND status = 'scheduled'
  `).get(req.user.id).count;

  const totalFailed = db.prepare(`
    SELECT COUNT(*) as count FROM posts
    WHERE user_id = ? AND status = 'failed'
  `).get(req.user.id).count;

  const unreadInbox = db.prepare(`
    SELECT COUNT(*) as count FROM comments c
    JOIN social_accounts sa ON c.account_id = sa.id
    WHERE sa.user_id = ? AND c.is_read = 0
  `).get(req.user.id).count;

  res.json({
    summary: {
      ...summary,
      scheduled_posts: totalScheduled,
      failed_posts: totalFailed,
      unread_inbox: unreadInbox,
    },
    period_days: Number(days),
  });
});

// ── GET /analytics/posts ─────────────────────────────────────────────────────
router.get('/posts', (req, res) => {
  const { limit = 10, offset = 0 } = req.query;

  const posts = db.prepare(`
    SELECT
      p.id, p.content, p.published_at, p.status,
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
  `).all(req.user.id, Number(limit), Number(offset));

  res.json({ posts });
});

// ── GET /analytics/chart-data ────────────────────────────────────────────────
router.get('/chart-data', (req, res) => {
  const { days = 14, metric = 'engagement' } = req.query;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const rows = db.prepare(`
    SELECT
      DATE(p.published_at) AS date,
      SUM(a.likes_count) AS likes,
      SUM(a.comments_count) AS comments,
      SUM(a.shares_count) AS shares,
      COUNT(p.id) AS post_count,
      SUM(a.likes_count + a.comments_count + a.shares_count) AS engagement
    FROM posts p
    LEFT JOIN analytics a ON p.id = a.post_id
    WHERE p.user_id = ?
      AND p.status = 'published'
      AND p.published_at >= ?
    GROUP BY DATE(p.published_at)
    ORDER BY date ASC
  `).all(req.user.id, since);

  // Per-platform breakdown
  const platformBreakdown = db.prepare(`
    SELECT
      sa.platform,
      COUNT(p.id) AS post_count,
      SUM(a.likes_count) AS total_likes,
      SUM(a.comments_count) AS total_comments
    FROM posts p
    JOIN social_accounts sa ON p.account_id = sa.id
    LEFT JOIN analytics a ON p.id = a.post_id
    WHERE p.user_id = ? AND p.status = 'published'
    GROUP BY sa.platform
  `).all(req.user.id);

  res.json({ daily: rows, platformBreakdown });
});

// ── POST /analytics/sync ─────────────────────────────────────────────────────
router.post('/sync', async (req, res) => {
  // Refresh metrics for recently published posts
  const recentPosts = db.prepare(`
    SELECT p.*, sa.access_token, sa.platform
    FROM posts p
    JOIN social_accounts sa ON p.account_id = sa.id
    WHERE p.user_id = ?
      AND p.status = 'published'
      AND p.platform_post_id IS NOT NULL
      AND p.published_at >= datetime('now', '-7 days')
    ORDER BY p.published_at DESC
    LIMIT 20
  `).all(req.user.id);

  let updated = 0;
  for (const post of recentPosts) {
    try {
      const metrics = await facebookService.fetchPostInsights({
        postId: post.platform_post_id,
        accessToken: post.access_token,
      });

      // Upsert analytics
      const existing = db.prepare('SELECT id FROM analytics WHERE post_id = ?').get(post.id);
      if (existing) {
        db.prepare(`
          UPDATE analytics
          SET likes_count = ?, comments_count = ?, shares_count = ?,
              reach = ?, impressions = ?, recorded_at = CURRENT_TIMESTAMP
          WHERE post_id = ?
        `).run(
          metrics.likes_count, metrics.comments_count, metrics.shares_count,
          metrics.reach, metrics.impressions, post.id
        );
      } else {
        db.prepare(`
          INSERT INTO analytics (id, post_id, likes_count, comments_count, shares_count, reach, impressions)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          uuidv4(), post.id,
          metrics.likes_count, metrics.comments_count, metrics.shares_count,
          metrics.reach, metrics.impressions
        );
      }
      updated++;
    } catch (_) { /* skip individual failures */ }
  }

  res.json({ updated, message: `Synced analytics for ${updated} post(s)` });
});

module.exports = router;
