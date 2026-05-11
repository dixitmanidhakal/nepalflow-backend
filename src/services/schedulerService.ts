/**
 * NepalFlow Scheduler Service
 * Checks for due posts every minute and publishes via Facebook Graph API
 */

import cron from 'node-cron';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/database';
import * as facebookService from './facebookService';
import { Post } from '../types';

interface DuePost extends Post {
  access_token: string;
  fb_page_id: string;
  platform: string;
  account_name: string;
}

let schedulerRunning = false;

/**
 * Fetch all posts that are due for publishing
 */
function getDuePosts(): DuePost[] {
  const now = new Date().toISOString();
  return db.all<DuePost>(`
    SELECT
      p.*,
      sa.access_token,
      sa.account_id AS fb_page_id,
      sa.platform,
      sa.account_name
    FROM posts p
    JOIN social_accounts sa ON p.account_id = sa.id
    WHERE p.status = 'scheduled'
      AND p.scheduled_at <= ?
      AND sa.is_active = 1
    ORDER BY p.scheduled_at ASC
    LIMIT 20
  `, [now]);
}

/**
 * Mark a post as published
 */
function markPublished(postId: string, platformPostId: string): void {
  db.run(`
    UPDATE posts
    SET status = 'published',
        platform_post_id = ?,
        published_at = datetime('now'),
        updated_at = datetime('now')
    WHERE id = ?
  `, [platformPostId, postId]);
}

/**
 * Mark a post as failed
 */
function markFailed(postId: string, errorMessage: string): void {
  db.run(`
    UPDATE posts
    SET status = 'failed',
        error_message = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `, [errorMessage, postId]);
}

/**
 * Process a single due post
 */
async function processPost(post: DuePost): Promise<void> {
  try {
    console.log(`📤 Publishing post ${post.id} to ${post.platform}...`);

    let platformPostId: string | undefined;
    const mediaUrls: string[] = post.media_urls ? JSON.parse(post.media_urls) : [];

    if (post.platform === 'facebook') {
      platformPostId = await facebookService.publishToFacebookPage({
        pageId: post.fb_page_id,
        accessToken: post.access_token,
        message: post.content,
        mediaUrls,
      });
    } else if (post.platform === 'instagram') {
      platformPostId = await facebookService.publishToInstagram({
        igAccountId: post.fb_page_id,
        accessToken: post.access_token,
        caption: post.content,
        mediaUrls,
      });
    }

    if (platformPostId) {
      markPublished(post.id, platformPostId);
      console.log(`✅ Post ${post.id} published successfully. Platform ID: ${platformPostId}`);

      // Seed initial analytics row
      db.run(`
        INSERT INTO analytics (id, post_id, likes_count, comments_count, shares_count)
        VALUES (?, ?, 0, 0, 0)
      `, [uuidv4(), post.id]);
    }

  } catch (error: unknown) {
    const err = error as Error;
    console.error(`❌ Failed to publish post ${post.id}:`, err.message);
    markFailed(post.id, err.message);
  }
}

/**
 * Main scheduler tick - runs every minute
 */
async function runSchedulerTick(): Promise<void> {
  if (schedulerRunning) return;
  schedulerRunning = true;

  try {
    const duePosts = getDuePosts();
    if (duePosts.length > 0) {
      console.log(`⏰ Scheduler: Found ${duePosts.length} due post(s)`);
      for (const post of duePosts) {
        await processPost(post);
      }
    }
  } catch (error: unknown) {
    console.error('Scheduler error:', error);
  } finally {
    schedulerRunning = false;
  }
}

/**
 * Start the cron scheduler
 */
export function startScheduler(): void {
  const interval = process.env.SCHEDULER_INTERVAL || '1';
  console.log(`🚀 Starting post scheduler (every ${interval} minute(s))`);

  cron.schedule(`*/${interval} * * * *`, runSchedulerTick);

  // Run once immediately on startup
  runSchedulerTick();
}

/**
 * Schedule a new post (insert into DB)
 */
export function schedulePost({
  userId,
  accountId,
  content,
  mediaUrls = [],
  scheduledAt,
  hashtags = [],
}: {
  userId: string;
  accountId: string;
  content: string;
  mediaUrls?: string[];
  scheduledAt: string;
  hashtags?: string[];
}): Post {
  const id = uuidv4();
  db.run(`
    INSERT INTO posts (id, user_id, account_id, content, media_urls, scheduled_at, hashtags, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled')
  `, [id, userId, accountId, content, JSON.stringify(mediaUrls), scheduledAt, JSON.stringify(hashtags)]);

  return db.get<Post>('SELECT * FROM posts WHERE id = ?', [id])!;
}

export { runSchedulerTick, getDuePosts };
