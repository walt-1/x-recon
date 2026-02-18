import { z } from 'zod';
import { extractTweetId } from '../parsers/citation.js';
import { getPost as getPostById } from '../clients/x-api.js';

export const getPostSchema = {
  post: z.string().describe("Tweet ID (e.g. '1234567890') or full URL (e.g. 'https://x.com/user/status/1234567890')"),
};

export async function getPost(params: { post: string }) {
  const id = extractTweetId(params.post);
  return getPostById(id);
}
