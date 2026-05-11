/**
 * NepalFlow - SQLite Database Setup & Schema
 * Uses node-sqlite3-wasm (pure WASM, works on Node 23+, no native build needed)
 *
 * API:
 *   db.run(sql, [params])   → {changes, lastInsertRowid}
 *   db.get(sql, [params])   → first row object or undefined
 *   db.all(sql, [params])   → array of row objects
 *   db.exec(sql)            → multiple statements
 */

import { Database } from 'node-sqlite3-wasm';
import path from 'path';
import fs from 'fs';

const DB_PATH: string = process.env.DB_PATH || path.join(__dirname, '../../db/nepalflow.sqlite');

// Ensure db directory exists
if (DB_PATH !== ':memory:') {
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
}

const db = new Database(DB_PATH);

// Enable WAL and foreign keys
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

function initializeDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,
      email       TEXT UNIQUE NOT NULL,
      name        TEXT NOT NULL,
      avatar_url  TEXT,
      provider    TEXT NOT NULL DEFAULT 'local',
      provider_id TEXT,
      language    TEXT NOT NULL DEFAULT 'en',
      timezone    TEXT DEFAULT 'Asia/Kathmandu',
      bio         TEXT,
      website     TEXT,
      fb_access_token TEXT,
      created_at  TEXT DEFAULT (datetime('now')),
      updated_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS social_accounts (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      platform        TEXT NOT NULL,
      account_id      TEXT NOT NULL,
      account_name    TEXT NOT NULL,
      access_token    TEXT NOT NULL,
      token_expires   TEXT,
      profile_pic     TEXT,
      followers_count INTEGER DEFAULT 0,
      is_active       INTEGER NOT NULL DEFAULT 1,
      created_at      TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, platform, account_id)
    );

    CREATE TABLE IF NOT EXISTS posts (
      id               TEXT PRIMARY KEY,
      user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      account_id       TEXT NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
      content          TEXT NOT NULL,
      media_urls       TEXT,
      platform_post_id TEXT,
      status           TEXT NOT NULL DEFAULT 'scheduled',
      approval_status  TEXT DEFAULT 'approved',
      scheduled_at     TEXT NOT NULL,
      published_at     TEXT,
      error_message    TEXT,
      hashtags         TEXT,
      template_id      TEXT,
      created_at       TEXT DEFAULT (datetime('now')),
      updated_at       TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS comments (
      id                  TEXT PRIMARY KEY,
      post_id             TEXT REFERENCES posts(id) ON DELETE CASCADE,
      account_id          TEXT NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
      platform_comment_id TEXT UNIQUE,
      commenter_name      TEXT NOT NULL,
      commenter_id        TEXT,
      commenter_pic       TEXT,
      message             TEXT NOT NULL,
      comment_type        TEXT NOT NULL DEFAULT 'comment',
      is_read             INTEGER NOT NULL DEFAULT 0,
      is_replied          INTEGER NOT NULL DEFAULT 0,
      reply_text          TEXT,
      auto_replied        INTEGER DEFAULT 0,
      platform_time       TEXT,
      fetched_at          TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS analytics (
      id             TEXT PRIMARY KEY,
      post_id        TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      likes_count    INTEGER DEFAULT 0,
      comments_count INTEGER DEFAULT 0,
      shares_count   INTEGER DEFAULT 0,
      reach          INTEGER DEFAULT 0,
      impressions    INTEGER DEFAULT 0,
      clicks         INTEGER DEFAULT 0,
      saves          INTEGER DEFAULT 0,
      recorded_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS templates (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      description TEXT,
      content     TEXT NOT NULL,
      platforms   TEXT DEFAULT '["facebook","instagram"]',
      hashtags    TEXT DEFAULT '[]',
      category    TEXT DEFAULT 'general',
      is_public   INTEGER DEFAULT 0,
      use_count   INTEGER DEFAULT 0,
      created_at  TEXT DEFAULT (datetime('now')),
      updated_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS auto_responders (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      account_id   TEXT REFERENCES social_accounts(id) ON DELETE CASCADE,
      name         TEXT NOT NULL,
      trigger_type TEXT NOT NULL DEFAULT 'keyword',
      keywords     TEXT NOT NULL DEFAULT '[]',
      response     TEXT NOT NULL,
      platforms    TEXT DEFAULT '["facebook","instagram"]',
      match_type   TEXT DEFAULT 'any',
      is_active    INTEGER NOT NULL DEFAULT 1,
      match_count  INTEGER DEFAULT 0,
      created_at   TEXT DEFAULT (datetime('now')),
      updated_at   TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type       TEXT NOT NULL DEFAULT 'info',
      title      TEXT NOT NULL,
      message    TEXT,
      link       TEXT,
      icon       TEXT,
      is_read    INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS rss_feeds (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      account_id    TEXT REFERENCES social_accounts(id) ON DELETE SET NULL,
      name          TEXT NOT NULL,
      feed_url      TEXT NOT NULL,
      is_active     INTEGER NOT NULL DEFAULT 1,
      auto_post     INTEGER NOT NULL DEFAULT 0,
      post_template TEXT DEFAULT '{{title}} - {{link}}',
      hashtags      TEXT DEFAULT '[]',
      last_fetched  TEXT,
      last_item_id  TEXT,
      fetch_count   INTEGER DEFAULT 0,
      created_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS hashtag_stats (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      hashtag      TEXT NOT NULL,
      use_count    INTEGER DEFAULT 1,
      total_likes  INTEGER DEFAULT 0,
      total_reach  INTEGER DEFAULT 0,
      avg_likes    REAL DEFAULT 0,
      last_used    TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, hashtag)
    );

    CREATE TABLE IF NOT EXISTS post_queue (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      account_id   TEXT REFERENCES social_accounts(id) ON DELETE CASCADE,
      content      TEXT NOT NULL,
      media_urls   TEXT DEFAULT '[]',
      hashtags     TEXT DEFAULT '[]',
      scheduled_at TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'queued',
      post_id      TEXT REFERENCES posts(id),
      error        TEXT,
      created_at   TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ai_generations (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      prompt       TEXT NOT NULL,
      result       TEXT NOT NULL,
      platform     TEXT,
      tone         TEXT,
      used         INTEGER DEFAULT 0,
      created_at   TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_posts_user_id    ON posts(user_id);
    CREATE INDEX IF NOT EXISTS idx_posts_status     ON posts(status);
    CREATE INDEX IF NOT EXISTS idx_posts_scheduled  ON posts(scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_comments_acct    ON comments(account_id);
    CREATE INDEX IF NOT EXISTS idx_comments_read    ON comments(is_read);
    CREATE INDEX IF NOT EXISTS idx_analytics_post   ON analytics(post_id);
    CREATE INDEX IF NOT EXISTS idx_notif_user       ON notifications(user_id, is_read);
    CREATE INDEX IF NOT EXISTS idx_templates_user   ON templates(user_id);
    CREATE INDEX IF NOT EXISTS idx_autoresponders   ON auto_responders(user_id, is_active);
    CREATE INDEX IF NOT EXISTS idx_hashtag_user     ON hashtag_stats(user_id);
    CREATE INDEX IF NOT EXISTS idx_queue_user       ON post_queue(user_id, status);
  `);

  // Safe migrations for existing DBs
  const migrations: string[] = [
    "ALTER TABLE users ADD COLUMN timezone TEXT DEFAULT 'Asia/Kathmandu'",
    "ALTER TABLE users ADD COLUMN bio TEXT",
    "ALTER TABLE users ADD COLUMN website TEXT",
    "ALTER TABLE users ADD COLUMN fb_access_token TEXT",
    "ALTER TABLE social_accounts ADD COLUMN followers_count INTEGER DEFAULT 0",
    "ALTER TABLE posts ADD COLUMN approval_status TEXT DEFAULT 'approved'",
    "ALTER TABLE posts ADD COLUMN template_id TEXT",
    "ALTER TABLE comments ADD COLUMN auto_replied INTEGER DEFAULT 0",
    "ALTER TABLE analytics ADD COLUMN clicks INTEGER DEFAULT 0",
    "ALTER TABLE analytics ADD COLUMN saves INTEGER DEFAULT 0",
  ];
  for (const sql of migrations) {
    try { db.run(sql, []); } catch { /* column already exists */ }
  }

  console.log('✅ Database initialized:', DB_PATH);
}

initializeDatabase();

// Typed wrapper — node-sqlite3-wasm does not support generic type parameters,
// so we expose our own typed interface on top of the raw Database instance.
interface TypedDatabase {
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): T | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  all<T = Record<string, unknown>>(sql: string, params?: any[]): T[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run(sql: string, params?: any[]): { changes: number; lastInsertRowid: number };
  exec(sql: string): void;
}

const typedDb: TypedDatabase = {
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): T | undefined {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return db.get(sql, params as any) as unknown as T | undefined;
  },
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return db.all(sql, params as any) as unknown as T[];
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run(sql: string, params?: any[]): { changes: number; lastInsertRowid: number } {
    return db.run(sql, params) as { changes: number; lastInsertRowid: number };
  },
  exec(sql: string): void {
    db.exec(sql);
  },
};

export default typedDb;
