import type Database from 'better-sqlite3';

const CONTENT_STATUS_VALUES = ['new', 'pending', 'fetching', 'hydrated', 'partial', 'failed', 'missing', 'stale'];
const CONTENT_SOURCE_VALUES = ['article', 'note_tweet', 'tweet', 'unknown'];

function tableColumns(db: Database.Database, table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

function ensurePostColumns(db: Database.Database): void {
  const columns = new Set(tableColumns(db, 'posts'));
  const columnDefinitions: Array<[string, string]> = [
    ['article_title', 'TEXT'],
    ['article_content', 'TEXT'],
    ['content_text', 'TEXT'],
    ['content_source', "TEXT NOT NULL DEFAULT 'unknown'"],
    ['content_status', "TEXT NOT NULL DEFAULT 'new'"],
    ['content_hash', 'TEXT'],
    ['content_quality_score', 'INTEGER NOT NULL DEFAULT 0'],
    ['content_version', 'INTEGER NOT NULL DEFAULT 0'],
    ['content_fetched_at', 'TEXT'],
    ['last_hydration_attempt_at', 'TEXT'],
    ['attempt_count', 'INTEGER NOT NULL DEFAULT 0'],
    ['next_retry_at', 'TEXT'],
    ['error_code', 'TEXT'],
    ['content_error', 'TEXT'],
  ];

  for (const [name, definition] of columnDefinitions) {
    if (!columns.has(name)) {
      db.exec(`ALTER TABLE posts ADD COLUMN ${name} ${definition}`);
    }
  }
}

function recreateFts(db: Database.Database): void {
  db.exec(`
    DROP TRIGGER IF EXISTS posts_ai;
    DROP TRIGGER IF EXISTS posts_ad;
    DROP TRIGGER IF EXISTS posts_au;
    DROP TABLE IF EXISTS posts_fts;

    CREATE VIRTUAL TABLE posts_fts USING fts5(
      id UNINDEXED,
      text,
      content_text,
      article_title,
      author_handle,
      author_name,
      content=posts,
      content_rowid=rowid
    );

    CREATE TRIGGER posts_ai AFTER INSERT ON posts BEGIN
      INSERT INTO posts_fts(rowid, id, text, content_text, article_title, author_handle, author_name)
      VALUES (new.rowid, new.id, new.text, new.content_text, new.article_title, new.author_handle, new.author_name);
    END;

    CREATE TRIGGER posts_ad AFTER DELETE ON posts BEGIN
      INSERT INTO posts_fts(posts_fts, rowid, id, text, content_text, article_title, author_handle, author_name)
      VALUES ('delete', old.rowid, old.id, old.text, old.content_text, old.article_title, old.author_handle, old.author_name);
    END;

    CREATE TRIGGER posts_au AFTER UPDATE ON posts BEGIN
      INSERT INTO posts_fts(posts_fts, rowid, id, text, content_text, article_title, author_handle, author_name)
      VALUES ('delete', old.rowid, old.id, old.text, old.content_text, old.article_title, old.author_handle, old.author_name);
      INSERT INTO posts_fts(rowid, id, text, content_text, article_title, author_handle, author_name)
      VALUES (new.rowid, new.id, new.text, new.content_text, new.article_title, new.author_handle, new.author_name);
    END;
  `);

  db.exec("INSERT INTO posts_fts(posts_fts) VALUES ('rebuild')");
}

function ensureFtsSchema(db: Database.Database): void {
  const expectedColumns = ['id', 'text', 'content_text', 'article_title', 'author_handle', 'author_name'];
  const existingColumns = tableColumns(db, 'posts_fts');

  if (existingColumns.length === 0) {
    recreateFts(db);
    return;
  }

  const isMatch = expectedColumns.every((column, idx) => existingColumns[idx] === column);
  if (!isMatch) {
    recreateFts(db);
  }
}

function ensureValidationTriggers(db: Database.Database): void {
  const statusList = CONTENT_STATUS_VALUES.map((value) => `'${value}'`).join(', ');
  const sourceList = CONTENT_SOURCE_VALUES.map((value) => `'${value}'`).join(', ');

  db.exec(`
    DROP TRIGGER IF EXISTS posts_validate_insert;
    DROP TRIGGER IF EXISTS posts_validate_update;

    CREATE TRIGGER posts_validate_insert BEFORE INSERT ON posts
    WHEN new.content_status NOT IN (${statusList})
      OR new.content_source NOT IN (${sourceList})
      OR new.attempt_count < 0
    BEGIN
      SELECT RAISE(ABORT, 'invalid posts content fields');
    END;

    CREATE TRIGGER posts_validate_update BEFORE UPDATE ON posts
    WHEN new.content_status NOT IN (${statusList})
      OR new.content_source NOT IN (${sourceList})
      OR new.attempt_count < 0
    BEGIN
      SELECT RAISE(ABORT, 'invalid posts content fields');
    END;
  `);
}

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
      source TEXT DEFAULT 'bookmark',
      article_title TEXT,
      article_content TEXT,
      content_text TEXT,
      content_source TEXT NOT NULL DEFAULT 'unknown',
      content_status TEXT NOT NULL DEFAULT 'new',
      content_hash TEXT,
      content_quality_score INTEGER NOT NULL DEFAULT 0,
      content_version INTEGER NOT NULL DEFAULT 0,
      content_fetched_at TEXT,
      last_hydration_attempt_at TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_retry_at TEXT,
      error_code TEXT,
      content_error TEXT
    );

    -- Tag associations (many-to-many)
    CREATE TABLE IF NOT EXISTS tags (
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (post_id, tag)
    );

    -- Sync log for tracking bookmark cursor state
    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_type TEXT NOT NULL,
      cursor TEXT,
      posts_synced INTEGER DEFAULT 0,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS content_backfill_state (
      job_name TEXT PRIMARY KEY,
      cursor_created_at TEXT,
      cursor_id TEXT,
      processed_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);
    CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_handle);
    CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at);
    CREATE INDEX IF NOT EXISTS idx_posts_conversation ON posts(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_posts_source ON posts(source);
    CREATE INDEX IF NOT EXISTS idx_backfill_updated_at ON content_backfill_state(updated_at);
  `);

  ensurePostColumns(db);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_posts_type_status_created ON posts(type, content_status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_posts_status_retry_created ON posts(content_status, next_retry_at, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_posts_content_fetched_at ON posts(content_fetched_at);
  `);

  ensureFtsSchema(db);
  ensureValidationTriggers(db);
}
