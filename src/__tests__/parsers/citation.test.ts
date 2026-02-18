import { describe, it, expect } from 'vitest';
import { extractTweetIds, extractTweetId } from '../../parsers/citation.js';

describe('extractTweetIds', () => {
  it('extracts IDs from x.com URLs', () => {
    const citations = [
      'https://x.com/elonmusk/status/1234567890123456789',
      'https://x.com/naval/status/9876543210987654321',
    ];
    expect(extractTweetIds(citations)).toEqual([
      '1234567890123456789',
      '9876543210987654321',
    ]);
  });

  it('extracts IDs from /i/status/ URLs', () => {
    const citations = ['https://x.com/i/status/1111111111111111111'];
    expect(extractTweetIds(citations)).toEqual(['1111111111111111111']);
  });

  it('extracts IDs from twitter.com URLs', () => {
    const citations = ['https://twitter.com/jack/status/2222222222222222222'];
    expect(extractTweetIds(citations)).toEqual(['2222222222222222222']);
  });

  it('deduplicates repeated IDs', () => {
    const citations = [
      'https://x.com/user1/status/1234567890',
      'https://x.com/user2/status/1234567890',
    ];
    expect(extractTweetIds(citations)).toEqual(['1234567890']);
  });

  it('returns empty array for empty input', () => {
    expect(extractTweetIds([])).toEqual([]);
  });

  it('returns empty array when no URLs match', () => {
    const citations = [
      'https://example.com/not-a-tweet',
      'https://x.com/user',
      'not a url at all',
    ];
    expect(extractTweetIds(citations)).toEqual([]);
  });

  it('handles mixed valid and invalid URLs', () => {
    const citations = [
      'https://x.com/user/status/111',
      'https://example.com',
      'https://twitter.com/user/status/222',
      'garbage',
    ];
    expect(extractTweetIds(citations)).toEqual(['111', '222']);
  });

  it('handles URLs with query parameters', () => {
    const citations = ['https://x.com/user/status/12345?s=20&t=abc'];
    expect(extractTweetIds(citations)).toEqual(['12345']);
  });

  it('handles URLs with handles containing underscores and numbers', () => {
    const citations = ['https://x.com/user_123/status/99999'];
    expect(extractTweetIds(citations)).toEqual(['99999']);
  });
});

describe('extractTweetId', () => {
  it('returns raw numeric ID unchanged', () => {
    expect(extractTweetId('1234567890')).toBe('1234567890');
  });

  it('extracts from x.com URL with username', () => {
    expect(extractTweetId('https://x.com/elonmusk/status/12345')).toBe('12345');
  });

  it('extracts from x.com URL with /i/ path', () => {
    expect(extractTweetId('https://x.com/i/status/12345')).toBe('12345');
  });

  it('extracts from twitter.com URL', () => {
    expect(extractTweetId('https://twitter.com/user/status/12345')).toBe('12345');
  });

  it('trims whitespace from input', () => {
    expect(extractTweetId('  1234567890  ')).toBe('1234567890');
  });

  it('trims whitespace from URL input', () => {
    expect(extractTweetId('  https://x.com/user/status/12345  ')).toBe('12345');
  });

  it('throws on non-numeric, non-URL string', () => {
    expect(() => extractTweetId('hello')).toThrow('Cannot extract tweet ID from');
  });

  it('throws on URL without status ID', () => {
    expect(() => extractTweetId('https://x.com/user')).toThrow('Cannot extract tweet ID from');
  });

  it('throws on empty string', () => {
    expect(() => extractTweetId('')).toThrow('Cannot extract tweet ID from');
  });

  it('handles URL with query parameters', () => {
    expect(extractTweetId('https://x.com/user/status/12345?s=20')).toBe('12345');
  });
});
