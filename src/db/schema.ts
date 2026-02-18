import type Database from 'better-sqlite3';

/**
 * Create all tables, indexes, triggers, and FTS if they don't exist.
 * Safe to call multiple times (all statements use IF NOT EXISTS).
 */
export function ensureSchema(db: Database.Database): void {
  db.exec(`
    -- Core post storage
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      author_handle TEXT NOT NULL,
      author_name TEXT,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      source_url TEXT,
      type TEXT DEFAULT 'post',
      conversation_id TEXT,
      in_reply_to TEXT,
      raw_json TEXT NOT NULL,
      ingested_at TEXT NOT NULL DEFAULT (datetime('now')),
      source TEXT DEFAULT 'bookmark'
    );

    -- Tag associations (many-to-many)
    CREATE TABLE IF NOT EXISTS tags (
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (post_id, tag)
    );

    -- Full-text search index
    CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(
      id UNINDEXED,
      text,
      author_handle,
      author_name,
      content=posts,
      content_rowid=rowid
    );

    -- Triggers to keep FTS in sync
    CREATE TRIGGER IF NOT EXISTS posts_ai AFTER INSERT ON posts BEGIN
      INSERT INTO posts_fts(rowid, id, text, author_handle, author_name)
      VALUES (new.rowid, new.id, new.text, new.author_handle, new.author_name);
    END;

    CREATE TRIGGER IF NOT EXISTS posts_ad AFTER DELETE ON posts BEGIN
      INSERT INTO posts_fts(posts_fts, rowid, id, text, author_handle, author_name)
      VALUES ('delete', old.rowid, old.id, old.text, old.author_handle, old.author_name);
    END;

    CREATE TRIGGER IF NOT EXISTS posts_au AFTER UPDATE ON posts BEGIN
      INSERT INTO posts_fts(posts_fts, rowid, id, text, author_handle, author_name)
      VALUES ('delete', old.rowid, old.id, old.text, old.author_handle, old.author_name);
      INSERT INTO posts_fts(rowid, id, text, author_handle, author_name)
      VALUES (new.rowid, new.id, new.text, new.author_handle, new.author_name);
    END;

    -- Sync log for tracking bookmark cursor state
    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_type TEXT NOT NULL,
      cursor TEXT,
      posts_synced INTEGER DEFAULT 0,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);
    CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_handle);
    CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at);
    CREATE INDEX IF NOT EXISTS idx_posts_conversation ON posts(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_posts_source ON posts(source);
  `);
}
