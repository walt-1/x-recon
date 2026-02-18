import { listBookmarks, searchRecent } from '../clients/x-api.js';
import { searchX } from '../clients/grok.js';

type ProbeStatus = 'ok' | 'needs_credits' | 'auth_missing' | 'unauthorized' | 'error';

interface ProbeResult {
  status: ProbeStatus;
  message: string;
}

interface DoctorReport {
  timestamp: string;
  checks: {
    x_api_search_auth: ProbeResult;
    x_api_oauth_bookmarks: ProbeResult;
    grok_search: ProbeResult;
  };
  summary: {
    overall: 'ok' | 'degraded';
    next_steps: string[];
  };
}

export function classifyProbeError(err: unknown): ProbeResult {
  const message = err instanceof Error ? err.message : String(err);

  if (/\b402\b/i.test(message) || /payment required/i.test(message)) {
    return {
      status: 'needs_credits',
      message:
        'X API returned HTTP 402 Payment Required. Add credits or upgrade access in https://console.x.com.',
    };
  }

  if (/available:\s*none/i.test(message) || /authentication not configured/i.test(message)) {
    return {
      status: 'auth_missing',
      message:
        'X API authentication is not configured for this endpoint. Verify X_API_BEARER_TOKEN and/or OAuth setup.',
    };
  }

  if (/\b401\b/i.test(message) || /unauthorized/i.test(message)) {
    return {
      status: 'unauthorized',
      message: 'X API rejected credentials (401 Unauthorized). Rotate tokens or check app permissions.',
    };
  }

  return {
    status: 'error',
    message,
  };
}

function ok(message: string): ProbeResult {
  return { status: 'ok', message };
}

function buildNextSteps(report: DoctorReport): string[] {
  const steps: string[] = [];

  if (report.checks.x_api_oauth_bookmarks.status === 'needs_credits') {
    steps.push('Top up X API credits or upgrade plan in https://console.x.com for bookmark endpoints.');
  }

  if (report.checks.x_api_search_auth.status === 'auth_missing') {
    steps.push('Verify X_API_BEARER_TOKEN or OAuth user tokens are available for search endpoints.');
  }

  if (report.checks.x_api_oauth_bookmarks.status === 'auth_missing') {
    steps.push('Run npm run authorize and confirm ~/.x-recon/tokens.json exists.');
  }

  if (report.checks.grok_search.status !== 'ok') {
    steps.push('Verify XAI_API_KEY and Grok API access.');
  }

  if (report.checks.x_api_search_auth.status === 'error') {
    steps.push('Inspect x_api_search_auth.message for endpoint-level errors and validate X app access/tier.');
  }

  if (report.checks.x_api_oauth_bookmarks.status === 'error') {
    steps.push('Inspect x_api_oauth_bookmarks.message for endpoint-level errors and validate bookmark access scope.');
  }

  if (report.checks.grok_search.status === 'error') {
    steps.push('Inspect grok_search.message for API-level errors and quota limits.');
  }

  if (steps.length === 0) {
    steps.push('All checks passed.');
  }

  return steps;
}

export async function runDoctorX(): Promise<DoctorReport> {
  const report: DoctorReport = {
    timestamp: new Date().toISOString(),
    checks: {
      x_api_search_auth: ok('pending'),
      x_api_oauth_bookmarks: ok('pending'),
      grok_search: ok('pending'),
    },
    summary: {
      overall: 'ok',
      next_steps: [],
    },
  };

  try {
    await searchRecent('solana', 1, 'recency');
    report.checks.x_api_search_auth = ok('Search auth probe succeeded via searchRecent.');
  } catch (err) {
    report.checks.x_api_search_auth = classifyProbeError(err);
  }

  try {
    await listBookmarks(1);
    report.checks.x_api_oauth_bookmarks = ok('OAuth bookmark probe succeeded via listBookmarks.');
  } catch (err) {
    report.checks.x_api_oauth_bookmarks = classifyProbeError(err);
  }

  try {
    await searchX({ query: 'solana validator' });
    report.checks.grok_search = ok('Grok probe succeeded via searchX.');
  } catch (err) {
    report.checks.grok_search = classifyProbeError(err);
  }

  const allOk =
    report.checks.x_api_search_auth.status === 'ok' &&
    report.checks.x_api_oauth_bookmarks.status === 'ok' &&
    report.checks.grok_search.status === 'ok';

  report.summary.overall = allOk ? 'ok' : 'degraded';
  report.summary.next_steps = buildNextSteps(report);

  return report;
}

async function main(): Promise<void> {
  const report = await runDoctorX();
  const output = JSON.stringify(report, null, 2);
  process.stdout.write(`${output}\n`);
  process.exitCode = report.summary.overall === 'ok' ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`doctor:x failed: ${message}\n`);
    process.exit(1);
  });
}
