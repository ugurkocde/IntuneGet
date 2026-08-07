import { createClient } from '@supabase/supabase-js';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const APP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]*\.[A-Za-z0-9][A-Za-z0-9._+-]*$/;
const ARCHITECTURES = new Set(['x64', 'x86', 'arm64']);
const OUTCOMES = new Set(['Passed', 'Failed']);
const CHANGE_CATEGORIES = [
  'uninstallEntries',
  'registryValues',
  'fileSystemItems',
  'operatingSystem',
  'drivers',
  'windowsFeatures',
  'services',
  'scheduledTasks',
  'shortcuts',
];

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const isNonNegativeNumber = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const isInteger = (value) => Number.isInteger(value);

function validatePhase(value, name, errors, nullable = true) {
  if (value === null && nullable) return;
  if (!isObject(value)) {
    errors.push(`${name} must be an object${nullable ? ' or null' : ''}`);
    return;
  }
  if (!isInteger(value.exitCode)) errors.push(`${name}.exitCode must be an integer`);
  if (!isNonNegativeNumber(value.durationSeconds)) errors.push(`${name}.durationSeconds must be non-negative`);
  if (typeof value.timedOut !== 'boolean') errors.push(`${name}.timedOut must be boolean`);
}

function validateChangeSet(value, name, errors) {
  if (!isObject(value)) {
    errors.push(`${name} must be an object`);
    return;
  }
  for (const category of CHANGE_CATEGORIES) {
    const counts = value[category];
    if (!isObject(counts)) {
      errors.push(`${name}.${category} must be an object`);
      continue;
    }
    for (const field of ['added', 'removed', 'changed']) {
      if (!isInteger(counts[field]) || counts[field] < 0) {
        errors.push(`${name}.${category}.${field} must be a non-negative integer`);
      }
    }
  }
}

/** Validate the compact canonical schema used by qa/apps/*.json. */
export function validateQaDefinition(value) {
  const errors = [];
  if (!isObject(value)) return ['definition must be an object'];

  if (value.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (!isNonEmptyString(value.id) || !APP_ID_PATTERN.test(value.id)) errors.push('id is invalid');
  if (!isNonEmptyString(value.displayName)) errors.push('displayName is required');
  if (!isNonEmptyString(value.publisher)) errors.push('publisher is required');
  if (!isNonEmptyString(value.version)) errors.push('version is required');
  if (!ARCHITECTURES.has(value.architecture)) errors.push('architecture is invalid');
  if (!isObject(value.installer) || !isNonEmptyString(value.installer.type)) {
    errors.push('installer.type is required');
  }
  if (!isObject(value.commands) || !isNonEmptyString(value.commands.install) || !isNonEmptyString(value.commands.uninstall)) {
    errors.push('commands.install and commands.uninstall are required');
  }
  if (
    !isObject(value.detection) ||
    value.detection.type !== 'fileVersion' ||
    !isNonEmptyString(value.detection.path) ||
    !isNonEmptyString(value.detection.minimumVersion)
  ) {
    errors.push('a complete fileVersion detection rule is required');
  }

  if (value.qaResult === undefined) return errors;
  const result = value.qaResult;
  if (!isObject(result)) return [...errors, 'qaResult must be an object'];
  if (result.schemaVersion !== 1) errors.push('qaResult.schemaVersion must be 1');
  if (!isNonEmptyString(result.testId)) errors.push('qaResult.testId is required');
  if (!OUTCOMES.has(result.outcome)) errors.push('qaResult.outcome is invalid');
  if (!isNonEmptyString(result.testedAtUtc) || Number.isNaN(Date.parse(result.testedAtUtc))) {
    errors.push('qaResult.testedAtUtc must be an ISO date-time');
  }
  if (!isNonNegativeNumber(result.overallDurationSeconds)) {
    errors.push('qaResult.overallDurationSeconds must be non-negative');
  }
  if (!isObject(result.results)) {
    errors.push('qaResult.results must be an object');
  } else {
    validatePhase(result.results.install, 'qaResult.results.install', errors, false);
    validatePhase(result.results.detectionAfterInstall, 'qaResult.results.detectionAfterInstall', errors);
    validatePhase(result.results.uninstall, 'qaResult.results.uninstall', errors);
    validatePhase(result.results.detectionAfterUninstall, 'qaResult.results.detectionAfterUninstall', errors);
  }
  if (!isObject(result.changes)) {
    errors.push('qaResult.changes must be an object');
  } else {
    validateChangeSet(result.changes.afterInstall, 'qaResult.changes.afterInstall', errors);
    validateChangeSet(result.changes.residualAfterUninstall, 'qaResult.changes.residualAfterUninstall', errors);
  }
  if (!isInteger(result.relevantEventCount) || result.relevantEventCount < 0) {
    errors.push('qaResult.relevantEventCount must be a non-negative integer');
  }
  if (!isObject(result.environment) || !isNonEmptyString(result.environment.computerName) || !isNonEmptyString(result.environment.executedAs)) {
    errors.push('qaResult.environment is incomplete');
  }
  if (
    !isObject(result.github) ||
    !/^\d+$/.test(result.github.runId || '') ||
    !isInteger(result.github.runAttempt) ||
    result.github.runAttempt < 1
  ) {
    errors.push('qaResult.github run provenance is invalid');
  }
  return errors;
}

export function toQaResultRow(definition, syncedAt = new Date().toISOString()) {
  if (!definition.qaResult) return null;
  const result = definition.qaResult;
  return {
    winget_id: definition.id,
    display_name: definition.displayName,
    publisher: definition.publisher,
    tested_version: definition.version,
    architecture: definition.architecture,
    outcome: result.outcome,
    tested_at_utc: result.testedAtUtc,
    overall_duration_seconds: result.overallDurationSeconds,
    installer_type: definition.installer.type,
    install_command: definition.commands.install,
    uninstall_command: definition.commands.uninstall,
    detection: definition.detection,
    phase_results: result.results,
    changes: result.changes,
    relevant_event_count: result.relevantEventCount,
    environment: result.environment,
    test_id: result.testId,
    github_run_id: result.github.runId,
    github_run_attempt: result.github.runAttempt,
    qa_schema_version: result.schemaVersion,
    synced_at: syncedAt,
  };
}

async function githubJson(url, token, accept = 'application/vnd.github+json') {
  const response = await fetch(url, {
    headers: {
      Accept: accept,
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'IntuneGet-QA-Sync',
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub request failed (${response.status}) for ${url}`);
  }
  return response.json();
}

export function assertCompleteQaListing(entries) {
  if (!Array.isArray(entries)) {
    throw new Error('GitHub qa/apps response was not a directory listing');
  }
  // The contents API truncates directory listings at 1,000 entries without a
  // pagination signal. Abort before reconciliation so truncation can never
  // delete otherwise valid mirrored rows.
  if (entries.length >= 1000) {
    throw new Error('GitHub qa/apps listing reached the 1,000-entry contents API limit; refusing a potentially truncated reconciliation');
  }
}

async function synchronize() {
  const token = process.env.QA_REPO_READ_PAT;
  const repository = process.env.QA_REPOSITORY || 'ugurkocde/IntuneGet-Workflows';
  const ref = process.env.QA_REPOSITORY_REF || 'main';
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!token || !supabaseUrl || !supabaseKey) {
    throw new Error('QA_REPO_READ_PAT, SUPABASE_URL, and SUPABASE_SERVICE_KEY are required');
  }

  const apiRoot = `https://api.github.com/repos/${repository}`;
  const entries = await githubJson(`${apiRoot}/contents/qa/apps?ref=${encodeURIComponent(ref)}`, token);
  assertCompleteQaListing(entries);
  const files = entries.filter((entry) => entry.type === 'file' && entry.name.endsWith('.json') && entry.name !== 'schema.json');
  if (files.length === 0) throw new Error('No canonical QA application files were found; refusing to clear the mirror');

  const syncedAt = new Date().toISOString();
  const rows = [];
  const canonicalIds = new Set();
  const invalid = [];
  for (const file of files) {
    try {
      const fileUrl = new URL(file.url);
      fileUrl.searchParams.set('ref', ref);
      const definition = await githubJson(fileUrl.toString(), token, 'application/vnd.github.raw+json');
      const errors = validateQaDefinition(definition);
      if (isNonEmptyString(definition?.id) && canonicalIds.has(definition.id)) {
        errors.push(`duplicate canonical id ${definition.id}`);
      }
      if (isNonEmptyString(definition?.id)) canonicalIds.add(definition.id);
      if (errors.length > 0) {
        invalid.push({ file: file.name, errors });
        continue;
      }
      const row = toQaResultRow(definition, syncedAt);
      if (row) rows.push(row);
    } catch (error) {
      invalid.push({ file: file.name, errors: [error instanceof Error ? error.message : String(error)] });
    }
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await supabase.from('qa_results').upsert(rows.slice(i, i + 100), { onConflict: 'winget_id' });
    if (error) throw error;
  }

  const { data: existing, error: existingError } = await supabase.from('qa_results').select('winget_id');
  if (existingError) throw existingError;
  // Reconcile deletions only after a completely valid read. A transient fetch
  // failure must never erase the last known-good result. Valid definitions
  // without qaResult intentionally remove a former result (becoming untested).
  const mirroredIds = new Set(rows.map((row) => row.winget_id));
  const removed = invalid.length === 0
    ? (existing || []).map((row) => row.winget_id).filter((id) => !mirroredIds.has(id))
    : [];
  for (let i = 0; i < removed.length; i += 100) {
    const { error } = await supabase.from('qa_results').delete().in('winget_id', removed.slice(i, i + 100));
    if (error) throw error;
  }

  const status = invalid.length === 0 ? 'success' : rows.length > 0 ? 'partial' : 'failed';
  const { error: statusError } = await supabase.from('curated_sync_status').upsert({
    id: 'sync-qa-results',
    last_run_completed_at: syncedAt,
    last_run_status: status,
    items_processed: rows.length,
    error_message: invalid.length > 0 ? `${invalid.length} invalid QA file(s)` : null,
    metadata: { repository, ref, files: files.length, mirrored: rows.length, removed: removed.length, invalid },
    updated_at: syncedAt,
  });
  if (statusError) throw statusError;

  const summary = { repository, ref, files: files.length, mirrored: rows.length, removed: removed.length, invalid };
  console.log(JSON.stringify(summary, null, 2));
  if (invalid.length > 0) process.exitCode = 1;
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  synchronize().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
