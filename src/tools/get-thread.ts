import { z } from 'zod';
import { extractTweetId } from '../parsers/citation.js';
import { getPost, getThread as getThreadApi } from '../clients/x-api.js';
import type { PaginatedResponse, XPost } from '../types.js';

export const getThreadSchema = {
  post: z.string().describe('Tweet ID or URL of any post in the thread'),
  include_replies: z.boolean().default(false).describe('Include replies from other users'),
};

export async function getThread(params: {
  post: string;
  include_replies: boolean;
}): Promise<PaginatedResponse<XPost>> {
  const id = extractTweetId(params.post);

  // Get the starting tweet to find conversation_id
  const tweet = await getPost(id);
  const conversationId = tweet.thread_id ?? id;

  // Fetch all posts in the conversation
  let posts = await getThreadApi(conversationId);

  // Filter to only the thread author's posts unless include_replies is true
  if (!params.include_replies) {
    const threadAuthor = tweet.author.handle;
    posts = posts.filter(p => p.author.handle === threadAuthor);
  }

  return { data: posts, has_more: false };
}
