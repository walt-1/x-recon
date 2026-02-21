# Smart Bookmark Sync Implementation Plan

## Objective

Implement a "smart sync" mode for `sync_bookmarks` that minimizes redundant API calls by stopping when overlap with already-ingested bookmarks is detected, with optional date-bound stopping for historical backfills.

Current behavior always starts at newest and fetches a fixed `max_pages`; this plan upgrades sync to fetch only what is needed.

## Scope

In scope:
- Update `sync_bookmarks` tool logic in `src/tools/sync-bookmarks.ts`
- Add optional schema parameters for smart stopping
- Add DB helper(s) needed for date/ID checks
- Add tests for smart-stop logic and edge cases
- Update README docs for new behavior

Out of scope:
- Changing X API client pagination primitives
- Replacing cursor semantics in X API
- Background job scheduler or daemonized sync

## Desired Behavior

### Baseline smart mode (default)

When `sync_bookmarks` runs:
1. Fetch newest page(s) in order.
2. Upsert page data.
3. Stop early when overlap is detected with existing DB rows.

Overlap detection rule (v1):
- If **any post ID in current page** already exists in DB before this run, treat as overlap.
- Stop after processing this page.

Rationale: once overlap appears, we have reached previously synced region; further pages are likely old already-synced data.

### Optional date cutoff

Support `stop_before` (ISO 8601) to stop sync once page contains posts older than cutoff.

Rule:
- Process current page.
- If the page's oldest post timestamp is older than `stop_before`, stop.

This supports requests like: "fetch until older than Dec 2025".

### Manual backfill behavior

When caller explicitly requests large `max_pages`, smart-stop still applies unless disabled with `force_full_scan`.

## API Contract Changes

File: `src/tools/sync-bookmarks.ts`

Extend `syncBookmarksSchema` with:
- `stop_on_overlap: z.boolean().default(true)`
- `stop_before: z.string().datetime().optional()`
- `force_full_scan: z.boolean().default(false)`

Behavior matrix:
- `force_full_scan=true` -> ignore overlap/date stops; fetch until `max_pages` or API exhausted.
- Else stop when either condition is met:
  - overlap found and `stop_on_overlap=true`
  - page crosses `stop_before`

## Data / DB Changes

### Existing helpers used
- `getPostById(id)` exists and is sufficient for overlap checks.
- `logSync(type, postsSynced, cursor)` exists and should continue.

### Optional helper enhancement (recommended)

Add a lightweight helper to reduce per-ID DB calls on large pages:
- `getExistingPostIds(ids: string[]): Set<string>` in `src/db/index.ts`

Implementation concept:
- single `IN (...)` query for page IDs
- return set for O(1) overlap checks

Benefit: avoids N calls to `getPostById` per page.

No schema migration required.

## Algorithm Design

File: `src/tools/sync-bookmarks.ts`

Per run state:
- `allPosts: XPost[]`
- `newPosts: XPost[]`
- `pagesFetched`
- `cursor`
- stop reason enum: `none | overlap | date_cutoff | no_more_pages | max_pages`

Loop per page:
1. Fetch with `listBookmarks(20, cursor)`.
2. If empty data -> break `no_more_pages`.
3. Determine overlap for current page (pre-upsert check):
   - using `getExistingPostIds` (or fallback `getPostById`).
4. Append page to `allPosts`; append truly new IDs to `newPosts`.
5. Upsert page posts (or batch after loop; either is acceptable, prefer per-page for crash safety).
6. Evaluate stop conditions (unless `force_full_scan`):
   - overlap condition
   - `stop_before` condition (compare oldest timestamp in page)
7. If stop condition met -> break.
8. Move to next cursor; if no cursor/has_more false -> break.

Post-loop:
- Auto-tag `newPosts` only.
- Apply manual `tags` to all synced posts.
- Log sync with final cursor.
- Return enriched result with stop metadata.

## Return Payload Enhancement

Extend `SyncResult` in `src/types.ts` with optional fields:
- `stop_reason?: 'overlap' | 'date_cutoff' | 'max_pages' | 'no_more_pages'`
- `overlap_detected?: boolean`
- `cutoff_reached?: boolean`

Keep existing fields unchanged for backward compatibility:
- `total_synced`, `new_posts`, `tags_applied`, `pages_fetched`

## Testing Plan

### Unit tests

Primary file: `src/__tests__/tools/sync-bookmarks.test.ts`

Add cases:
1. Stops on overlap after first overlapped page.
2. Continues when no overlap.
3. Stops on `stop_before` date.
4. `force_full_scan=true` ignores overlap/date and continues.
5. Auto-tag applies only to new posts, not overlapped posts.
6. Manual tags still applied to all synced posts.
7. Correct `stop_reason` in response.

### DB helper tests (if new helper added)

File: `src/__tests__/db/index.test.ts`
- `getExistingPostIds` returns exact matching subset.

### Regression tests

Ensure existing behavior still valid when smart knobs are default:
- output shape compatibility
- no breakage in `sync_bookmarks` MCP tool registration

## Edge Cases

- **Out-of-order timestamps in page**: compute oldest timestamp defensively using `Math.min` over parsed dates.
- **Malformed timestamp**: ignore invalid timestamps for cutoff check, continue with overlap logic.
- **All posts already known on first page**: still upsert page and return quickly with `stop_reason=overlap`, `new_posts=0`.
- **Cursor invalidation by platform changes**: handle API errors via existing error normalization; return actionable error.
- **Duplicate IDs across pages**: dedupe `newPosts` by ID before tagging to avoid duplicate work.

## Observability / Diagnostics

Add lightweight debug fields in response (safe, non-sensitive):
- `first_synced_timestamp`
- `last_synced_timestamp`

These help verify backfills and date cutoff correctness.

## Documentation Updates

Update `README.md`:
- `sync_bookmarks` parameter table with new knobs
- examples:
  - "sync only new bookmarks"
  - "backfill until 2025-12-01"
  - "force full scan"

Example calls:

```json
{ "max_pages": 10, "auto_tag": true }
```

```json
{ "max_pages": 50, "auto_tag": true, "stop_before": "2025-12-01T00:00:00Z" }
```

```json
{ "max_pages": 50, "auto_tag": false, "force_full_scan": true }
```

## Rollout Strategy

Phase 1 (safe default):
- Ship overlap stop enabled by default.
- Keep `max_pages` as hard safety cap.

Phase 2:
- Monitor sync outputs for stop_reason distribution.
- Tune overlap strategy if false positives occur (e.g., require >=3 overlapped IDs before stop).

## Risks and Mitigations

- Risk: stopping too early on a single overlapped ID.
  - Mitigation: return stop metadata and allow `force_full_scan` override.

- Risk: users expect strict date boundaries.
  - Mitigation: document that stop happens after processing boundary page; include timestamps in response.

- Risk: more complex sync logic increases test burden.
  - Mitigation: isolate stop-condition evaluation into small pure helper functions and unit-test them.

## Acceptance Criteria

1. `sync_bookmarks` stops early when overlap is detected (default behavior).
2. `stop_before` cutoff works for historical backfills.
3. `force_full_scan` bypasses smart stopping.
4. Existing sync response fields remain intact; new fields are additive.
5. Tests cover overlap/date/override paths and pass.
6. README documents new parameters and usage patterns.

## Suggested Implementation Order

1. Add types/schema params (`types.ts`, `sync-bookmarks.ts`).
2. Add DB helper (`getExistingPostIds`) and tests.
3. Refactor sync loop with stop-condition helpers.
4. Update result payload and tests.
5. Update README.
6. Run full test suite.

## Bookmark Reference Expansion Spec (BRICK-Ready)

### Scope

Add reference expansion to `sync_bookmarks` so missing referenced posts are ingested as separate rows during bookmark sync.

### Out of Scope

- No new tables.
- No migration work.
- No changes to existing tag taxonomy logic.
- No retries or backoff system in v1.
- No ingestion of non-X external URLs.

### Files To Change

- `src/tools/sync-bookmarks.ts`
- `src/parsers/citation.ts`
- `src/db/index.ts`
- `src/types.ts`
- `src/__tests__/tools/sync-bookmarks.test.ts` (new)
- `src/__tests__/db.test.ts`
- `README.md`
- `SMART_BOOKMARK_SYNC_PLAN.md`

### Definitions

- **Bookmark posts**: posts fetched by `listBookmarks`.
- **Referenced IDs**: candidate post IDs found from bookmark posts.
- **Hydrated refs**: referenced posts fetched by ID from X API and upserted.
- **Existing refs**: referenced IDs already in local DB or already present in current bookmark batch.

### Hard Requirements

1. Keep current bookmark sync behavior intact.
2. Add reference expansion as an additive step after bookmark upsert.
3. Keep sync idempotent across repeated runs.
4. Never auto-tag hydrated refs in v1.
5. Never fail entire sync for partial reference fetch misses.
6. Return deterministic sync counters for reference expansion.

### Step 1: Extend Citation Parser Helpers

Implement in `src/parsers/citation.ts`.

1. Add `extractTweetIdsFromUrls(urls: string[]): string[]`.
2. Add `extractTweetIdsFromText(text: string): string[]`.
3. Reuse current URL matching rules for:
   - `x.com/<handle>/status/<id>`
   - `twitter.com/<handle>/status/<id>`
4. Accept only numeric IDs.
5. Deduplicate while preserving first-seen order.
6. Keep existing exports `extractTweetId` and `extractTweetIds` unchanged.

### Step 2: Add DB Helper For Bulk Existence

Implement in `src/db/index.ts`.

1. Add `getExistingPostIds(ids: string[]): Set<string>`.
2. Behavior:
   - Input `[]` returns empty `Set`.
   - Query `posts.id` in one SQL statement using `IN`.
   - Return only IDs that exist.
3. Export helper for tool use.
4. Add tests in `src/__tests__/db.test.ts` for:
   - empty input
   - mixed existing and missing
   - duplicate input IDs

### Step 3: Extend Sync Result Contract

Implement in `src/types.ts`.

Add required fields to `SyncResult`:
- `referenced_candidates: number`
- `referenced_existing: number`
- `referenced_fetched: number`
- `referenced_inserted: number`
- `referenced_failed: number`

Notes:
- Keep existing fields unchanged:
  - `total_synced`
  - `new_posts`
  - `tags_applied`
  - `pages_fetched`

### Step 4: Add Reference Collection In Sync Tool

Implement in `src/tools/sync-bookmarks.ts`.

1. Add local helper `collectReferencedIds(posts: XPost[]): string[]`.
2. For each bookmark post, collect candidates in this exact order:
   1) `quoted_tweet_id`
   2) `in_reply_to`
   3) IDs from `urls[]` via parser helper
   4) IDs from `source_url` via parser helper
3. If `post.article` exists, still rely on URL-derived status IDs.
4. Reject non-numeric IDs.
5. Deduplicate globally while preserving first-seen order.
6. Exclude self IDs where candidate equals current post `id`.

### Step 5: Add Reference Hydration Step

Implement in `src/tools/sync-bookmarks.ts` using existing API and DB helpers.

Execution order:
1. Fetch bookmark pages.
2. Upsert bookmark posts with source `bookmark` as today.
3. Build `referenced_candidates` using `collectReferencedIds`.
4. Exclude candidates already present in current bookmark batch.
5. Bulk check DB with `getExistingPostIds`.
6. Compute `toHydrate = candidates - batchIds - existingDbIds`.
7. Fetch `toHydrate` in chunks of 100 with `getPostsByIds`.
8. Upsert fetched refs with source `bookmark_ref`.
9. Continue on partial misses. Do not throw for missing IDs.
10. Record counters:
    - `referenced_candidates` total candidates before exclusions
    - `referenced_existing` excluded as existing in batch or DB
    - `referenced_fetched` number returned by API
    - `referenced_inserted` number passed to upsert for refs
    - `referenced_failed` `toHydrate.length - referenced_fetched`
11. Preserve existing new post detection and tag behavior for bookmark posts only.
12. Keep `logSync('bookmarks', allPosts.length, cursor)` behavior unchanged.

### Step 6: Tagging Rules

1. Auto-tag logic remains limited to `newPosts` from bookmark fetch.
2. Manual `tags` input applies only to synced bookmark posts.
3. Hydrated refs from `bookmark_ref` receive no tags in v1.

### Step 7: Error Handling Rules

1. If bookmark page fetch fails, fail tool as current behavior.
2. If reference hydration fails for a chunk:
   - count all IDs in that failed chunk as failed
   - continue with next chunk
3. If a single `getPostsByIds` call returns fewer posts than requested:
   - treat missing IDs as failed
   - continue flow
4. Never throw due to reference-only misses.

### Step 8: Unit Tests

Create `src/__tests__/tools/sync-bookmarks.test.ts`.

Required test cases:
1. **Quote ref hydration**
   - bookmark post has `quoted_tweet_id`
   - local DB missing quoted post
   - sync inserts quoted post as separate row with source `bookmark_ref`
2. **Article URL ref hydration**
   - bookmark post has `article` and URL pointing to `status/<id>`
   - missing locally
   - sync hydrates and inserts referenced post
3. **No re-fetch when existing**
   - referenced ID already in DB
   - `getPostsByIds` not called for that ID
4. **De-dup across bookmarks**
   - same referenced ID appears in multiple bookmark posts
   - fetched once, inserted once
5. **Partial fetch failure**
   - API returns subset of requested IDs
   - sync succeeds
   - `referenced_failed` reflects missing count
6. **No auto-tag for hydrated refs**
   - auto-tag enabled
   - only new bookmark posts are tagged
   - refs remain untagged
7. **Counter integrity**
   - verify all reference counters are exact and deterministic

### Step 9: Documentation Updates

1. Update `README.md` for `sync_bookmarks`:
   - new behavior: reference expansion for quote/reply/status URLs
   - new `SyncResult` fields with definitions
   - explicit note that hydrated refs are not auto-tagged
2. Update `SMART_BOOKMARK_SYNC_PLAN.md`:
   - add this implementation block under planned work
   - keep overlap-stop work as separate track

### Acceptance Criteria

1. Running `sync_bookmarks` ingests missing referenced posts as separate rows.
2. Re-running the same sync does not create duplicates.
3. Existing bookmark sync behavior remains unchanged for tags and base counters.
4. New reference counters are present and correct.
5. All new tests pass.

### Validation Commands

Run in `~/_workspace/x-recon`:
- `npm test`
- `npm test -- sync-bookmarks`
- `npm test -- db`
