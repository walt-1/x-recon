import { z } from 'zod';
import { getUserProfile as getUserProfileApi } from '../clients/x-api.js';
import type { XUserProfile } from '../types.js';

export const getUserProfileSchema = {
  handle: z.string().describe('X handle without @ prefix'),
};

export async function getUserProfile(params: { handle: string }): Promise<XUserProfile> {
  return getUserProfileApi(params.handle);
}
