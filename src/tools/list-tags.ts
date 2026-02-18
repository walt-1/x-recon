import { z } from 'zod';
import { getAllTags, getTotalPostCount } from '../db/index.js';

export const listTagsSchema = {};

export async function listTags() {
  const tags = getAllTags();
  const totalPosts = getTotalPostCount();
  return { tags, total_posts: totalPosts };
}
