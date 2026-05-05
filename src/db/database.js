/**
 * NepalFlow - SQLite Database Setup & Schema
 * Tables: users, social_accounts, posts, comments, analytics
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../db/nepalflow.sqlite');

// Ensure db directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * Initialize all tables
 */
function initializeDatabase() {
  db.exec(`
    -- Users table: Nepali SMB owners
    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      email       TEXT UNIQUE NOT NULL,
      name        TEXT NOT NULL,
      avatar_url  TEXT,
      provider    TEXT NOT NULL DEFAULT 'local',  -- 'google' | 'facebook' | 'local'
      provider_id TEXT,
      language    TEXT NOT NULL DEFAULT 'en',     -- 'en' | 'ne'
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Social accounts: FB pages / Instagram accounts linked to a user
    CREATE TABLE IF NOT EXISTS social_accounts (
      id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      platform        TEXT NOT NULL,              -- 'facebook' | 'instagram'
      account_id      TEXT NOT NULL,              -- Platform's page/account ID
      account_name    TEXT NOT NULL,
      access_token    TEXT NOT NULL,              -- Long-lived page token
      token_expires   DATETIME,
      profile_pic     TEXT,
      is_active       INTEGER NOT NULL DEFAULT 1,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, platform, account_id)
    );

    -- Posts: scheduled or published content
    CREATE TABLE IF NOT EXISTS posts (
      id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      account_id      TEXT NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
      content         TEXT NOT NULL,
      media_urls      TEXT,                       -- JSON array of image/video URLs
      platform_post_id TEXT,                      -- ID returned by platform after publishing
      status          TEXT NOT NULL DEFAULT 'scheduled', -- 'scheduled'|'published'|'failed'|'draft'
      scheduled_at    DATETIME NOT NULL,
      published_at    DATETIME,
      error_message   TEXT,
      hashtags        TEXT,                       -- JSON array of hashtags
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Comments / DMs: fetched from social platforms
    CREATE TABLE IF NOT EXISTS comments (
      id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      post_id         TEXT REFERENCES posts(id) ON DELETE CASCADE,
      account_id      TEXT NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
      platform_comment_id TEXT UNIQUE,
      commenter_name  TEXT NOT NULL,
      commenter_id    TEXT,
      commenter_pic   TEXT,
      message         TEXT NOT NULL,
      comment_type    TEXT NOT NULL DEFAULT 'comment', -- 'comment' | 'dm' | 'mention'
      is_read         INTEGER NOT NULL DEFAULT 0,
      is_replied      INTEGER NOT NULL DEFAULT 0,
      reply_text      TEXT,
      platform_time   DATETIME,
      fetched_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Analytics: post metrics snapshot
    CREATE TABLE IF NOT EXISTS analytics (
      id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      post_id         TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      likes_count     INTEGER DEFAULT 0,
      comments_count  INTEGER DEFAULT 0,
      shares_count    INTEGER DEFAULT 0,
      reach           INTEGER DEFAULT 0,
      impressions     INTEGER DEFAULT 0,
      recorded_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Indexes for performance
    CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id);
    CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
    CREATE INDEX IF NOT EXISTS idx_posts_scheduled_at ON posts(scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_comments_account_id ON comments(account_id);
    CREATE INDEX IF NOT EXISTS idx_comments_is_read ON comments(is_read);
    CREATE INDEX IF NOT EXISTS idx_analytics_post_id ON analytics(post_id);
  `);

  console.log('✅ Database initialized successfully');
}

initializeDatabase();

module.exports = db;
