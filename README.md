# x-recon

MCP server for X (Twitter) platform data retrieval, AI-powered search, and local knowledge base. Connects any MCP-compatible host (Claude Desktop, Claude Code, OpenCode, Cursor, etc.) to the X platform through 16 tools spanning semantic search, post lookup, user data, bookmarks, and a local SQLite knowledge base with auto-tagging.

## How It Works

x-recon is a [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that runs locally via STDIO. It gives LLM-powered tools direct access to X platform data through three layers:

| Layer | What It Does | Auth |
|-------|-------------|------|
| **X API v2** (`api.x.com/2/`) | Posts, users, timelines, bookmarks, keyword search | Bearer Token (public), OAuth 2.0 PKCE (private) |
| **Grok API** (`api.x.ai/v1/`) | AI-powered semantic search + auto-tagging | Bearer Token (`XAI_API_KEY`) |
| **Local KB** (`~/.x-recon/knowledge.db`) | SQLite with FTS5 — zero-cost tag/search queries | None (local) |

All data is returned as structured JSON. No AI summaries are baked into responses — your agent handles all synthesis and analysis.

---

## Prerequisites

- **Node.js** 18+ (uses native `fetch`)
- **X API Bearer Token** — for public data (posts, users, search)
- **xAI API Key** — for Grok-powered semantic search and auto-tagging

### Getting Your API Keys

#### X API Bearer Token

1. Go to the [X Developer Console](https://console.x.com)
2. Create a new app (or use an existing one)
3. Navigate to **Keys and Tokens**
4. Generate a **Bearer Token**
5. Add pay-per-use credits (X API charges per resource fetched, deduped within 24hr UTC windows)

#### xAI API Key (Grok)

1. Go to [xAI Console](https://console.x.ai)
2. Create an API key
3. Add credits (X Search tool costs $5/1K calls + token costs)

---

## Installation

```bash
git clone https://github.com/your-username/x-recon.git
cd x-recon
npm install
npm run build
```

### Environment Setup

Copy the example env file and fill in your keys:

```bash
cp .env.example .env
```

**.env** contents:

```bash
# Required
XAI_API_KEY=your-xai-api-key
X_API_BEARER_TOKEN=your-x-api-bearer-token

# Optional — OAuth 2.0 (bookmarks + home timeline)
X_API_CLIENT_ID=
X_API_CLIENT_SECRET=

# Optional — defaults shown
GROK_MODEL=grok-4-1-fast-reasoning
GROK_TAGGING_MODEL=grok-3-mini
X_RECON_DB_PATH=~/.x-recon/knowledge.db
LOG_LEVEL=info
```

### Verify the Build

```bash
npm run build      # Compile TypeScript → dist/
npm run test       # Run all tests
npm run start      # Start the MCP server (STDIO mode)
```

---

## OAuth 2.0 Setup (Optional)

OAuth 2.0 is needed for 3 tools: `get_home_timeline`, `list_bookmarks`, `search_bookmarks`, and the `sync_bookmarks` knowledge base tool. All other tools work without it.

### 1. Configure OAuth in X Developer Console

1. In the [X Developer Console](https://console.x.com), enable **OAuth 2.0** on your app
2. Set redirect URI to `http://localhost:3000/callback`
3. Note the **Client ID** and **Client Secret**

### 2. Set Environment Variables

Add to your `.env`:
```bash
X_API_CLIENT_ID=your-client-id
X_API_CLIENT_SECRET=your-client-secret
```

### 3. Authorize

Run the one-time authorization flow:

```bash
npm run authorize
```

This opens your browser to X's authorization page. After you approve, it catches the callback on `localhost:3000` and saves your tokens to `~/.x-recon/tokens.json`. Tokens auto-refresh when they expire.

---

## Connecting to an MCP Host

x-recon communicates over STDIO. After running `npm link`, you can use the `x-recon` command directly.

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "x-recon": {
      "command": "x-recon",
      "env": {
        "XAI_API_KEY": "your-xai-api-key",
        "X_API_BEARER_TOKEN": "your-x-api-bearer-token"
      }
    }
  }
}
```

### Claude Code

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "x-recon": {
      "command": "x-recon",
      "env": {
        "XAI_API_KEY": "your-xai-api-key",
        "X_API_BEARER_TOKEN": "your-x-api-bearer-token"
      }
    }
  }
}
```

### OpenCode

Edit `~/.config/opencode/opencode.json`:

```json
{
  "mcp": {
    "x-recon": {
      "type": "local",
      "command": "x-recon",
      "environment": {
        "XAI_API_KEY": "your-xai-api-key",
        "X_API_BEARER_TOKEN": "your-x-api-bearer-token"
      }
    }
  }
}
```

> **Note**: OpenCode uses `"environment"` (not `"env"`) for environment variables.

### Using 1Password for Secrets

```json
{
  "mcpServers": {
    "x-recon": {
      "command": "op",
      "args": ["run", "--env-file=/path/to/x-recon/.env", "--", "x-recon"]
    }
  }
}
```

---

## Tools Reference

x-recon exposes 16 MCP tools organized into four categories.

### Search Tools

#### `search_posts` — AI-Powered Semantic Search

Semantic search across X using Grok's X Search tool. Finds posts you would never match with keywords alone.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | `string` | *required* | Natural language search query |
| `max_results` | `number` (1-20) | `10` | Maximum posts to return |
| `from_date` | `string` | — | ISO 8601 start date filter |
| `to_date` | `string` | — | ISO 8601 end date filter |
| `handles` | `string[]` (max 10) | — | Filter to specific X handles (no `@` prefix) |

**Costs:** $5/1K Grok X Search calls + Grok token costs + X API credits per hydrated post.

---

#### `search_posts_raw` — Fast Keyword Search

Direct keyword search using X API v2 recent search. No Grok involved. Supports [Twitter search operators](https://developer.x.com/en/docs/twitter-api/tweets/search/integrate/build-a-query).

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | `string` | *required* | Search query (supports `from:`, `to:`, `#`, exact phrases) |
| `max_results` | `number` (1-50) | `20` | Maximum posts to return |
| `mode` | `"latest"` \| `"top"` | `"latest"` | Sort by recency or engagement |

**Note:** Only returns posts from the last 7 days.

---

### Fetch Tools

#### `get_post` — Single Post by ID or URL

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `post` | `string` | *required* | Tweet ID or full URL (x.com or twitter.com) |

---

#### `get_user_posts` — User's Recent Posts

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `handle` | `string` | *required* | X handle without `@` prefix |
| `max_results` | `number` (1-100) | `20` | Maximum posts to return |
| `include_replies` | `boolean` | `false` | Include reply tweets |

---

#### `get_thread` — Full Conversation Thread

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `post` | `string` | *required* | Tweet ID or URL of any post in the thread |
| `include_replies` | `boolean` | `false` | Include replies from other users |

---

#### `get_article` — Long-Form X Article

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `url` | `string` | *required* | URL of the X article or post |

Returns the full `note_tweet` text for posts exceeding 280 characters.

---

#### `get_user_profile` — User Profile Data

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `handle` | `string` | *required* | X handle without `@` prefix |

---

#### `get_home_timeline` — Home Timeline (OAuth required)

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `max_results` | `number` (1-100) | `20` | Maximum posts to return |
| `cursor` | `string` | — | Pagination cursor |

Requires OAuth 2.0. Run `npm run authorize` first.

---

### Bookmark Tools (OAuth required)

All bookmark tools require OAuth 2.0 authorization. Run `npm run authorize` first.

#### `list_bookmarks` — Paginated Bookmark Listing

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `max_results` | `number` (1-100) | `20` | Maximum posts to return |
| `cursor` | `string` | — | Pagination cursor |

---

#### `search_bookmarks` — Search Within Bookmarks

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | `string` | *required* | Keyword to search within bookmarks |
| `max_results` | `number` (1-100) | `20` | Maximum posts to return |
| `cursor` | `string` | — | Pagination cursor |

---

### Knowledge Base Tools

These tools store and query posts locally in SQLite. Queries are free — no API calls.

#### `sync_bookmarks` — Sync Bookmarks to Local KB (OAuth required)

Fetches bookmarks from X, stores them locally, and auto-tags by topic.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `max_pages` | `number` (1-50) | `5` | Pages to sync (20 bookmarks per page) |
| `auto_tag` | `boolean` | `true` | Auto-classify posts using Grok (~$0.005 per 20 posts) |
| `tags` | `string[]` | — | Manually apply these tags to all synced bookmarks |

---

#### `ingest_posts` — Fetch & Store Posts by ID

Fetch posts by ID from X API and store in the local knowledge base. Posts already stored are skipped (no duplicate API cost).

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `post_ids` | `string[]` (1-100) | *required* | Post IDs to fetch and store |
| `tags` | `string[]` | — | Tags to apply to ingested posts |
| `auto_tag` | `boolean` | `true` | Auto-classify using Grok |
| `source` | `string` | `"manual"` | Source label for tracking |

**Tip:** Use this when OAuth isn't configured. Search with `search_posts` or `get_user_posts`, then ingest the interesting post IDs into your local KB.

---

#### `get_posts_by_tag` — Query Posts by Tag

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `tag` | `string` | *required* | Tag to filter by (e.g. `"solana-validator"`) |
| `limit` | `number` (1-500) | `100` | Maximum posts to return |

**Cost:** Zero. Local DB query only.

---

#### `search_local` — Full-Text Search

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | `string` | *required* | Full-text search query |
| `tag` | `string` | — | Narrow search to posts with this tag |
| `limit` | `number` (1-200) | `50` | Maximum posts to return |

**Cost:** Zero. Local FTS5 query only.

---

#### `list_tags` — List All Tags

No parameters. Returns all tags with post counts and total stored posts.

**Cost:** Zero.

---

#### `tag_posts` — Add/Remove Tags

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `post_ids` | `string[]` | *required* | Post IDs to tag |
| `tags` | `string[]` | *required* | Tags to apply |
| `remove` | `boolean` | `false` | Remove tags instead of adding |

---

## Auto-Tag Taxonomy

When `auto_tag: true` is set on `sync_bookmarks` or `ingest_posts`, Grok classifies each post into 1-3 tags from this taxonomy:

`solana-validator` · `solana-defi` · `solana-ecosystem` · `ethereum` · `bitcoin` · `venture-capital` · `macro-analysis` · `market-making` · `onchain-lending` · `defi-general` · `mev` · `infrastructure` · `regulation` · `stablecoins` · `nft` · `ai-crypto` · `trading` · `security` · `other`

Cost: ~$0.005 per batch of 20 posts (uses `grok-3-mini`).

---

## Choosing the Right Tool

```
Need to find posts about a topic?
├── Broad/semantic search    → search_posts (Grok-powered)
├── Exact keyword/hashtag    → search_posts_raw (last 7 days, no AI cost)
└── Already stored locally   → search_local (zero cost)

Have a specific post?
├── By URL or ID             → get_post
├── Need full thread         → get_thread
└── Long-form article        → get_article

Researching a person?
├── Profile info             → get_user_profile
└── Their recent posts       → get_user_posts

Working with bookmarks?
├── Sync to local KB         → sync_bookmarks (one-time, auto-tagged)
├── Browse all live          → list_bookmarks
└── Search live              → search_bookmarks

Local knowledge base?
├── Query by tag             → get_posts_by_tag
├── Full-text search         → search_local
├── See all tags             → list_tags
├── Manage tags              → tag_posts
└── Add posts manually       → ingest_posts
```

---

## Workflow Examples

### Topic Research

```
1. search_posts({ query: "AI agent frameworks 2025" })       → discover posts
2. ingest_posts({ post_ids: [...], auto_tag: true })          → store locally
3. get_posts_by_tag({ tag: "ai-crypto" })                     → pull into context
```

### Bookmark Knowledge Base

```
1. sync_bookmarks({ max_pages: 10, auto_tag: true })          → sync + tag
2. list_tags()                                                 → see what topics you've saved
3. get_posts_by_tag({ tag: "solana-validator", limit: 50 })    → pull topic into context
4. search_local({ query: "firedancer performance" })           → drill down
```

### Person Research

```
1. get_user_profile({ handle: "naval" })                       → who are they
2. get_user_posts({ handle: "naval", max_results: 30 })        → recent posts
3. ingest_posts({ post_ids: [...], tags: ["naval-wisdom"] })   → store favorites
```

---

## Costs

| Source | Pricing | Expected (light use) |
|--------|---------|---------------------|
| X API | Pay-per-resource (deduped 24hr) | ~$1-5/month |
| Grok X Search | $5/1K calls + tokens | ~$1-3/month |
| Grok auto-tagging | ~$0.005 per 20 posts | <$0.50/month |
| Local KB queries | Free | $0 |

---

## Tool Availability

| Tool | Auth Required | Status |
|------|--------------|--------|
| `search_posts` | Bearer Token + xAI Key | Working |
| `search_posts_raw` | Bearer Token | Working |
| `get_post` | Bearer Token | Working |
| `get_user_posts` | Bearer Token | Working |
| `get_thread` | Bearer Token | Working |
| `get_article` | Bearer Token | Working |
| `get_user_profile` | Bearer Token | Working |
| `get_home_timeline` | OAuth 2.0 PKCE | Working (after `npm run authorize`) |
| `list_bookmarks` | OAuth 2.0 PKCE | Working (after `npm run authorize`) |
| `search_bookmarks` | OAuth 2.0 PKCE | Working (after `npm run authorize`) |
| `sync_bookmarks` | OAuth 2.0 PKCE | Working (after `npm run authorize`) |
| `ingest_posts` | Bearer Token + xAI Key | Working |
| `get_posts_by_tag` | None (local) | Working |
| `search_local` | None (local) | Working |
| `list_tags` | None (local) | Working |
| `tag_posts` | None (local) | Working |

---

## Development

```bash
npm run build      # Compile TypeScript → dist/
npm run dev        # Watch mode (recompile on changes)
npm run test       # Run all Vitest tests
npm run start      # Start the MCP server
npm run authorize  # One-time OAuth 2.0 login
```

### Project Structure

```
src/
├── index.ts              # MCP server entry, registers all 16 tools
├── config.ts             # Zod env var validation
├── types.ts              # XPost, XArticle, XUserProfile, PaginatedResponse, TagSummary, SyncResult
├── auth/
│   ├── oauth.ts          # OAuth 2.0 token persistence + auto-refresh
│   └── authorize.ts      # One-time CLI auth flow (opens browser)
├── clients/
│   ├── x-api.ts          # @xdevplatform/xdk client (X API v2)
│   └── grok.ts           # xAI Responses API client (fetch)
├── db/
│   ├── index.ts          # SQLite singleton, CRUD, FTS queries
│   ├── schema.ts         # Table/index/trigger DDL
│   └── tagger.ts         # Grok-based auto-tagging
├── parsers/
│   ├── tweet.ts          # Normalize X API v2 responses → XPost
│   └── citation.ts       # Extract tweet IDs from URLs
└── tools/                # 16 MCP tools, one file each
```

### Tech Stack

- **TypeScript** (ESM, Node16 module resolution)
- **[@modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk)** — MCP server framework (STDIO transport)
- **[@xdevplatform/xdk](https://www.npmjs.com/package/@xdevplatform/xdk)** — Official X API v2 TypeScript SDK
- **[better-sqlite3](https://www.npmjs.com/package/better-sqlite3)** — SQLite with FTS5 for local knowledge base
- **[Zod](https://zod.dev)** — Input validation for all tool parameters
- **[Vitest](https://vitest.dev)** — Testing framework

---

## Troubleshooting

### Preflight checks

Run this before using MCP tools:

```bash
npm run build
op run --env-file=/Users/lukewoodward/_workspace/x-recon/.env -- /Users/lukewoodward/.nvm/versions/node/v24.9.0/bin/node dist/cli/doctor-x.js
```

Expected output:

- `x_api_oauth_bookmarks.status: "ok"`
- `grok_search.status: "ok"`
- `x_api_search_auth.status: "ok"` (or actionable error in `next_steps`)

### Node runtime mismatch (better-sqlite3)

If SQLite operations fail with native module errors, your MCP process and build process are using different Node versions.

Use the same Node binary for MCP startup as build/test (`/Users/lukewoodward/.nvm/versions/node/v24.9.0/bin/node` in this repo setup).

### "Missing or invalid environment variables"

Make sure `XAI_API_KEY` and at least one X auth path are configured:

- `X_API_BEARER_TOKEN` (app/bearer auth), or
- OAuth user auth (`X_API_CLIENT_ID` + `X_API_CLIENT_SECRET` + `npm run authorize`)

### "OAuth 2.0 user authentication required"

Run `npm run authorize` to complete the one-time OAuth login. Requires `X_API_CLIENT_ID` in your environment.

### "HTTP 402 Payment Required"

Your X API app likely needs more credits or higher tier endpoint access. Top up or upgrade in [console.x.com](https://console.x.com).

### "HTTP 400 Bad Request" on search endpoints

This can indicate endpoint access/tier constraints on your X app, even if bookmarks work. Verify search endpoint entitlement and billing in [console.x.com](https://console.x.com).

### "Post {id} not found"

The post may be deleted, from a suspended account, or protected (private).

### "User @{handle} not found"

The username may be misspelled, suspended, or renamed. Don't include the `@` prefix.

### "Grok API error 429"

Rate limited. Wait and retry. For high-volume work, prefer `search_posts_raw` over `search_posts`.

### "Grok API error 401"

Your `XAI_API_KEY` is invalid or expired. Generate a new one at [console.x.ai](https://console.x.ai).

### X API rate limits

Per-endpoint, per-app. The SDK handles retries automatically. Reduce `max_results` or add delays if hitting limits frequently.

---

## License

MIT
