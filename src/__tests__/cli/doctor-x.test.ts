import { describe, expect, it } from 'vitest';

import { classifyProbeError } from '../../cli/doctor-x.js';

describe('classifyProbeError', () => {
  it('classifies 402 as needs_credits', () => {
    const result = classifyProbeError(new Error('HTTP 402 Payment Required'));
    expect(result.status).toBe('needs_credits');
    expect(result.message).toContain('credits');
  });

  it('classifies auth missing message', () => {
    const result = classifyProbeError(new Error('Authentication required. Available: none.'));
    expect(result.status).toBe('auth_missing');
  });

  it('classifies 401 as unauthorized', () => {
    const result = classifyProbeError(new Error('Grok API error 401: Unauthorized'));
    expect(result.status).toBe('unauthorized');
  });

  it('falls back to generic error', () => {
    const result = classifyProbeError(new Error('unexpected failure'));
    expect(result.status).toBe('error');
    expect(result.message).toContain('unexpected failure');
  });
});
