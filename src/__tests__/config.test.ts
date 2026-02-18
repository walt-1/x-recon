import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const savedEnv = { ...process.env };

describe('loadConfig', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.XAI_API_KEY = 'test-api-key';
    process.env.X_API_BEARER_TOKEN = 'test-bearer-token';
    delete process.env.X_API_CLIENT_ID;
    delete process.env.X_API_CLIENT_SECRET;
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  async function getLoadConfig() {
    const mod = await import('../config.js');
    return mod.loadConfig;
  }

  it('returns valid Config when required vars are set', async () => {
    const loadConfig = await getLoadConfig();
    const config = loadConfig();
    expect(config.XAI_API_KEY).toBe('test-api-key');
    expect(config.X_API_BEARER_TOKEN).toBe('test-bearer-token');
  });

  it('throws when XAI_API_KEY is missing', async () => {
    delete process.env.XAI_API_KEY;
    const loadConfig = await getLoadConfig();
    expect(() => loadConfig()).toThrow('Missing or invalid environment variables');
  });

  it('allows missing X_API_BEARER_TOKEN', async () => {
    delete process.env.X_API_BEARER_TOKEN;
    const loadConfig = await getLoadConfig();
    expect(() => loadConfig()).not.toThrow();
  });

  it('accepts optional X_API_CLIENT_ID and X_API_CLIENT_SECRET', async () => {
    process.env.X_API_CLIENT_ID = 'client-id';
    process.env.X_API_CLIENT_SECRET = 'client-secret';
    const loadConfig = await getLoadConfig();
    const config = loadConfig();
    expect(config.X_API_CLIENT_ID).toBe('client-id');
    expect(config.X_API_CLIENT_SECRET).toBe('client-secret');
  });

  it('defaults X_API_CLIENT_ID and X_API_CLIENT_SECRET to undefined', async () => {
    const loadConfig = await getLoadConfig();
    const config = loadConfig();
    expect(config.X_API_CLIENT_ID).toBeUndefined();
    expect(config.X_API_CLIENT_SECRET).toBeUndefined();
  });

  it('applies default for GROK_MODEL', async () => {
    const loadConfig = await getLoadConfig();
    const config = loadConfig();
    expect(config.GROK_MODEL).toBe('grok-4-1-fast-reasoning');
  });

  it('applies default for LOG_LEVEL', async () => {
    const loadConfig = await getLoadConfig();
    const config = loadConfig();
    expect(config.LOG_LEVEL).toBe('info');
  });

  it('respects custom GROK_MODEL', async () => {
    process.env.GROK_MODEL = 'grok-custom';
    const loadConfig = await getLoadConfig();
    expect(loadConfig().GROK_MODEL).toBe('grok-custom');
  });

  it('respects custom LOG_LEVEL', async () => {
    process.env.LOG_LEVEL = 'debug';
    const loadConfig = await getLoadConfig();
    expect(loadConfig().LOG_LEVEL).toBe('debug');
  });

  it('rejects invalid LOG_LEVEL', async () => {
    process.env.LOG_LEVEL = 'verbose';
    const loadConfig = await getLoadConfig();
    expect(() => loadConfig()).toThrow('Missing or invalid environment variables');
  });

  it('accepts all valid LOG_LEVEL values', async () => {
    for (const level of ['debug', 'info', 'warn', 'error']) {
      vi.resetModules();
      process.env.LOG_LEVEL = level;
      const loadConfig = await getLoadConfig();
      expect(loadConfig().LOG_LEVEL).toBe(level);
    }
  });

  it('returns cached config on second call', async () => {
    const loadConfig = await getLoadConfig();
    const first = loadConfig();
    process.env.XAI_API_KEY = 'changed';
    const second = loadConfig();
    expect(second.XAI_API_KEY).toBe('test-api-key');
    expect(first).toBe(second);
  });
});
