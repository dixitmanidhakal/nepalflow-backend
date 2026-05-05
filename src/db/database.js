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

const { Database } = require('node-sqlite3-wasm');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../db/nepalflow.sqlite');

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

/**
 * Initialize all tables
 */
function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,
      email       TEXT UNIQUE NOT NULL,
      name        TEXT NOT NULL,
      avatar_url  TEXT,
      provider    TEXT NOT NULL DEFAULT 'local',
      provider_id TEXT,
      language    TEXT NOT NULL DEFAULT 'en',
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
      scheduled_at     TEXT NOT NULL,
      published_at     TEXT,
      error_message    TEXT,
      hashtags         TEXT,
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
      recorded_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_posts_user_id    ON posts(user_id);
    CREATE INDEX IF NOT EXISTS idx_posts_status     ON posts(status);
    CREATE INDEX IF NOT EXISTS idx_posts_scheduled  ON posts(scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_comments_acct    ON comments(account_id);
    CREATE INDEX IF NOT EXISTS idx_comments_read    ON comments(is_read);
    CREATE INDEX IF NOT EXISTS idx_analytics_post   ON analytics(post_id);
  `);

  console.log('✅ Database initialized:', DB_PATH);
}

initializeDatabase();

module.exports = db;
