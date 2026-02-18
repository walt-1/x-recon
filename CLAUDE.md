# x-recon

MCP server for X platform data retrieval, AI-powered search, and local knowledge base. Three layers: X API for data, Grok for AI search, SQLite for local storage.

## API Reference (always consult these)

- **X API (data)**: https://docs.x.com/overview — Posts, users, bookmarks, timelines. OAuth 2.0 PKCE auth, pay-per-use credits.
- **xAI Grok API (AI)**: https://docs.x.ai/overview — Semantic search, X Search tool, reasoning. Bearer token auth, token-based pricing.
- **X Developer Console**: https://console.x.com — App setup, API keys, OAuth config, credit management.
- **X TypeScript SDK**: https://docs.x.com/xdks/typescript/overview — `@xdevplatform/xdk`, typed client with auto-pagination.

## Architecture

Three layers, clean separation:

| Layer | API | Auth | Purpose |
|-------|-----|------|---------|
| **X API** (`@xdevplatform/xdk`) | `api.x.com/2/` | Bearer Token (public) / OAuth 2.0 PKCE (user) | Posts, users, bookmarks, timelines, search |
| **Grok API** (raw fetch) | `api.x.ai/v1/` | Bearer `XAI_API_KEY` | Semantic search via X Search tool, auto-tagging |
| **Local KB** (`better-sqlite3`) | `~/.x-recon/knowledge.db` | N/A | FTS5 search, tag-based retrieval, zero-cost queries |

```
src/
├── index.ts              # MCP server entry, wires all 16 tools
├── config.ts             # Zod env var validation
├── types.ts              # XPost, XArticle, XUserProfile, PaginatedResponse, TagSummary, SyncResult
├── auth/
│   ├── oauth.ts          # OAuth 2.0 token persistence + refresh
│   └── authorize.ts      # One-time CLI auth script (browser + localhost callback)
├── clients/
│   ├── x-api.ts          # @xdevplatform/xdk client (X API v2)
│   └── grok.ts           # xAI Responses API client (fetch)
├── db/
│   ├── index.ts          # SQLite singleton, CRUD helpers, FTS queries
│   ├── schema.ts         # Table/index/trigger DDL (ensureSchema)
│   └── tagger.ts         # Grok-based auto-tagging (batch classification)
├── parsers/
│   ├── tweet.ts          # Normalize X API v2 responses → XPost
│   └── citation.ts       # Extract tweet IDs from URLs
└── tools/                # MCP tools, one file each
    ├── search-posts.ts       # Grok X Search (semantic, public)
    ├── search-posts-raw.ts   # X API recent search (keyword, public)
    ├── get-post.ts           # X API post lookup by ID
    ├── get-user-posts.ts     # X API user timeline
    ├── get-thread.ts         # X API conversation lookup
    ├── get-article.ts        # X API post lookup (long-form)
    ├── get-user-profile.ts   # X API user lookup
    ├── get-home-timeline.ts  # X API reverse chronological timeline (OAuth)
    ├── list-bookmarks.ts     # X API bookmarks (OAuth)
    ├── search-bookmarks.ts   # X API bookmarks + client-side filter (OAuth)
    ├── sync-bookmarks.ts     # Sync bookmarks → local KB + auto-tag
    ├── ingest-posts.ts       # Fetch posts by ID → local KB
    ├── get-posts-by-tag.ts   # Query local KB by tag
    ├── search-local.ts       # FTS search across local KB
    ├── list-tags.ts          # List all tags with counts
    └── tag-posts.ts          # Add/remove tags on stored posts
```

## Tech Stack

- **TypeScript** (ESM, Node16 module resolution)
- **@modelcontextprotocol/sdk** — MCP server framework (STDIO transport)
- **@xdevplatform/xdk** — Official X API v2 TypeScript SDK
- **better-sqlite3** — SQLite with FTS5 for local knowledge base
- **Zod** — Input validation for all tool parameters
- **Vitest** — Testing framework
- **Grok API** — xAI Responses API with X Search tool + Chat Completions for tagging

## X API Key Concepts

- **Pay-per-use credits**: No subscription. Charged per resource fetched. Deduped within 24hr UTC window.
- **OAuth 2.0 PKCE**: Required for user-context endpoints (bookmarks, home timeline). One-time `npm run authorize` flow. Tokens stored at `~/.x-recon/tokens.json`, auto-refreshed.
- **Bearer Token**: For public data (post lookup, user lookup, recent search). Simpler auth.
- **Rate limits**: Per-endpoint, per-app. SDK handles retries.
- **Fields/Expansions**: X API returns minimal data by default. Use `tweet.fields`, `user.fields`, `expansions` params to get full data.

## xAI Grok Key Concepts

- **X Search tool**: Server-side tool via Responses API. $5/1K calls. Searches X posts in real-time.
- **Chat Completions**: Used for auto-tagging via `GROK_TAGGING_MODEL` (default `grok-3-mini`). ~$0.005 per 20 posts.
- **Endpoint**: `POST https://api.x.ai/v1/responses` with `tools=[{type:'x_search'}]`
- **Returns citations**: Grok returns source URLs from annotations, hydrated via X API.

## Local Knowledge Base

- **DB file**: `~/.x-recon/knowledge.db` (configurable via `X_RECON_DB_PATH`)
- **FTS5**: Full-text search on post text, author handle, author name
- **Tags**: Many-to-many, lowercase hyphenated (e.g. `solana-validator`, `macro-analysis`)
- **Auto-tagging taxonomy**: `solana-validator`, `solana-defi`, `solana-ecosystem`, `ethereum`, `bitcoin`, `venture-capital`, `macro-analysis`, `market-making`, `onchain-lending`, `defi-general`, `mev`, `infrastructure`, `regulation`, `stablecoins`, `nft`, `ai-crypto`, `trading`, `security`, `other`
- **Sync log**: Tracks bookmark sync cursor + timestamps
- **Zero-cost queries**: `get_posts_by_tag`, `search_local`, `list_tags` hit local DB only

## Environment Variables

Required:
- `XAI_API_KEY` — xAI API key for Grok semantic search + auto-tagging
- `X_API_BEARER_TOKEN` — X API Bearer Token (public data)

Optional:
- `X_API_CLIENT_ID` — X API OAuth 2.0 Client ID (bookmarks, home timeline)
- `X_API_CLIENT_SECRET` — X API OAuth 2.0 Client Secret
- `GROK_MODEL` — defaults to `grok-4-1-fast-reasoning`
- `GROK_TAGGING_MODEL` — defaults to `grok-3-mini`
- `X_RECON_DB_PATH` — defaults to `~/.x-recon/knowledge.db`
- `LOG_LEVEL` — defaults to `info`

## Build & Run

```bash
npm run build      # tsc → dist/
npm run dev        # tsc --watch
npm run start      # node dist/index.js
npm run authorize  # One-time OAuth 2.0 login (opens browser)
npm run test       # vitest
```

## Relevant Skills

When working in this codebase, use these skills:

- **mcp-builder** — MCP server patterns and best practices
- **typescript-mcp** — TypeScript MCP server conventions
- **vitest** — Testing patterns for Vitest
- **zod** — Zod schema validation patterns
