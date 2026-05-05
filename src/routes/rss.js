/**
 * RSS Feed Auto-Poster Routes
 * GET    /api/rss              - list feeds
 * POST   /api/rss              - add feed
 * PUT    /api/rss/:id          - update feed
 * DELETE /api/rss/:id          - delete feed
 * PATCH  /api/rss/:id/toggle   - activate/pause
 * POST   /api/rss/:id/fetch    - manually fetch + preview items
 * POST   /api/rss/:id/post-item - post a specific RSS item
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const db = require('../db/database');
const { authenticate } = require('../middleware/auth');

function tryParse(str, fb) { try { return JSON.parse(str); } catch { return fb; } }

// Minimal RSS parser (no npm dep needed)
async function parseRSSFeed(url) {
  const res = await axios.get(url, {
    timeout: 10000,
    headers: { 'User-Agent': 'NepalFlow RSS Reader 1.0', 'Accept': 'application/rss+xml,application/xml,text/xml' },
  });
  const xml = res.data;
  const items = [];
  // Extract <item> blocks
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRegex.exec(xml)) !== null && items.length < 20) {
    const block = m[1];
    const get = (tag) => {
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
router.get('/', authenticate, (req, res) => {
  const feeds = db.all(
    `SELECT r.*, sa.account_name FROM rss_feeds r
     LEFT JOIN social_accounts sa ON r.account_id = sa.id
     WHERE r.user_id = ? ORDER BY r.created_at DESC`,
    [req.user.id]
  );
  res.json({ feeds: feeds.map(f => ({ ...f, hashtags: tryParse(f.hashtags, []) })) });
});

// POST /api/rss
router.post('/', authenticate, async (req, res) => {
  const { name, feed_url, account_id, auto_post = false, post_template, hashtags = [] } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Feed name is required' });
  if (!feed_url?.trim()) return res.status(400).json({ error: 'Feed URL is required' });

  // Validate the URL is reachable
  try {
    const data = await parseRSSFeed(feed_url);
    if (!data.items.length) return res.status(400).json({ error: 'No items found in this RSS feed' });
  } catch (err) {
    return res.status(400).json({ error: `Cannot fetch RSS feed: ${err.message}` });
  }

  const id = uuidv4();
  db.run(
    `INSERT INTO rss_feeds (id, user_id, account_id, name, feed_url, auto_post, post_template, hashtags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, req.user.id, account_id || null, name.trim(), feed_url.trim(),
     auto_post ? 1 : 0,
     post_template || '{{title}}\n\n{{link}}',
     JSON.stringify(hashtags)]
  );
  const feed = db.get('SELECT * FROM rss_feeds WHERE id = ?', [id]);
  res.status(201).json({ feed: { ...feed, hashtags: tryParse(feed.hashtags, []) } });
});

// PUT /api/rss/:id
router.put('/:id', authenticate, (req, res) => {
  const feed = db.get('SELECT id FROM rss_feeds WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!feed) return res.status(404).json({ error: 'Feed not found' });
  const { name, account_id, auto_post, post_template, hashtags } = req.body;
  const updates = []; const params = [];
  if (name !== undefined)          { updates.push('name = ?');          params.push(name); }
  if (account_id !== undefined)    { updates.push('account_id = ?');    params.push(account_id || null); }
  if (auto_post !== undefined)     { updates.push('auto_post = ?');     params.push(auto_post ? 1 : 0); }
  if (post_template !== undefined) { updates.push('post_template = ?'); params.push(post_template); }
  if (hashtags !== undefined)      { updates.push('hashtags = ?');      params.push(JSON.stringify(hashtags)); }
  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
  params.push(req.params.id);
  db.run(`UPDATE rss_feeds SET ${updates.join(', ')} WHERE id = ?`, params);
  const updated = db.get('SELECT * FROM rss_feeds WHERE id = ?', [req.params.id]);
  res.json({ feed: { ...updated, hashtags: tryParse(updated.hashtags, []) } });
});

// DELETE /api/rss/:id
router.delete('/:id', authenticate, (req, res) => {
  db.run('DELETE FROM rss_feeds WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  res.json({ success: true });
});

// PATCH /api/rss/:id/toggle
router.patch('/:id/toggle', authenticate, (req, res) => {
  const feed = db.get('SELECT * FROM rss_feeds WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!feed) return res.status(404).json({ error: 'Feed not found' });
  const newState = feed.is_active ? 0 : 1;
  db.run('UPDATE rss_feeds SET is_active = ? WHERE id = ?', [newState, feed.id]);
  res.json({ is_active: newState });
});

// POST /api/rss/:id/fetch — fetch and preview latest items
router.post('/:id/fetch', authenticate, async (req, res) => {
  const feed = db.get('SELECT * FROM rss_feeds WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!feed) return res.status(404).json({ error: 'Feed not found' });
  try {
    const data = await parseRSSFeed(feed.feed_url);
    db.run("UPDATE rss_feeds SET last_fetched = datetime('now'), fetch_count = fetch_count + 1 WHERE id = ?", [feed.id]);
    res.json({ feed_title: data.title, items: data.items.slice(0, 10), last_fetched: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: `Failed to fetch RSS: ${err.message}` });
  }
});

// POST /api/rss/:id/post-item — schedule a specific RSS item as a post
router.post('/:id/post-item', authenticate, async (req, res) => {
  const feed = db.get('SELECT * FROM rss_feeds WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!feed) return res.status(404).json({ error: 'Feed not found' });
  if (!feed.account_id) return res.status(400).json({ error: 'No account linked to this feed' });

  const { item_title, item_link, item_description = '', scheduled_at } = req.body;
  if (!item_title || !item_link) return res.status(400).json({ error: 'Item title and link are required' });
  if (!scheduled_at) return res.status(400).json({ error: 'Scheduled time is required' });

  // Render template
  let content = (feed.post_template || '{{title}}\n\n{{link}}')
    .replace(/{{title}}/g, item_title)
    .replace(/{{link}}/g, item_link)
    .replace(/{{description}}/g, item_description);

  const hashtags = tryParse(feed.hashtags, []);
  if (hashtags.length) content += '\n\n' + hashtags.join(' ');

  const id = uuidv4();
  db.run(
    `INSERT INTO posts (id, user_id, account_id, content, hashtags, scheduled_at, status)
     VALUES (?, ?, ?, ?, ?, ?, 'scheduled')`,
    [id, req.user.id, feed.account_id, content, JSON.stringify(hashtags), new Date(scheduled_at).toISOString()]
  );
  const post = db.get('SELECT * FROM posts WHERE id = ?', [id]);
  res.status(201).json({ post, message: 'RSS item scheduled as a post' });
});

module.exports = router;
