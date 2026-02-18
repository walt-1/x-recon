# Future Enhancements (DDIA-Informed)

The following issues were identified by applying principles from *Designing Data-Intensive Applications* (Kleppmann). They are not blockers for the MVP but should be addressed as the system matures.

## 1. Tail Latency Amplification (DDIA Ch. 1, p.16)

**Problem:** `search_posts` is a fan-out pipeline: 1 Grok call → extract N tweet IDs → N parallel `getTweet` calls. DDIA Figure 1-5: *"Even if only a small percentage of backend calls are slow, the chance of getting a slow call increases if an end-user request requires multiple backend calls."* With 10 parallel fetches where each has a 1% chance of exceeding 5s, there's a ~10% chance the overall request exceeds 5s. With 20 fetches, ~18%.

**Current gap:** No per-fetch timeouts. No overall request timeout. No partial result strategy.

**Enhancement:**
- Add per-tweet fetch timeout (5s per individual fetch)
- Add overall tool timeout (30s for `search_posts`, 10s for `get_post`, 15s for `list_bookmarks`)
- Return partial results when some fetches timeout or fail
- Extend response types:

```typescript
interface SearchPostsResponse {
  data: XPost[];
  partial: boolean;             // true if some hydrations failed
  failed_ids: string[];         // tweet IDs that couldn't be fetched
  citation_urls: string[];      // raw Grok citation URLs (always returned)
  timing_ms: number;            // total pipeline duration
}
```

---

## 2. Degradation Strategy Per Backend (DDIA Ch. 8)

**Problem:** The system depends on 3 independent external services. DDIA Ch. 8: *"Whenever any communication happens over a network, it may fail — there is no way around it."* The current plan treats failures as exceptions rather than normal operating conditions.

**Current gap:** "Degraded mode" is mentioned but not defined per-tool or per-backend.

**Enhancement — define explicit degradation modes:**

| Backend failure | `search_posts` | Raw fetch tools | Bookmark tools |
|---|---|---|---|
| Twitter auth down | Returns unhydrated citation URLs only | Error with clear message | Error with clear message |
| Grok API down | Unavailable (suggest `search_posts_raw`) | Fully functional | Fully functional |
| GraphQL query ID stale | Fully functional | Fully functional | Attempt auto-refresh from JS bundle; if fails, return error with manual instructions |
| Rate limited | Return partial results + retry-after | Return error + retry-after | Return error + retry-after |

Each tool response should include a `warnings: string[]` field for non-fatal issues encountered during execution.

---

## 3. Defensive Parsing Against Fragile Assumptions (DDIA Ch. 1, p.8-9)

**Problem:** DDIA warns: *"The software is making some kind of assumption about its environment — and while that assumption is usually true, it eventually stops being true."*

**Current fragile assumptions:**
1. Grok citation URLs always match `x.com/*/status/{id}` — Grok could return `twitter.com` URLs, shortened URLs, or new formats
2. GraphQL `BookmarkTimeline` response nests at `data.bookmark_timeline_v2.timeline.instructions[0].entries` — any restructuring breaks parsing
3. agent-twitter-client's `Tweet` type has stable field names
4. The static bearer token (`AAAAAAAAAAAAAAAAAAAAANRILgAA...`) persists indefinitely

**Enhancement:**
- Citation parser: support multiple URL patterns (`x.com`, `twitter.com`, `t.co` with expansion), log warnings on unrecognized formats instead of silently dropping
- GraphQL parser: defensive traversal with optional chaining at every level, log the raw response shape on parse failure for debugging
- Tweet normalizer: every field access wrapped with defaults, log when expected fields are missing
- Bearer token: extract dynamically from Twitter's JS bundle alongside query IDs, fall back to hardcoded
- Add a `parseWarnings: string[]` field to track when data shapes deviate from expectations

---

## 4. Observability (DDIA Ch. 1, p.18-20)

**Problem:** DDIA Operability: *"Set up detailed and clear monitoring, such as performance metrics and error rates... keeping track of how different systems affect each other, so that a problem can be anticipated before it causes damage."*

**Current gap:** `LOG_LEVEL` env var and nothing else. A system with 3 unreliable backends and rotating credentials will silently degrade.

**Enhancement — add `health` tool (tool #12):**

```typescript
server.tool('health', z.object({}), async () => {
  return {
    twitter_auth: 'ok' | 'expired' | 'failed',
    grok_api: 'ok' | 'unreachable' | 'rate_limited',
    graphql_bookmarks: 'ok' | 'query_id_stale' | 'auth_failed',
    cookie_age_hours: number,
    grok_requests_today: number,
    last_error: string | null,
    uptime_seconds: number
  };
});
```

**Structured logging:**
- Every tool call logs: tool name, backend(s) used, response time ms, success/failure, upstream status codes
- Auth events: login success/failure, cookie refresh, cookie age warnings (>48h)
- GraphQL events: query ID used, rotation detected, auto-refresh attempts

---

## 5. Reduce Accidental Complexity (DDIA Ch. 12)

**Problem:** DDIA Ch. 12: *"The complexity of running several different pieces of infrastructure can be a problem... it is worth deploying as few moving parts as possible."* The current plan has 3 separate clients (`twitter.ts`, `grok.ts`, `graphql.ts`) with 2 different auth flows and 2 separate tweet normalizers (`normalizeTweet` for agent-twitter-client, `normalizeGraphQLTweet` for bookmarks).

**Enhancement:**
- Single auth module that produces a unified session object (cookies + tokens) consumed by all clients
- Single normalizer with a discriminated input type:

```typescript
type RawTweetInput =
  | { source: 'scraper'; data: Tweet }       // agent-twitter-client
  | { source: 'graphql'; data: GraphQLNode }; // BookmarkTimeline

function normalizeToXPost(input: RawTweetInput): XPost {
  // One function, one source of truth for XPost mapping
}
```

- Investigate whether agent-twitter-client can be extended to handle bookmarks (monkey-patch or upstream PR), which would eliminate the separate GraphQL client entirely
- Add `source: 'scraper' | 'graphql' | 'grok'` field to `XPost` so consumers know the data provenance and can expect certain fields to be absent

---

## 6. Schema Evolution (DDIA Ch. 4, p.111-120)

**Problem:** The `XPost` interface is rigid. DDIA Ch. 4: forward compatibility means newer data shapes should be handled by current code gracefully. Twitter adds fields constantly (Community Notes, Spaces, polls, etc.). Rigid types will break or silently drop data.

**Enhancement:**
- Add `raw: unknown` field to `XPost` preserving the original upstream object for debugging and forward compatibility
- All fields except `id`, `text`, `author`, `timestamp`, `source_url` should be optional
- Normalizers should be permissive readers: unknown fields ignored, missing fields default to `undefined` / `0`
- Add `source` field for data provenance:

```typescript
interface XPost {
  // Core (always present)
  id: string;
  text: string;
  author: { handle: string; name: string; id: string };
  timestamp: string;
  source_url: string;
  source: 'scraper' | 'graphql' | 'grok';

  // Optional (may be absent depending on source)
  metrics?: { likes?: number; retweets?: number; replies?: number; views?: number; bookmarks?: number };
  media?: { type: string; url: string; alt?: string }[];
  urls?: string[];
  hashtags?: string[];
  mentions?: string[];
  in_reply_to?: string;
  quoted_tweet_id?: string;
  is_thread?: boolean;
  verified?: boolean;

  // Forward compatibility
  raw?: unknown;
}
```

---

## 7. Pipeline Idempotency (DDIA Ch. 12)

**Problem:** DDIA Ch. 12: *"Derived data should be deterministic and idempotent."* The `search_posts` pipeline (Grok → extract IDs → hydrate) is not idempotent — calling it twice with the same query can return different Grok results, different citation ordering, and different hydration outcomes. For research and training data use cases, reproducibility matters.

**Enhancement:**
- `search_posts` should always return `citation_urls` alongside hydrated posts, giving the user a stable reference set of discovered posts
- Add an optional `cache_ttl` parameter: if the same query was run within the TTL window, reuse cached tweet IDs (hydrate fresh, but keep discovery stable)
- Consider a local cache file (JSON) for recent query → citation ID mappings:

```typescript
// Optional cache for search result stability
interface SearchCache {
  query: string;
  timestamp: string;
  citation_ids: string[];
  ttl_seconds: number;
}
```

This allows an agent to re-run a query and get the same set of posts, even if Grok's results have shifted, enabling reproducible research workflows.
