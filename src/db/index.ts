import Database from 'better-sqlite3';
import { ensureSchema } from './schema.js';
import { loadConfig } from '../config.js';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import type { XPost, TagSummary } from '../types.js';

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  const config = loadConfig();
  const dbPath = config.X_RECON_DB_PATH ?? join(homedir(), '.x-recon', 'knowledge.db');
  mkdirSync(dirname(dbPath), { recursive: true });
  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  ensureSchema(_db);
  return _db;
}

/**
 * For testing: initialize with a provided database instance.
 */
export function setDb(db: Database.Database): void {
  _db = db;
}

/**
 * For testing: reset the singleton.
 */
export function resetDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

// --- Post helpers ---

function determineType(post: XPost): string {
  if (post.in_reply_to) return 'reply';
  if (post.quoted_tweet_id) return 'quote';
  if (post.is_thread) return 'thread_root';
  return 'post';
}

const UPSERT_SQL = `
  INSERT OR REPLACE INTO posts
    (id, author_handle, author_name, text, created_at, source_url, type, conversation_id, in_reply_to, raw_json, ingested_at, source)
  VALUES
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
`;

export function upsertPost(post: XPost, source: string): void {
  const db = getDb();
  db.prepare(UPSERT_SQL).run(
    post.id,
    post.author.handle,
    post.author.name,
    post.note_tweet_text ?? post.text,
    post.timestamp,
    post.source_url,
    determineType(post),
    post.thread_id ?? null,
    post.in_reply_to ?? null,
    JSON.stringify(post),
    source,
  );
}

export function upsertPosts(posts: XPost[], source: string): void {
  const db = getDb();
  const tx = db.transaction(() => {
    for (const post of posts) {
      upsertPost(post, source);
    }
  });
  tx();
}

// --- Tag helpers ---

export function tagPost(postId: string, tag: string): void {
  const db = getDb();
  db.prepare('INSERT OR IGNORE INTO tags (post_id, tag) VALUES (?, ?)').run(postId, tag.toLowerCase());
}

export function tagPosts(postIds: string[], tag: string): void {
  const db = getDb();
  const normalizedTag = tag.toLowerCase();
  const tx = db.transaction(() => {
    const stmt = db.prepare('INSERT OR IGNORE INTO tags (post_id, tag) VALUES (?, ?)');
    for (const id of postIds) {
      stmt.run(id, normalizedTag);
    }
  });
  tx();
}

export function untagPost(postId: string, tag: string): void {
  const db = getDb();
  db.prepare('DELETE FROM tags WHERE post_id = ? AND tag = ?').run(postId, tag.toLowerCase());
}

// --- Query helpers ---

export function getPostById(id: string): XPost | null {
  const db = getDb();
  const row = db.prepare('SELECT raw_json FROM posts WHERE id = ?').get(id) as { raw_json: string } | undefined;
  return row ? JSON.parse(row.raw_json) : null;
}

export function getPostsByIds(ids: string[]): XPost[] {
  if (ids.length === 0) return [];
  const db = getDb();
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`SELECT raw_json FROM posts WHERE id IN (${placeholders})`).all(...ids) as Array<{ raw_json: string }>;
  return rows.map(r => JSON.parse(r.raw_json));
}

export function getPostsByTag(tag: string, limit = 100): XPost[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT p.raw_json FROM posts p
    JOIN tags t ON p.id = t.post_id
    WHERE t.tag = ?
    ORDER BY p.created_at DESC
    LIMIT ?
  `).all(tag.toLowerCase(), limit) as Array<{ raw_json: string }>;
  return rows.map(r => JSON.parse(r.raw_json));
}

export function searchPosts(query: string, limit = 50): XPost[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT p.raw_json FROM posts p
    JOIN posts_fts fts ON p.rowid = fts.rowid
    WHERE posts_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(query, limit) as Array<{ raw_json: string }>;
  return rows.map(r => JSON.parse(r.raw_json));
}

export function searchPostsByTag(query: string, tag: string, limit = 50): XPost[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT p.raw_json FROM posts p
    JOIN posts_fts fts ON p.rowid = fts.rowid
    JOIN tags t ON p.id = t.post_id
    WHERE posts_fts MATCH ? AND t.tag = ?
    ORDER BY rank
    LIMIT ?
  `).all(query, tag.toLowerCase(), limit) as Array<{ raw_json: string }>;
  return rows.map(r => JSON.parse(r.raw_json));
}

export function getAllTags(): TagSummary[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT tag, COUNT(*) as count FROM tags
    GROUP BY tag
    ORDER BY count DESC
  `).all() as Array<{ tag: string; count: number }>;
  return rows;
}

export function getTotalPostCount(): number {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) as count FROM posts').get() as { count: number };
  return row.count;
}

// --- Sync log helpers ---

export function logSync(type: string, postsSynced: number, cursor?: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO sync_log (sync_type, cursor, posts_synced, completed_at)
    VALUES (?, ?, ?, datetime('now'))
  `).run(type, cursor ?? null, postsSynced);
}

export function getLastSync(type: string): { cursor?: string; completed_at: string } | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT cursor, completed_at FROM sync_log
    WHERE sync_type = ? AND completed_at IS NOT NULL
    ORDER BY id DESC LIMIT 1
  `).get(type) as { cursor: string | null; completed_at: string } | undefined;
  if (!row) return null;
  return { cursor: row.cursor ?? undefined, completed_at: row.completed_at };
}
