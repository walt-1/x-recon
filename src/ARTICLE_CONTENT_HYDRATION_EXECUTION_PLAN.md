# Article Content Hydration Plan (DDIA-Hardened)

## Objective

Enable reliable, scalable retrieval of both short posts and long-form article content from the local SQLite knowledge base, so downstream MCP/LLM workflows can reason over many items with high recall and predictable token usage.

## Product Outcomes

- Articles are identified deterministically and stored as first-class content rows.
- URL-placeholder text (for example `https://t.co/...`) is never treated as final article content.
- Long article bodies are stored losslessly, but retrieved in token-safe forms by default.
- Existing metadata-only article rows can be backfilled safely and resumably.
- Search and listing tools support high-volume reasoning workflows (snippets/chunks + pagination).

## Non-Goals

- Do not remove existing `raw_json` storage.
- Do not break current tool contracts without versioning.
- Do not require destructive DB resets.

---

## Current Problem Summary

- Some article rows have `text` populated with a URL stub rather than article body.
- `type` classification does not treat articles as first-class consistently.
- Ingest paths can persist partial article metadata without an enrichment/hydration pass.
- Existing `ingest_posts` skip-if-exists behavior prevents repair of already ingested bad rows.

---

## Data Model Changes

Add the following columns to `posts` (additive migration first):

- `article_title TEXT NULL`
- `article_content TEXT NULL`
- `content_text TEXT NULL` (canonical body used for search/reasoning)
- `content_source TEXT NOT NULL DEFAULT 'unknown'`
  - Allowed: `article`, `note_tweet`, `tweet`, `unknown`
- `content_status TEXT NOT NULL DEFAULT 'new'`
  - Allowed: `new`, `pending`, `fetching`, `hydrated`, `partial`, `failed`, `missing`, `stale`
- `content_hash TEXT NULL` (hash of canonical content for idempotency)
- `content_version INTEGER NOT NULL DEFAULT 0`
- `content_fetched_at TEXT NULL`
- `last_hydration_attempt_at TEXT NULL`
- `attempt_count INTEGER NOT NULL DEFAULT 0`
- `next_retry_at TEXT NULL`
- `error_code TEXT NULL`
- `content_error TEXT NULL`

Add indexes:

- `(type, content_status, created_at DESC)`
- `(content_status, next_retry_at, created_at DESC)`
- Partial index for hydration queue if supported by schema strategy.

Add constraints/checks (tighten after backfill):

- `content_status` in allowed set.
- `content_source` in allowed set.
- `attempt_count >= 0`.

## FTS Strategy

- Index canonical `content_text` plus `author_handle`, `author_name`.
- Optionally include `article_title` in FTS source.
- Avoid unbounded indexing of giant bodies in primary FTS if write latency becomes problematic.
- If needed, add separate chunk FTS table for deep long-form retrieval.

---

## Classification and Canonicalization Rules

### Type Detection

Update `determineType(post)` to classify `article` when any of:

- `post.article` object exists, or
- `post.article.title` exists, or
- `post.article.text/content/body` exists.

Preserve reply/quote/thread semantics via separate flags (do not overload primary type).

### Canonical Content Mapping

Single shared function used by all write paths:

1. Extract `article_title` from known article title fields.
2. Extract `article_content` from known body fields (`text`, `content`, `body`) and normalize whitespace.
3. Derive `content_text = article_content ?? note_tweet_text ?? text ?? ''`.
4. Derive `content_source`:
   - `article` if `article_content` present
   - `note_tweet` if note text used
   - `tweet` if tweet text used
   - `unknown` otherwise
5. Detect URL-placeholder-only content and downgrade status.

### Placeholder Detection

Treat content as placeholder when all content is URL-like, including common `t.co` forms.

Examples:

- Exact URL only
- URL + trivial punctuation
- Very short text dominated by URLs

Placeholder rows should move to `pending` hydration, not `hydrated`.

---

## Content Status State Machine

Allowed transitions:

- `new -> pending`
- `pending -> fetching`
- `fetching -> hydrated` (full content accepted)
- `fetching -> partial` (metadata/weak content only)
- `fetching -> failed` (retryable error)
- `fetching -> missing` (terminal unavailable: deleted/protected/not found)
- `failed -> pending` (after backoff window)
- `partial -> pending` (eligible for improvement)
- `hydrated -> stale` (source changed, TTL expired, schema/content rules changed)
- `stale -> pending`

Transition invariants:

- Only hydration worker sets `fetching`.
- Every transition updates audit fields (`attempt_count`, timestamps, `error_code`).
- `content_version` increments only on accepted content writes.

---

## Idempotency and Conflict Policy

### Deterministic Update Acceptance

Replace subjective "quality improved" with deterministic policy:

- Compute `content_hash` from canonical `content_text`.
- Compute quality score:
  - `+100` if article body present
  - `+20` if non-placeholder
  - `+length_bucket` (bounded)
  - `+source_priority` (direct post fetch > list payload)
- Accept update if:
  - hash changed and score is greater, or
  - hash changed and old status is not `hydrated`, or
  - explicit `force=true`.

### Concurrency Safety

- Replace `INSERT OR REPLACE` with `ON CONFLICT DO UPDATE`.
- Use optimistic CAS: `WHERE id = ? AND content_version = ?` for enrichment updates.
- If CAS fails, re-read row and re-evaluate acceptance policy.

---

## Hydration Pipeline

Add a dedicated hydrator (`hydrate_articles`) with read-only dry-run support.

### Candidate Selection

Rows where:

- `type='article'`, and
- `content_status in ('pending','partial','failed','stale')`, and
- retry window allows processing (`next_retry_at IS NULL OR <= now`).

Also include URL-placeholder rows regardless of previous status if forced.

### Fetch Strategy

1. Batch fetch via `getPostsByIds` (size default `100`).
2. Fallback to `getPost(id)` for unresolved rows.
3. Re-map canonical fields and apply deterministic acceptance policy.

### Retry Policy

- Retryable: rate limit, timeout, transient parse/network.
- Terminal: deleted/protected/not found/auth scope unavailable.
- Backoff: `1h -> 6h -> 24h -> daily`, max attempts configurable (default `7`).

### Transaction Boundaries

- External API calls happen outside DB transaction.
- DB writes in short batches (default `150`, max `250` rows/tx).
- Persist checkpoints so process is resumable after crash.

---

## Tool Surface Changes

### New: `hydrate_articles`

Input:

- `ids?: string[]`
- `limit?: number`
- `force?: boolean`
- `dry_run?: boolean`
- `max_attempts?: number`

Output:

- Aggregate counts: `hydrated`, `partial`, `failed`, `missing`, `skipped`
- Per-ID status transition summary with `error_code` where applicable

### New: `list_local_content`

Purpose: token-safe list API for LLM pipelines.

Input filters:

- `type`, `tag`, `author`, `from_date`, `to_date`, `content_status`
- `has_full_content`, `cursor`, `limit`
- `include_full_content` (default false)
- `snippet_chars` (default ~800)

Output:

- Lightweight row shape by default (id, author, timestamp, type, title, snippet, status, source)
- Full content only when explicitly requested

### Update: `search_local`

- Search over canonical indexed content.
- Keep defaults snippet-first.
- Add guardrails:
  - default `limit=20`
  - hard cap `limit=100` with snippets only
  - stricter cap when `include_full_content=true`

### Optional: `get_local_content_by_ids`

- Bulk retrieval by IDs with `include_full_content` and response-size guard.

---

## Backfill Plan for Existing Data

### Phase A: Schema Expand

- Add new columns/indexes/tables (additive only).
- Keep current read path intact.

### Phase B: Dual Write

- Update ingest/upsert paths to populate new fields and statuses.
- Maintain backward compatibility with old fields.

### Phase C: Historical Backfill

Resumable loop:

1. Select checkpointed batch with keyset pagination.
2. Re-map canonical fields from `raw_json`.
3. Mark URL-placeholder/missing bodies as `pending`.
4. Hydrate eligible candidates.
5. Persist checkpoint + metrics.

### Phase D: Read Switch

- Switch `search_local` and listing tools to canonical fields.
- Keep compatibility fallback for one release window.

### Phase E: Tighten Constraints

- Enforce stronger checks only after coverage thresholds are reached.

---

## Performance and Operability Defaults

### SQLite Runtime

- `PRAGMA journal_mode=WAL`
- `PRAGMA synchronous=NORMAL`
- `PRAGMA busy_timeout=5000`
- Bounded transactions, no long-lived write locks

### Response Guardrails (LLM Safety)

- Preview-first responses
- deterministic chunking for long content:
  - `chunk_size=1200`
  - `overlap=120`
  - include `chunk_index`, `total_chunks`, `content_hash`
- Hard cap on total response size; truncate with explicit metadata

### Monitoring

Track:

- article hydration coverage
- pending/failed/missing counts and ages
- failure distribution by `error_code`
- search latency p95
- hydration throughput + write tx latency

---

## Edge Cases to Validate

- Article metadata present but no body.
- URL-only placeholders.
- Alternate article body field names.
- Deleted/protected posts.
- Duplicate ingest from different sources with conflicting quality.
- Very long/non-English content.
- Concurrent hydrator runs.
- Crash mid-batch and resumability.

---

## Testing Plan

### Unit

- `determineType` article detection cases.
- Canonical mapping and placeholder detection.
- Status transitions + retry/backoff.
- deterministic acceptance policy (hash/score/version).

### DB/Integration

- Migration from current schema.
- Upsert idempotency and CAS behavior.
- Backfill checkpoint resume after forced interruption.
- FTS behavior with long content and title search.
- Tool contract tests for pagination and include-full-content flags.

### Regression

- Reproduce metadata-only article case (for example row `2023823017894133930`) and verify hydration resolves it.

---

## Rollout and Rollback

### Rollout

1. Additive migration.
2. Dual-write ingestion.
3. Backfill dry-run.
4. Controlled hydration batches.
5. Read-path switch to canonical content.
6. Tighten constraints.

### Rollback

- Feature-flag hydration/list/search v2 off.
- Revert read-path to previous fields.
- Keep additive schema in place (no destructive rollback required).
- Re-run idempotent hydrator after fix.

---

## Execution Checklist (BRICK)

Files likely touched:

- `src/db/schema.ts`
- `src/db/index.ts`
- `src/clients/x-api.ts`
- `src/tools/sync-bookmarks.ts`
- `src/tools/ingest-posts.ts`
- `src/tools/search-local.ts`
- new tools: `src/tools/hydrate-articles.ts`, `src/tools/list-local-content.ts`
- `src/types.ts`
- tests under `test/`

Acceptance gates before completion:

- migration + tests pass
- hydration tool works on targeted IDs
- historical backfill repairs known bad row(s)
- token-safe retrieval defaults verified
