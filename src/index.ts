#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { loadConfig } from './config.js';
import { getXClient } from './clients/x-api.js';

import { searchPostsSchema, searchPosts } from './tools/search-posts.js';
import { searchPostsRawSchema, searchPostsRaw } from './tools/search-posts-raw.js';
import { getPostSchema, getPost } from './tools/get-post.js';
import { getUserPostsSchema, getUserPosts } from './tools/get-user-posts.js';
import { getThreadSchema, getThread } from './tools/get-thread.js';
import { getArticleSchema, getArticle } from './tools/get-article.js';
import { getUserProfileSchema, getUserProfile } from './tools/get-user-profile.js';
import { getHomeTimelineSchema, getHomeTimeline } from './tools/get-home-timeline.js';
import { listBookmarksSchema, listBookmarks } from './tools/list-bookmarks.js';
import { searchBookmarksSchema, searchBookmarks } from './tools/search-bookmarks.js';
import { syncBookmarksSchema, syncBookmarks } from './tools/sync-bookmarks.js';
import { ingestPostsSchema, ingestPosts } from './tools/ingest-posts.js';
import { getPostsByTagSchema, getPostsByTagHandler } from './tools/get-posts-by-tag.js';
import { searchLocalSchema, searchLocal } from './tools/search-local.js';
import { listLocalContentSchema, listLocalContent } from './tools/list-local-content.js';
import { hydrateArticlesSchema, hydrateArticles } from './tools/hydrate-articles.js';
import { listTagsSchema, listTags } from './tools/list-tags.js';
import { tagPostsSchema, tagPostsHandler } from './tools/tag-posts.js';

function toolResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function toolError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { isError: true, content: [{ type: 'text' as const, text: message }] };
}

async function main() {
  // Validate env vars early
  loadConfig();

  const server = new McpServer({
    name: 'x-recon',
    version: '2.0.0',
  });

  // Validate X API client is configured
  getXClient();

  // --- Search Tools ---

  server.tool(
    'search_posts',
    'Semantic search across X using Grok. Finds posts you would never match with keywords alone. Returns raw post data.',
    searchPostsSchema,
    async (params) => {
      try {
        return toolResult(await searchPosts(params));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    'search_posts_raw',
    'Fast keyword search without Grok. Supports Twitter search operators: from:, to:, #, exact phrases.',
    searchPostsRawSchema,
    async (params) => {
      try {
        return toolResult(await searchPostsRaw(params));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  // --- Fetch Tools ---

  server.tool(
    'get_post',
    'Fetch complete data for a single post by ID or URL.',
    getPostSchema,
    async (params) => {
      try {
        return toolResult(await getPost(params));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    'get_user_posts',
    "Fetch a user's recent posts by handle.",
    getUserPostsSchema,
    async (params) => {
      try {
        return toolResult(await getUserPosts(params));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    'get_thread',
    'Given any post in a thread, fetch the entire thread in chronological order.',
    getThreadSchema,
    async (params) => {
      try {
        return toolResult(await getThread(params));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    'get_article',
    'Fetch an X article (long-form content) by URL.',
    getArticleSchema,
    async (params) => {
      try {
        return toolResult(await getArticle(params));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    'get_user_profile',
    'Fetch user profile data: bio, follower counts, verification status, etc.',
    getUserProfileSchema,
    async (params) => {
      try {
        return toolResult(await getUserProfile(params));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    'get_home_timeline',
    "Fetch the authenticated user's home timeline (For You feed).",
    getHomeTimelineSchema,
    async (params) => {
      try {
        return toolResult(await getHomeTimeline(params));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  // --- Bookmark Tools ---

  server.tool(
    'list_bookmarks',
    'Fetch paginated bookmarked posts. Use cursor for pagination.',
    listBookmarksSchema,
    async (params) => {
      try {
        return toolResult(await listBookmarks(params));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    'search_bookmarks',
    'Search within bookmarks by keyword.',
    searchBookmarksSchema,
    async (params) => {
      try {
        return toolResult(await searchBookmarks(params));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  // --- Knowledge Base Tools ---

  server.tool(
    'sync_bookmarks',
    'Sync X bookmarks to local knowledge base. Fetches latest bookmarks, stores locally, and auto-tags by topic.',
    syncBookmarksSchema,
    async (params) => {
      try {
        return toolResult(await syncBookmarks(params));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    'ingest_posts',
    'Fetch posts by ID from X API and store in local knowledge base. Posts already stored are skipped (no duplicate API cost).',
    ingestPostsSchema,
    async (params) => {
      try {
        return toolResult(await ingestPosts(params));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    'get_posts_by_tag',
    'Retrieve locally stored posts with a specific tag. Use after sync_bookmarks or ingest_posts to pull topic-specific posts into context.',
    getPostsByTagSchema,
    async (params) => {
      try {
        return toolResult(await getPostsByTagHandler(params));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    'search_local',
    'Full-text search across locally stored posts and article content with token-safe snippets. Zero API cost.',
    searchLocalSchema,
    async (params) => {
      try {
        return toolResult(await searchLocal(params));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    'list_local_content',
    'List local posts/articles with pagination, filters, and optional full content.',
    listLocalContentSchema,
    async (params) => {
      try {
        return toolResult(await listLocalContent(params));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    'hydrate_articles',
    'Hydrate missing or partial article content in local storage with retry/backfill support.',
    hydrateArticlesSchema,
    async (params) => {
      try {
        return toolResult(await hydrateArticles(params));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    'list_tags',
    'List all tags in the local knowledge base with post counts.',
    listTagsSchema,
    async () => {
      try {
        return toolResult(await listTags());
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    'tag_posts',
    'Add or remove tags on locally stored posts.',
    tagPostsSchema,
    async (params) => {
      try {
        return toolResult(await tagPostsHandler(params));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  // Connect via STDIO
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[x-recon] MCP server started');
}

main().catch((err) => {
  console.error('[x-recon] Fatal error:', err);
  process.exit(1);
});
