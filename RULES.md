# RULES.md

Repository operating rules for `x-recon`.

These rules are for humans and coding agents. They define required behavior for architecture, data integrity, security, and operational safety.

## 1) Rule Priority

When rules conflict, use this order:

1. System/developer/tooling instructions
2. This `RULES.md`
3. `CLAUDE.md` and other docs

`CLAUDE.md` provides architecture/context. `RULES.md` defines enforceable repo policy.

## 2) Product Contract

`x-recon` must provide reliable MCP access to:

- X posts
- long-form X articles
- local knowledge base search/retrieval

Core product expectation:

- Article rows must not degrade to URL stubs when full content is available.
- LLM-facing tool responses must be token-safe by default.

## 3) Security and Secret Handling

- Never log, print, or persist secret values.
- Never write plaintext API keys/tokens into source, tests, SQL, or docs.
- If `.env` contains `op://...`, run commands with:

```bash
op run --env-file=".env" -- <command>
```

- Do not rely on `source .env` for `op://` references.
- Treat auth failures as blockers for mutation flows that depend on external APIs.

## 4) Data Model and SQL Migration Rules

- SQL migrations must be additive and idempotent on live data.
- For SQLite/SQL schema evolution:
  - introspect current schema
  - add only missing columns/indexes/triggers
  - avoid destructive resets
- Never require dropping user data to apply schema changes.
- Any FTS schema change must include safe rebuild logic and trigger re-sync.

## 5) Content Canonicalization Rules

- Canonical content must be derived consistently at all write points.
- For article-like posts, URL-only content (for example `https://t.co/...`) is placeholder data.
- Placeholder content must not be marked as fully hydrated.
- Preserve raw provider payload in `raw_json` for audit/reparse.

## 6) Content Status State Machine (Required)

Allowed statuses:

- `new`
- `pending`
- `fetching`
- `hydrated`
- `partial`
- `failed`
- `missing`
- `stale`

Rules:

- Only hydrator logic may move rows into `fetching`.
- `fetching` rows must always have a recovery path (retry/fail/reset timeout).
- Every transition should update audit metadata (attempt count, timestamps, error code when applicable).
- Terminal states (`missing`) must be explicit and reversible only via force/manual rehydrate.

## 7) Deterministic Merge + Concurrency Rules

- Multi-source writes (bookmark ingest, manual ingest, hydration) must use deterministic acceptance.
- Use normalized content hash and quality scoring for conflict decisions.
- Use optimistic concurrency/version checks for updates touching hydrated content.
- Never let low-quality payloads overwrite higher-quality hydrated content.

## 8) Hydration Rules

- Hydration must support:
  - dry-run mode
  - bounded batch processing
  - retry/backoff classification
  - explicit terminal failure handling
- Retryable vs terminal errors must be categorized and recorded.
- Hydration must be idempotent and safe to rerun.

### Article fallback behavior

- If official API payload lacks article body, fallback retrieval path may be used.
- Fallback integrations must:
  - fail closed (do not corrupt existing content)
  - preserve deterministic merge rules
  - degrade gracefully when provider behavior changes

## 9) Backfill Rules

- Backfills must be resumable with persisted checkpoints.
- Use bounded transactions/batches.
- Do not hold long write locks.
- Backfills must be restart-safe and re-entrant.

## 10) MCP Tool Contract Rules

Default behavior for local content/search tools:

- return snippet-first payloads
- paginate responses
- enforce hard output-size caps
- require explicit opt-in for full content

Tool contract changes:

- preserve backward compatibility where possible
- if breaking, version tool behavior and document migration path

## 11) Performance and Operability

- Use WAL-safe SQL settings for local DB operations.
- Keep write transactions short and bounded.
- Avoid unbounded scans in hot paths.
- Ensure indexed paths for hydration queues and common filters.

## 12) Testing Requirements

Any change touching ingestion/hydration/schema/tool contracts must include tests for:

- migration safety/idempotency
- canonicalization and placeholder detection
- state transitions and retry logic
- deterministic merge/idempotency under repeated writes
- tool output guardrails (pagination/size caps)

Regression tests are required for previously observed failures.

## 13) Observability Requirements

Implement and preserve visibility into:

- hydration coverage and backlog by status
- retry/failure counts by error class
- stuck `fetching` rows
- invariant violations (invalid status/source, hydrated with empty content)

## 14) Non-Negotiable Invariants

- No secret leakage.
- No destructive schema reset in normal evolution.
- No silent downgrade from hydrated content to placeholder content.
- No unbounded full-content dumps in default MCP responses.

## 15) PR/Change Checklist

Before merge, verify:

- build passes
- tests pass
- migration is additive/idempotent
- tool responses remain token-safe by default
- invariants validated via SQL checks

## 16) Documentation Rules

- Keep `CLAUDE.md` for architecture and workflow context.
- Keep `RULES.md` for enforceable policy.
- Update both when behavior changes materially.
