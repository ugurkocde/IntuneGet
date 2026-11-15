// This observes creation of ordinary QA workflow runs, not VM boots or Execute starts.
export const WATCHDOG_MAX_BYTES = 512 * 1024;
const HOUR = 3600000;
const fail = (cause, bytes) => { throw Object.assign(new Error(cause), { watchdogCause: cause, watchdogBytes: bytes }); };
export function watchdogReadPath(now) {
  const from = new Date(now - 2 * HOUR).toISOString(), to = new Date(now).toISOString();
  return `/actions/workflows/intune-qa.yml/runs?event=workflow_dispatch&branch=main&created=${encodeURIComponent(from + '..' + to)}&per_page=20`;
}
export function validateWatchdogList(data) {
  if (!data || !Number.isSafeInteger(data.total_count) || data.total_count < 0 || data.total_count > 20 ||
      !Array.isArray(data.workflow_runs) || data.workflow_runs.length !== data.total_count) fail('incomplete_list');
  const workflow_runs = data.workflow_runs.map(run => {
    const name = run.createdAt === undefined ? run.display_title : run.name;
    const createdAt = run.createdAt ?? run.created_at;
    if (typeof name !== 'string' || name.length > 256 || !name.startsWith('Intune QA -') ||
        /[\x00-\x1f\x7f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u.test(name)) fail('invalid_name');
    if (typeof createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/.test(createdAt) ||
        !Number.isFinite(Date.parse(createdAt))) fail('invalid_created_at');
    if (!['queued','waiting','pending','requested','in_progress','completed'].includes(run.status) ||
        !(run.conclusion === null || ['success','failure','cancelled','skipped','timed_out','neutral','action_required','stale','startup_failure'].includes(run.conclusion))) fail('invalid_status');
    return { name, createdAt, status: run.status, conclusion: run.conclusion };
  });
  if (!Number.isSafeInteger(data.responseBytes) || data.responseBytes < 0 || data.responseBytes > WATCHDOG_MAX_BYTES) fail('invalid_byte_evidence');
  return { total_count: data.total_count, workflow_runs, responseBytes: data.responseBytes };
}
export function parseWatchdogResponse(body) {
  const bytes = Buffer.byteLength(body, 'utf8');
  if (body.length > WATCHDOG_MAX_BYTES || bytes > WATCHDOG_MAX_BYTES) fail('response_exceeds_512KiB', bytes);
  let data; try { data = JSON.parse(body); } catch { fail('invalid_json', bytes); }
  try { return validateWatchdogList({ ...data, responseBytes: bytes }); } catch (error) { error.watchdogBytes = bytes; throw error; }
}
export async function observeLifecycleWatchdog({ read, awaitingQaJobs, now = Date.now() }) {
  const end = Math.floor(now / HOUR) * HOUR, start = end - HOUR;
  const result = { basis: 'ordinary_workflow_created_at', window: { start: new Date(start).toISOString(), end: new Date(end).toISOString() }, awaitingQaJobs };
  if (awaitingQaJobs === 0) return { ...result, state: 'no_demand', runs: null };
  try {
    if (!Number.isSafeInteger(awaitingQaJobs) || awaitingQaJobs < 0) fail('invalid_demand');
    const data = validateWatchdogList(await read(watchdogReadPath(now)));
    if (data.workflow_runs.some(run => Date.parse(run.createdAt) < now - 2 * HOUR || Date.parse(run.createdAt) > now)) fail('created_outside_window');
    const runs = data.workflow_runs.filter(run => Date.parse(run.createdAt) >= start && Date.parse(run.createdAt) < end).length;
    return { ...result, state: runs === 0 ? 'alert' : 'flowing', runs, bytes: data.responseBytes, complete: true };
  } catch (error) {
    const known = ['incomplete_list','invalid_name','invalid_created_at','invalid_status','invalid_byte_evidence','response_exceeds_512KiB','invalid_json','invalid_demand','created_outside_window','scope'];
    const rejectCause = known.includes(error?.watchdogCause) ? error.watchdogCause : error?.retryAt ? 'cooldown' : Number.isInteger(error?.httpStatus) ? `http_${error.httpStatus}` : /route rejected/i.test(error?.message ?? '') ? 'route_rejected' : /oversized/i.test(error?.message ?? '') ? 'response_exceeds_512KiB' : error instanceof TypeError ? 'network' : 'read_failed';
    return { ...result, state: 'unknown', runs: null, complete: false, rejectCause, ...(Number.isSafeInteger(error?.watchdogBytes) ? { bytes: error.watchdogBytes } : {}),
      retryPlan: error?.retryAt ? `Wait until ${error.retryAt}; one next-cycle read with the same scope and guard.` : 'One bounded read in the next controller cycle: same two-hour window, per_page20, 512KiB guard. Repeated parse/projection failures require repair; never infer zero or raise the guard.' };
  }
}
export function recordWatchdogAlert(result, observation) {
  result.lifecycleWatchdog = observation;
  if (observation.state === 'alert' || observation.state === 'unknown') {
    result.alerts ??= [];
    result.alerts.push({ code: observation.state === 'alert' ? 'qa_zero_lifecycle_hour' : 'qa_watchdog_unknown', ...observation });
  }
}
