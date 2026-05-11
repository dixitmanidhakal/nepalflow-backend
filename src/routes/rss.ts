/**
 * RSS Feed Auto-Poster Routes
 */
import express, { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import db from '../db/database';
import { authenticate } from '../middleware/auth';
import { RssFeed } from '../types';

const router = express.Router();

function tryParse<T>(str: string, fb: T): T { try { return JSON.parse(str) as T; } catch { return fb; } }

interface RssItem {
  id: string;
  title: string;
  description: string;
  link: string;
  pub_date: string;
}

interface ParsedFeed {
  title: string;
  items: RssItem[];
}

// Minimal RSS parser
async function parseRSSFeed(url: string): Promise<ParsedFeed> {
  const res = await axios.get(url, {
    timeout: 20000,
    maxRedirects: 5,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NepalFlow RSS Reader 1.0)', 'Accept': 'application/rss+xml,application/xml,text/xml,*/*' },
  });
  const xml = res.data as string;
  const items: RssItem[] = [];
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(xml)) !== null && items.length < 20) {
    const block = m[1];
    const get = (tag: string): string => {
      const r = new RegExp(`<${tag}[^>]*>\\s*(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?\\s*<\/${tag}>`, 'si');
      const match = r.exec(block);
      return match ? match[1].replace(/<[^>]+>/g, '').trim() : '';
    };
    items.push({
      id: get('guid') || get('link'),
      title: get('title'),
      description: get('description').substring(0, 300),
      link: get('link'),
      pub_date: get('pubDate'),
    });
  }
  const titleMatch = /<channel[^>]*>[\s\S]*?<title[^>]*>(.*?)<\/title>/i.exec(xml);
  return { title: titleMatch ? titleMatch[1].trim() : url, items };
}

// GET /api/rss
router.get('/', authenticate, (req: Request, res: Response) => {
  const feeds = db.all<RssFeed>(
    `SELECT r.*, sa.account_name FROM rss_feeds r
     LEFT JOIN social_accounts sa ON r.account_id = sa.id
     WHERE r.user_id = ? ORDER BY r.created_at DESC`,
    [req.user!.id]
  );
  res.json({ feeds: feeds.map(f => ({ ...f, hashtags: tryParse<string[]>(f.hashtags, []) })) });
});

// POST /api/rss
router.post('/', authenticate, async (req: Request, res: Response) => {
  const { name, feed_url, account_id, auto_post = false, post_template, hashtags = [] } = req.body as {
    name?: string;
    feed_url?: string;
    account_id?: string;
    auto_post?: boolean;
    post_template?: string;
    hashtags?: string[];
  };
  if (!name?.trim()) return res.status(400).json({ error: 'Feed name is required' });
  if (!feed_url?.trim()) return res.status(400).json({ error: 'Feed URL is required' });

  try {
    const data = await parseRSSFeed(feed_url);
    if (!data.items.length) return res.status(400).json({ error: 'No items found in this RSS feed' });
  } catch (err: unknown) {
    return res.status(400).json({ error: `Cannot fetch RSS feed: ${(err as Error).message}` });
  }

  const id = uuidv4();
  db.run(
    `INSERT INTO rss_feeds (id, user_id, account_id, name, feed_url, auto_post, post_template, hashtags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, req.user!.id, account_id || null, name.trim(), feed_url.trim(),
     auto_post ? 1 : 0,
     post_template || '{{title}}\n\n{{link}}',
     JSON.stringify(hashtags)]
  );
  const feed = db.get<RssFeed>('SELECT * FROM rss_feeds WHERE id = ?', [id]);
  res.status(201).json({ feed: { ...feed, hashtags: tryParse<string[]>(feed!.hashtags, []) } });
});

// PUT /api/rss/:id
router.put('/:id', authenticate, (req: Request, res: Response) => {
  const feed = db.get('SELECT id FROM rss_feeds WHERE id = ? AND user_id = ?', [req.params.id, req.user!.id]);
  if (!feed) return res.status(404).json({ error: 'Feed not found' });
  const { name, account_id, auto_post, post_template, hashtags } = req.body as {
    name?: string;
    account_id?: string | null;
    auto_post?: boolean;
    post_template?: string;
    hashtags?: string[];
  };
  const updates: string[] = [];
  const params: unknown[] = [];
  if (name !== undefined)          { updates.push('name = ?');          params.push(name); }
  if (account_id !== undefined)    { updates.push('account_id = ?');    params.push(account_id || null); }
  if (auto_post !== undefined)     { updates.push('auto_post = ?');     params.push(auto_post ? 1 : 0); }
  if (post_template !== undefined) { updates.push('post_template = ?'); params.push(post_template); }
  if (hashtags !== undefined)      { updates.push('hashtags = ?');      params.push(JSON.stringify(hashtags)); }
  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
  params.push(req.params.id);
  db.run(`UPDATE rss_feeds SET ${updates.join(', ')} WHERE id = ?`, params);
  const updated = db.get<RssFeed>('SELECT * FROM rss_feeds WHERE id = ?', [req.params.id]);
  res.json({ feed: { ...updated, hashtags: tryParse<string[]>(updated!.hashtags, []) } });
});

// DELETE /api/rss/:id
router.delete('/:id', authenticate, (req: Request, res: Response) => {
  db.run('DELETE FROM rss_feeds WHERE id = ? AND user_id = ?', [req.params.id, req.user!.id]);
  res.json({ success: true });
});

// PATCH /api/rss/:id/toggle
router.patch('/:id/toggle', authenticate, (req: Request, res: Response) => {
  const feed = db.get<RssFeed>('SELECT * FROM rss_feeds WHERE id = ? AND user_id = ?', [req.params.id, req.user!.id]);
  if (!feed) return res.status(404).json({ error: 'Feed not found' });
  const newState = feed.is_active ? 0 : 1;
  db.run('UPDATE rss_feeds SET is_active = ? WHERE id = ?', [newState, feed.id]);
  res.json({ is_active: newState });
});

// POST /api/rss/:id/fetch
router.post('/:id/fetch', authenticate, async (req: Request, res: Response) => {
  const feed = db.get<RssFeed>('SELECT * FROM rss_feeds WHERE id = ? AND user_id = ?', [req.params.id, req.user!.id]);
  if (!feed) return res.status(404).json({ error: 'Feed not found' });
  try {
    const data = await parseRSSFeed(feed.feed_url);
    db.run("UPDATE rss_feeds SET last_fetched = datetime('now'), fetch_count = fetch_count + 1 WHERE id = ?", [feed.id]);
    res.json({ feed_title: data.title, items: data.items.slice(0, 10), last_fetched: new Date().toISOString() });
  } catch (err: unknown) {
    res.status(500).json({ error: `Failed to fetch RSS: ${(err as Error).message}` });
  }
});

// POST /api/rss/:id/post-item
router.post('/:id/post-item', authenticate, async (req: Request, res: Response) => {
  const feed = db.get<RssFeed>('SELECT * FROM rss_feeds WHERE id = ? AND user_id = ?', [req.params.id, req.user!.id]);
  if (!feed) return res.status(404).json({ error: 'Feed not found' });
  if (!feed.account_id) return res.status(400).json({ error: 'No account linked to this feed' });

  const { item_title, item_link, item_description = '', scheduled_at } = req.body as {
    item_title?: string;
    item_link?: string;
    item_description?: string;
    scheduled_at?: string;
  };
  if (!item_title || !item_link) return res.status(400).json({ error: 'Item title and link are required' });
  if (!scheduled_at) return res.status(400).json({ error: 'Scheduled time is required' });

  let content = (feed.post_template || '{{title}}\n\n{{link}}')
    .replace(/{{title}}/g, item_title)
    .replace(/{{link}}/g, item_link)
    .replace(/{{description}}/g, item_description);

  const hashtags = tryParse<string[]>(feed.hashtags, []);
  if (hashtags.length) content += '\n\n' + hashtags.join(' ');

  const id = uuidv4();
  db.run(
    `INSERT INTO posts (id, user_id, account_id, content, hashtags, scheduled_at, status)
     VALUES (?, ?, ?, ?, ?, ?, 'scheduled')`,
    [id, req.user!.id, feed.account_id, content, JSON.stringify(hashtags), new Date(scheduled_at).toISOString()]
  );
  const post = db.get('SELECT * FROM posts WHERE id = ?', [id]);
  res.status(201).json({ post, message: 'RSS item scheduled as a post' });
});

export default router;
