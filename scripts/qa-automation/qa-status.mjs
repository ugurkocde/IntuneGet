const base = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const cronSecret = process.env.CRON_SECRET;

if (!base || !key) {
  throw new Error('Missing production Supabase environment variables.');
}

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  'User-Agent': 'IntuneGet-QA-Guardian/1.0',
  'X-Client-Info': 'intuneget-qa-guardian',
};

async function request(path, extraHeaders = {}) {
  const response = await fetch(`${base}/rest/v1/${path}`, {
    headers: { ...headers, ...extraHeaders },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  return response;
}

async function query(path) {
  return (await request(path)).json();
}

async function exactCount(path) {
  const response = await request(path, {
    Prefer: 'count=exact',
    Range: '0-0',
  });
  const contentRange = response.headers.get('content-range') || '';
  const match = contentRange.match(/\/(\d+)$/);
  return match ? Number(match[1]) : null;
}

const candidateFields = [
  'id',
  'winget_id',
  'version',
  'architecture',
  'status',
  'phase',
  'priority',
  'attempts',
  'github_run_id',
  'github_run_url',
  'failure_summary',
  'enqueued_at',
  'dispatched_at',
  'started_at',
  'finished_at',
  'updated_at',
  'phase_updated_at',
  'activity_updated_at',
  'test_level',
  'installer_sha256',
  'package_profile_sha256',
  'demand_source',
].join(',');

async function authoritativeCohort() {
  if (!cronSecret) throw new Error('Missing authenticated cohort audit credential.');
  const response = await fetch('https://www.intuneget.com/api/qa/cohort', {
    headers: { Authorization: `Bearer ${cronSecret}` }, signal: AbortSignal.timeout(290000),
  });
  if (!response.ok) throw new Error(`Authoritative cohort audit failed (${response.status}); count is unknown.`);
  return (await response.json()).cohort;
}

const [control, active, nextQueue, recent, cohort, queuedCount] = await Promise.all([
  query('qa_pipeline_control?select=*&id=eq.global'),
  query(`qa_candidates?select=${candidateFields}&status=in.(dispatched,running)&order=updated_at.desc`),
  query(`qa_candidates?select=${candidateFields}&status=eq.queued&order=priority.desc,enqueued_at.asc&limit=20`),
  query(`qa_candidates?select=${candidateFields}&order=updated_at.desc&limit=20`),
  authoritativeCohort(),
  exactCount('qa_candidates?select=id&status=eq.queued'),
]);

console.log(
  JSON.stringify(
    {
      observedAtUtc: new Date().toISOString(),
      cohort,
      control,
      active,
      queuedCount,
      nextQueue,
      recent,
    },
    null,
    2,
  ),
);
