import { createHash } from 'crypto';
import { mkdirSync } from 'fs';
import Database from 'better-sqlite3';
import { homedir } from 'os';
import { dirname, join } from 'path';

import { loadConfig } from '../config.js';
import type {
  ContentSource,
  ContentStatus,
  LocalContentItem,
  LocalContentListResult,
  TagSummary,
  XPost,
} from '../types.js';
import { CONTENT_SOURCE_VALUES, CONTENT_STATUS_VALUES } from '../types.js';
import { ensureSchema } from './schema.js';

let _db: Database.Database | null = null;

const RETRYABLE_STATUSES: ContentStatus[] = ['new', 'pending', 'partial', 'failed', 'stale'];
const URL_ONLY_REGEX = /^\s*(https?:\/\/\S+)\s*[.!?,;:]*\s*$/i;

type StoredMetaRow = {
  content_hash: string | null;
  content_quality_score: number;
  content_status: ContentStatus;
  content_version: number;
  article_title: string | null;
  article_content: string | null;
  content_text: string | null;
  content_source: ContentSource;
  content_fetched_at: string | null;
  next_retry_at: string | null;
  error_code: string | null;
  content_error: string | null;
};

type HydrationCandidateRow = {
  id: string;
  content_status: ContentStatus;
  content_version: number;
  attempt_count: number;
  next_retry_at: string | null;
  created_at: string;
};

export interface HydrationCandidate {
  id: string;
  content_status: ContentStatus;
  content_version: number;
  attempt_count: number;
  next_retry_at: string | null;
  created_at: string;
}

export interface UpsertOutcome {
  contentAccepted: boolean;
  contentVersion: number;
  contentStatus: ContentStatus;
  skippedReason?: 'version_mismatch' | 'concurrent_update';
}

type CanonicalContent = {
  type: string;
  text: string;
  articleTitle: string | null;
  articleContent: string | null;
  contentText: string;
  contentSource: ContentSource;
  contentStatus: ContentStatus;
  contentHash: string | null;
  qualityScore: number;
};

export function getDb(): Database.Database {
  if (_db) return _db;

  const config = loadConfig();
  const dbPath = config.X_RECON_DB_PATH ?? join(homedir(), '.x-recon', 'knowledge.db');
  mkdirSync(dirname(dbPath), { recursive: true });

  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.pragma('synchronous = NORMAL');
  _db.pragma('busy_timeout = 5000');
  _db.pragma('temp_store = MEMORY');
  ensureSchema(_db);

  return _db;
}

export function setDb(db: Database.Database): void {
  _db = db;
}

export function resetDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

function normalizeWhitespace(input: string | undefined | null): string {
  if (!input) return '';
  return input.replace(/\s+/g, ' ').trim();
}

export function isPlaceholderUrlContent(content: string): boolean {
  const normalized = normalizeWhitespace(content);
  if (!normalized) return true;
  if (URL_ONLY_REGEX.test(normalized)) return true;

  const withoutUrls = normalized.replace(/https?:\/\/\S+/gi, '').replace(/[\p{P}\p{S}]/gu, '').trim();
  return withoutUrls.length < 10 && /https?:\/\//i.test(normalized);
}

function sourcePriority(source: string): number {
  if (source === 'hydration' || source === 'backfill') return 30;
  if (source === 'manual') return 20;
  if (source === 'bookmark') return 10;
  return 5;
}

function computeQualityScore(args: {
  hasArticleBody: boolean;
  isPlaceholder: boolean;
  contentLength: number;
  source: string;
}): number {
  const articleScore = args.hasArticleBody ? 100 : 0;
  const nonPlaceholderScore = args.isPlaceholder ? 0 : 20;
  const lengthScore = Math.min(50, Math.floor(args.contentLength / 200));
  return articleScore + nonPlaceholderScore + lengthScore + sourcePriority(args.source);
}

function hashContent(content: string): string | null {
  const normalized = normalizeWhitespace(content);
  if (!normalized) return null;
  return createHash('sha256').update(normalized).digest('hex');
}

function determineType(post: XPost): string {
  if (post.article !== undefined) return 'article';
  if (post.in_reply_to) return 'reply';
  if (post.quoted_tweet_id) return 'quote';
  if (post.is_thread) return 'thread_root';
  return 'post';
}

function canonicalizePost(post: XPost, source: string): CanonicalContent {
  const type = determineType(post);
  const articleTitle = normalizeWhitespace(post.article?.title) || null;
  const articleContent = normalizeWhitespace(post.article?.text) || null;
  const text = normalizeWhitespace(post.note_tweet_text ?? post.text);
  const contentText = normalizeWhitespace(articleContent ?? post.note_tweet_text ?? post.text);

  const hasArticleBody = Boolean(articleContent);
  const placeholder = isPlaceholderUrlContent(contentText);

  let contentSource: ContentSource = 'unknown';
  if (articleContent) contentSource = 'article';
  else if (normalizeWhitespace(post.note_tweet_text)) contentSource = 'note_tweet';
  else if (normalizeWhitespace(post.text)) contentSource = 'tweet';

  let contentStatus: ContentStatus;
  if (type === 'article') {
    if (hasArticleBody && !placeholder) contentStatus = 'hydrated';
    else if (contentText && !placeholder) contentStatus = source === 'hydration' || source === 'backfill' ? 'partial' : 'pending';
    else contentStatus = source === 'hydration' || source === 'backfill' ? 'partial' : 'pending';
  } else {
    contentStatus = contentText && !placeholder ? 'hydrated' : 'pending';
  }

  const contentHash = hashContent(contentText);
  const qualityScore = computeQualityScore({
    hasArticleBody,
    isPlaceholder: placeholder,
    contentLength: contentText.length,
    source,
  });

  return {
    type,
    text,
    articleTitle,
    articleContent,
    contentText,
    contentSource,
    contentStatus,
    contentHash,
    qualityScore,
  };
}

function shouldAcceptContent(existing: StoredMetaRow, incoming: CanonicalContent, forceContent: boolean): boolean {
  if (!incoming.contentHash) return false;
  if (forceContent) return true;
  if (existing.content_hash === incoming.contentHash) return false;
  if (incoming.qualityScore > existing.content_quality_score) return true;
  return existing.content_status !== 'hydrated';
}

function isValidContentStatus(value: string | undefined): value is ContentStatus {
  return value ? CONTENT_STATUS_VALUES.includes(value as ContentStatus) : false;
}

function isValidContentSource(value: string | undefined): value is ContentSource {
  return value ? CONTENT_SOURCE_VALUES.includes(value as ContentSource) : false;
}

const SELECT_META_SQL = `
  SELECT
    content_hash,
    content_quality_score,
    content_status,
    content_version,
    article_title,
    article_content,
    content_text,
    content_source,
    content_fetched_at,
    next_retry_at,
    error_code,
    content_error
  FROM posts
  WHERE id = ?
`;

const INSERT_POST_SQL = `
  INSERT INTO posts (
    id, author_handle, author_name, text, created_at, source_url, type, conversation_id, in_reply_to,
    raw_json, ingested_at, source, article_title, article_content, content_text, content_source,
    content_status, content_hash, content_quality_score, content_version, content_fetched_at,
    last_hydration_attempt_at, attempt_count, next_retry_at, error_code, content_error
  ) VALUES (
    @id, @author_handle, @author_name, @text, @created_at, @source_url, @type, @conversation_id, @in_reply_to,
    @raw_json, datetime('now'), @source, @article_title, @article_content, @content_text, @content_source,
    @content_status, @content_hash, @content_quality_score, @content_version, @content_fetched_at,
    @last_hydration_attempt_at, @attempt_count, @next_retry_at, @error_code, @content_error
  )
`;

const UPDATE_POST_SQL = `
  UPDATE posts
  SET
    author_handle = @author_handle,
    author_name = @author_name,
    text = @text,
    created_at = @created_at,
    source_url = @source_url,
    type = @type,
    conversation_id = @conversation_id,
    in_reply_to = @in_reply_to,
    raw_json = @raw_json,
    ingested_at = datetime('now'),
    source = @source,
    article_title = @article_title,
    article_content = @article_content,
    content_text = @content_text,
    content_source = @content_source,
    content_status = @content_status,
    content_hash = @content_hash,
    content_quality_score = @content_quality_score,
    content_version = @content_version,
    content_fetched_at = @content_fetched_at,
    error_code = @error_code,
    content_error = @content_error,
    next_retry_at = @next_retry_at
  WHERE id = @id AND content_version = @expected_content_version
`;

export function upsertPost(
  post: XPost,
  source: string,
  options?: { forceContent?: boolean; expectedContentVersion?: number },
): UpsertOutcome {
  const db = getDb();
  const normalized = canonicalizePost(post, source);
  const now = new Date().toISOString();

  const insertStmt = db.prepare(INSERT_POST_SQL);
  const updateStmt = db.prepare(UPDATE_POST_SQL);
  const selectMetaStmt = db.prepare(SELECT_META_SQL);

  for (let attempt = 0; attempt < 2; attempt++) {
    const existing = selectMetaStmt.get(post.id) as StoredMetaRow | undefined;

    if (!existing) {
      insertStmt.run({
        id: post.id,
        author_handle: post.author.handle,
        author_name: post.author.name,
        text: normalized.text,
        created_at: post.timestamp,
        source_url: post.source_url,
        type: normalized.type,
        conversation_id: post.thread_id ?? null,
        in_reply_to: post.in_reply_to ?? null,
        raw_json: JSON.stringify(post),
        source,
        article_title: normalized.articleTitle,
        article_content: normalized.articleContent,
        content_text: normalized.contentText,
        content_source: normalized.contentSource,
        content_status: normalized.contentStatus,
        content_hash: normalized.contentHash,
        content_quality_score: normalized.qualityScore,
        content_version: 1,
        content_fetched_at: normalized.contentStatus === 'hydrated' || normalized.contentStatus === 'partial' ? now : null,
        last_hydration_attempt_at: null,
        attempt_count: 0,
        next_retry_at: null,
        error_code: null,
        content_error: null,
      });

      return { contentAccepted: true, contentVersion: 1, contentStatus: normalized.contentStatus };
    }

    if (options?.expectedContentVersion !== undefined && existing.content_version !== options.expectedContentVersion) {
      return {
        contentAccepted: false,
        contentVersion: existing.content_version,
        contentStatus: existing.content_status,
        skippedReason: 'version_mismatch',
      };
    }

    const acceptContent = shouldAcceptContent(existing, normalized, options?.forceContent ?? false);
    const nextVersion = acceptContent ? existing.content_version + 1 : existing.content_version;
    const contentStatus = acceptContent ? normalized.contentStatus : existing.content_status;

    const result = updateStmt.run({
      id: post.id,
      author_handle: post.author.handle,
      author_name: post.author.name,
      text: normalized.text,
      created_at: post.timestamp,
      source_url: post.source_url,
      type: normalized.type,
      conversation_id: post.thread_id ?? null,
      in_reply_to: post.in_reply_to ?? null,
      raw_json: JSON.stringify(post),
      source,
      article_title: acceptContent ? normalized.articleTitle : null,
      article_content: acceptContent ? normalized.articleContent : existing.article_content,
      content_text: acceptContent ? normalized.contentText : existing.content_text,
      content_source: acceptContent ? normalized.contentSource : existing.content_source,
      content_status: contentStatus,
      content_hash: acceptContent ? normalized.contentHash : existing.content_hash,
      content_quality_score: acceptContent ? normalized.qualityScore : existing.content_quality_score,
      content_version: nextVersion,
      content_fetched_at: acceptContent && (normalized.contentStatus === 'hydrated' || normalized.contentStatus === 'partial') ? now : existing.content_fetched_at,
      error_code: acceptContent ? null : existing.error_code,
      content_error: acceptContent ? null : existing.content_error,
      next_retry_at: acceptContent ? null : existing.next_retry_at,
      expected_content_version: existing.content_version,
    });

    if (result.changes === 1) {
      return { contentAccepted: acceptContent, contentVersion: nextVersion, contentStatus };
    }
  }

  const latest = selectMetaStmt.get(post.id) as StoredMetaRow | undefined;
  return {
    contentAccepted: false,
    contentVersion: latest?.content_version ?? 0,
    contentStatus: latest?.content_status ?? 'pending',
    skippedReason: 'concurrent_update',
  };
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
  return rows.map((row) => JSON.parse(row.raw_json));
}

export function getPostsByTag(tag: string, limit = 100): XPost[] {
  const db = getDb();
  const rows = db
    .prepare(
      `
      SELECT p.raw_json FROM posts p
      JOIN tags t ON p.id = t.post_id
      WHERE t.tag = ?
      ORDER BY p.created_at DESC
      LIMIT ?
    `,
    )
    .all(tag.toLowerCase(), limit) as Array<{ raw_json: string }>;
  return rows.map((row) => JSON.parse(row.raw_json));
}

export function searchPosts(query: string, limit = 50): XPost[] {
  const db = getDb();
  const rows = db
    .prepare(
      `
      SELECT p.raw_json FROM posts p
      JOIN posts_fts fts ON p.rowid = fts.rowid
      WHERE posts_fts MATCH ?
      ORDER BY bm25(posts_fts)
      LIMIT ?
    `,
    )
    .all(query, limit) as Array<{ raw_json: string }>;
  return rows.map((row) => JSON.parse(row.raw_json));
}

export function searchPostsByTag(query: string, tag: string, limit = 50): XPost[] {
  const db = getDb();
  const rows = db
    .prepare(
      `
      SELECT p.raw_json FROM posts p
      JOIN posts_fts fts ON p.rowid = fts.rowid
      JOIN tags t ON p.id = t.post_id
      WHERE posts_fts MATCH ? AND t.tag = ?
      ORDER BY bm25(posts_fts)
      LIMIT ?
    `,
    )
    .all(query, tag.toLowerCase(), limit) as Array<{ raw_json: string }>;
  return rows.map((row) => JSON.parse(row.raw_json));
}

type LocalRow = {
  id: string;
  type: string;
  author_handle: string;
  author_name: string | null;
  created_at: string;
  source_url: string | null;
  source: string | null;
  article_title: string | null;
  content_status: string;
  content_source: string;
  content_version: number;
  content_fetched_at: string | null;
  content_text: string | null;
  tags: string | null;
};

function asLocalContentItem(row: LocalRow, includeFullContent: boolean, snippetChars: number): LocalContentItem {
  const text = normalizeWhitespace(row.content_text ?? '');
  const snippet = text.length > snippetChars ? `${text.slice(0, snippetChars)}...` : text;
  const tags = row.tags ? row.tags.split('|').filter(Boolean) : [];

  return {
    id: row.id,
    type: row.type,
    author_handle: row.author_handle,
    author_name: row.author_name,
    created_at: row.created_at,
    source_url: row.source_url,
    source: row.source,
    article_title: row.article_title,
    content_status: isValidContentStatus(row.content_status) ? row.content_status : 'pending',
    content_source: isValidContentSource(row.content_source) ? row.content_source : 'unknown',
    content_version: row.content_version,
    content_fetched_at: row.content_fetched_at,
    snippet,
    content_text: includeFullContent ? text : undefined,
    tags,
  };
}

function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}::${id}`).toString('base64url');
}

function decodeCursor(cursor?: string): { created_at: string; id: string } | null {
  if (!cursor) return null;
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const [created_at, id] = decoded.split('::');
    if (!created_at || !id) return null;
    return { created_at, id };
  } catch {
    return null;
  }
}

export function listLocalContent(params: {
  limit: number;
  cursor?: string;
  type?: string;
  tag?: string;
  author?: string;
  from_date?: string;
  to_date?: string;
  content_status?: ContentStatus;
  has_full_content?: boolean;
  include_full_content?: boolean;
  snippet_chars?: number;
}): LocalContentListResult {
  const db = getDb();
  const snippetChars = params.snippet_chars ?? 800;
  const includeFullContent = params.include_full_content ?? false;
  const limit = Math.max(1, Math.min(params.limit, includeFullContent ? 30 : 100));
  const decodedCursor = decodeCursor(params.cursor);

  const conditions: string[] = [];
  const values: unknown[] = [];

  if (params.type) {
    conditions.push('p.type = ?');
    values.push(params.type);
  }

  if (params.tag) {
    conditions.push('EXISTS (SELECT 1 FROM tags t2 WHERE t2.post_id = p.id AND t2.tag = ?)');
    values.push(params.tag.toLowerCase());
  }

  if (params.author) {
    conditions.push('p.author_handle = ?');
    values.push(params.author);
  }

  if (params.from_date) {
    conditions.push('p.created_at >= ?');
    values.push(params.from_date);
  }

  if (params.to_date) {
    conditions.push('p.created_at <= ?');
    values.push(params.to_date);
  }

  if (params.content_status) {
    conditions.push('p.content_status = ?');
    values.push(params.content_status);
  }

  if (params.has_full_content) {
    conditions.push("p.content_text IS NOT NULL AND trim(p.content_text) <> ''");
  }

  if (decodedCursor) {
    conditions.push('(p.created_at < ? OR (p.created_at = ? AND p.id < ?))');
    values.push(decodedCursor.created_at, decodedCursor.created_at, decodedCursor.id);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = db
    .prepare(
      `
      SELECT
        p.id,
        p.type,
        p.author_handle,
        p.author_name,
        p.created_at,
        p.source_url,
        p.source,
        p.article_title,
        p.content_status,
        p.content_source,
        p.content_version,
        p.content_fetched_at,
        p.content_text,
        group_concat(t.tag, '|') as tags
      FROM posts p
      LEFT JOIN tags t ON p.id = t.post_id
      ${whereClause}
      GROUP BY p.id
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT ?
    `,
    )
    .all(...values, limit + 1) as LocalRow[];

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const data = pageRows.map((row) => asLocalContentItem(row, includeFullContent, snippetChars));

  const nextCursor = hasMore && pageRows.length > 0
    ? encodeCursor(pageRows[pageRows.length - 1].created_at, pageRows[pageRows.length - 1].id)
    : undefined;

  return {
    data,
    cursor: nextCursor,
    has_more: hasMore,
  };
}

export function searchLocalContent(params: {
  query: string;
  tag?: string;
  limit: number;
  include_full_content?: boolean;
  snippet_chars?: number;
  content_status?: ContentStatus;
}): LocalContentListResult {
  const db = getDb();
  const snippetChars = params.snippet_chars ?? 800;
  const includeFullContent = params.include_full_content ?? false;
  const limit = Math.max(1, Math.min(params.limit, includeFullContent ? 30 : 100));

  const conditions = ['posts_fts MATCH ?'];
  const values: unknown[] = [params.query];

  if (params.tag) {
    conditions.push('EXISTS (SELECT 1 FROM tags t2 WHERE t2.post_id = p.id AND t2.tag = ?)');
    values.push(params.tag.toLowerCase());
  }

  if (params.content_status) {
    conditions.push('p.content_status = ?');
    values.push(params.content_status);
  }

  const rows = db
    .prepare(
      `
      WITH ranked AS (
        SELECT
          p.id,
          p.type,
          p.author_handle,
          p.author_name,
          p.created_at,
          p.source_url,
          p.source,
          p.article_title,
          p.content_status,
          p.content_source,
          p.content_version,
          p.content_fetched_at,
          p.content_text,
          bm25(posts_fts) AS rank
        FROM posts p
        JOIN posts_fts fts ON p.rowid = fts.rowid
        WHERE ${conditions.join(' AND ')}
        ORDER BY rank
        LIMIT ?
      )
      SELECT
        r.id,
        r.type,
        r.author_handle,
        r.author_name,
        r.created_at,
        r.source_url,
        r.source,
        r.article_title,
        r.content_status,
        r.content_source,
        r.content_version,
        r.content_fetched_at,
        r.content_text,
        group_concat(t.tag, '|') as tags
      FROM ranked r
      LEFT JOIN tags t ON r.id = t.post_id
      GROUP BY r.id
      ORDER BY r.rank
    `,
    )
    .all(...values, limit) as LocalRow[];

  return {
    data: rows.map((row) => asLocalContentItem(row, includeFullContent, snippetChars)),
    has_more: false,
  };
}

export function getHydrationCandidates(params: {
  limit: number;
  ids?: string[];
  force?: boolean;
  now?: string;
  cursor?: { created_at: string; id: string };
}): HydrationCandidate[] {
  const db = getDb();
  const now = params.now ?? new Date().toISOString();

  if (params.ids && params.ids.length > 0) {
    const placeholders = params.ids.map(() => '?').join(',');
    const rows = db
      .prepare(
        `
        SELECT id, content_status, content_version, attempt_count, next_retry_at, created_at
        FROM posts
        WHERE id IN (${placeholders}) AND type = 'article'
        ORDER BY created_at ASC, id ASC
        LIMIT ?
      `,
      )
      .all(...params.ids, params.limit) as HydrationCandidateRow[];
    return rows;
  }

  const conditions = [
    `content_status IN (${RETRYABLE_STATUSES.map(() => '?').join(',')})`,
    "type = 'article'",
  ];
  const values: unknown[] = [...RETRYABLE_STATUSES];

  if (!params.force) {
    conditions.push('(next_retry_at IS NULL OR next_retry_at <= ?)');
    values.push(now);
  }

  if (params.cursor) {
    conditions.push('(created_at > ? OR (created_at = ? AND id > ?))');
    values.push(params.cursor.created_at, params.cursor.created_at, params.cursor.id);
  }

  const rows = db
    .prepare(
      `
      SELECT id, content_status, content_version, attempt_count, next_retry_at, created_at
      FROM posts
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `,
    )
    .all(...values, params.limit) as HydrationCandidateRow[];

  return rows;
}

export function markHydrationFetching(candidate: HydrationCandidate): boolean {
  const db = getDb();
  const result = db
    .prepare(
      `
      UPDATE posts
      SET
        content_status = 'fetching',
        last_hydration_attempt_at = ?,
        attempt_count = attempt_count + 1,
        error_code = NULL,
        content_error = NULL
      WHERE id = ?
        AND content_version = ?
        AND content_status IN (${RETRYABLE_STATUSES.map(() => '?').join(',')})
    `,
    )
    .run(new Date().toISOString(), candidate.id, candidate.content_version, ...RETRYABLE_STATUSES);

  return result.changes === 1;
}

export function markHydrationFailure(params: {
  id: string;
  expectedVersion: number;
  nextStatus: 'failed' | 'missing';
  errorCode: string;
  errorMessage: string;
  nextRetryAt?: string | null;
}): boolean {
  const db = getDb();
  const result = db
    .prepare(
      `
      UPDATE posts
      SET
        content_status = ?,
        error_code = ?,
        content_error = ?,
        next_retry_at = ?,
        content_fetched_at = datetime('now')
      WHERE id = ? AND content_version = ? AND content_status = 'fetching'
    `,
    )
    .run(
      params.nextStatus,
      params.errorCode,
      params.errorMessage,
      params.nextRetryAt ?? null,
      params.id,
      params.expectedVersion,
    );

  return result.changes === 1;
}

export function getContentMetaById(id: string): { content_version: number; content_status: ContentStatus } | null {
  const db = getDb();
  const row = db
    .prepare('SELECT content_version, content_status FROM posts WHERE id = ?')
    .get(id) as { content_version: number; content_status: ContentStatus } | undefined;
  return row ?? null;
}

export function getBackfillCheckpoint(jobName: string): { cursor_created_at?: string; cursor_id?: string; processed_count: number } | null {
  const db = getDb();
  const row = db
    .prepare('SELECT cursor_created_at, cursor_id, processed_count FROM content_backfill_state WHERE job_name = ?')
    .get(jobName) as { cursor_created_at: string | null; cursor_id: string | null; processed_count: number } | undefined;

  if (!row) return null;
  return {
    cursor_created_at: row.cursor_created_at ?? undefined,
    cursor_id: row.cursor_id ?? undefined,
    processed_count: row.processed_count,
  };
}

export function updateBackfillCheckpoint(params: {
  jobName: string;
  cursorCreatedAt?: string;
  cursorId?: string;
  processedIncrement: number;
}): void {
  const db = getDb();
  db.prepare(
    `
    INSERT INTO content_backfill_state (job_name, cursor_created_at, cursor_id, processed_count, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(job_name) DO UPDATE SET
      cursor_created_at = excluded.cursor_created_at,
      cursor_id = excluded.cursor_id,
      processed_count = content_backfill_state.processed_count + excluded.processed_count,
      updated_at = datetime('now')
  `,
  ).run(params.jobName, params.cursorCreatedAt ?? null, params.cursorId ?? null, params.processedIncrement);
}

export function getAllTags(): TagSummary[] {
  const db = getDb();
  const rows = db
    .prepare(
      `
      SELECT tag, COUNT(*) as count FROM tags
      GROUP BY tag
      ORDER BY count DESC
    `,
    )
    .all() as Array<{ tag: string; count: number }>;
  return rows;
}

export function getTotalPostCount(): number {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) as count FROM posts').get() as { count: number };
  return row.count;
}

export function logSync(type: string, postsSynced: number, cursor?: string): void {
  const db = getDb();
  db.prepare(
    `
    INSERT INTO sync_log (sync_type, cursor, posts_synced, completed_at)
    VALUES (?, ?, ?, datetime('now'))
  `,
  ).run(type, cursor ?? null, postsSynced);
}

export function getLastSync(type: string): { cursor?: string; completed_at: string } | null {
  const db = getDb();
  const row = db
    .prepare(
      `
      SELECT cursor, completed_at FROM sync_log
      WHERE sync_type = ? AND completed_at IS NOT NULL
      ORDER BY id DESC LIMIT 1
    `,
    )
    .get(type) as { cursor: string | null; completed_at: string } | undefined;

  if (!row) return null;
  return { cursor: row.cursor ?? undefined, completed_at: row.completed_at };
}
