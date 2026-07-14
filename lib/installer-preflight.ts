import { createHash } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getLiveInstallers } from '@/lib/manifest-api';
import {
  hashRemoteInstaller,
  hashesEqual,
  isLikelyMutableInstallerUrl,
} from '@/lib/installer-download';

const HEALTHY_MUTABLE_TTL_MS = 5 * 60 * 1000;
const HEALTHY_VERSIONED_TTL_MS = 6 * 60 * 60 * 1000;
const ERROR_TTL_MS = 60 * 1000;
const LEASE_SECONDS = 240;
const WAIT_FOR_CLAIM_MS = 240_000;
const POLL_INTERVAL_MS = 1_500;

type HealthStatus = 'checking' | 'healthy' | 'quarantined' | 'error';

interface InstallerHealthRow {
  cache_key: string;
  winget_id: string;
  version: string;
  architecture: string;
  installer_url: string;
  expected_sha256: string;
  actual_sha256: string | null;
  status: HealthStatus;
  reason_code: string | null;
  reason_message: string | null;
  checked_at: string | null;
  expires_at: string | null;
  lease_expires_at: string | null;
}

export interface InstallerPreflightRequest {
  wingetId: string;
  version: string;
  architecture?: string;
  installerUrl: string;
  installerSha256: string;
  installerType?: string;
  installScope?: 'machine' | 'user';
  sourceType?: 'winget' | 'custom';
}

export interface InstallerPreflightResult {
  cacheKey: string;
  status: 'healthy' | 'skipped';
  source: 'cache' | 'live' | 'custom';
  actualSha256?: string;
  bytes?: number;
}

export class InstallerPreflightError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false,
    public readonly actualSha256?: string,
  ) {
    super(message);
    this.name = 'InstallerPreflightError';
  }
}

const memoryHealth = new Map<string, InstallerHealthRow>();
const inFlight = new Map<string, Promise<InstallerPreflightResult>>();
let healthClient: SupabaseClient | null | undefined;

export function resetInstallerPreflightStateForTests(): void {
  memoryHealth.clear();
  inFlight.clear();
  healthClient = undefined;
}

function getHealthClient(): SupabaseClient | null {
  if (healthClient !== undefined) return healthClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    healthClient = null;
    return null;
  }

  healthClient = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return healthClient;
}

function isHostedRuntime(): boolean {
  return process.env.VERCEL === '1' || process.env.DEPLOYMENT_MODE === 'hosted';
}

export function createInstallerHealthKey(input: InstallerPreflightRequest): string {
  return createHash('sha256')
    .update([
      input.wingetId.trim().toLowerCase(),
      input.version.trim(),
      (input.architecture || 'x64').trim().toLowerCase(),
      input.installerUrl.trim(),
      input.installerSha256.trim().toUpperCase(),
    ].join('\0'))
    .digest('hex');
}

function assertTrustedInput(input: InstallerPreflightRequest): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*\.[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(input.wingetId)) {
    throw new InstallerPreflightError('INVALID_WINGET_ID', 'The package identifier is invalid');
  }
  if (!input.version.trim()) {
    throw new InstallerPreflightError('MISSING_VERSION', 'An exact package version is required');
  }
  if (!/^[A-Fa-f0-9]{64}$/.test(input.installerSha256.trim())) {
    throw new InstallerPreflightError('INVALID_EXPECTED_HASH', 'A trusted SHA256 is required before dispatch');
  }
}

function isFresh(row: InstallerHealthRow): boolean {
  return Boolean(row.expires_at && new Date(row.expires_at).getTime() > Date.now());
}

function throwForRow(row: InstallerHealthRow): never {
  throw new InstallerPreflightError(
    row.reason_code || 'INSTALLER_QUARANTINED',
    row.reason_message || 'This installer tuple is quarantined and cannot be dispatched',
    row.status === 'error',
    row.actual_sha256 || undefined,
  );
}

async function readHealth(cacheKey: string): Promise<InstallerHealthRow | null> {
  const client = getHealthClient();
  if (!client) return memoryHealth.get(cacheKey) || null;

  const { data, error } = await client
    .from('installer_health')
    .select('cache_key,winget_id,version,architecture,installer_url,expected_sha256,actual_sha256,status,reason_code,reason_message,checked_at,expires_at,lease_expires_at')
    .eq('cache_key', cacheKey)
    .maybeSingle();

  if (error) {
    throw new InstallerPreflightError(
      'PREFLIGHT_STATE_UNAVAILABLE',
      `Installer health state is unavailable: ${error.message}`,
      true,
    );
  }
  return data as InstallerHealthRow | null;
}

async function claimHealth(cacheKey: string, input: InstallerPreflightRequest): Promise<boolean> {
  const client = getHealthClient();
  if (!client) return true;

  const { data, error } = await client.rpc('claim_installer_preflight', {
    p_cache_key: cacheKey,
    p_winget_id: input.wingetId,
    p_version: input.version,
    p_architecture: input.architecture || 'x64',
    p_installer_url: input.installerUrl,
    p_expected_sha256: input.installerSha256.toUpperCase(),
    p_lease_seconds: LEASE_SECONDS,
  });

  if (error) {
    throw new InstallerPreflightError(
      'PREFLIGHT_STATE_UNAVAILABLE',
      `Installer preflight could not acquire a verification lease: ${error.message}`,
      true,
    );
  }
  return data === true;
}

async function writeHealth(row: InstallerHealthRow): Promise<void> {
  const client = getHealthClient();
  if (!client) {
    memoryHealth.set(row.cache_key, row);
    return;
  }

  const { error } = await client.from('installer_health').upsert({
    ...row,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'cache_key' });

  if (error) {
    throw new InstallerPreflightError(
      'PREFLIGHT_STATE_UNAVAILABLE',
      `Installer health state could not be saved: ${error.message}`,
      true,
    );
  }
}

function buildHealthRow(
  cacheKey: string,
  input: InstallerPreflightRequest,
  status: HealthStatus,
  values?: Partial<InstallerHealthRow>,
): InstallerHealthRow {
  return {
    cache_key: cacheKey,
    winget_id: input.wingetId,
    version: input.version,
    architecture: input.architecture || 'x64',
    installer_url: input.installerUrl,
    expected_sha256: input.installerSha256.toUpperCase(),
    actual_sha256: null,
    status,
    reason_code: null,
    reason_message: null,
    checked_at: new Date().toISOString(),
    expires_at: null,
    lease_expires_at: null,
    ...values,
  };
}

function installerExistsInManifest(input: InstallerPreflightRequest, installers: Awaited<ReturnType<typeof getLiveInstallers>>): boolean {
  const expectedHash = input.installerSha256.toUpperCase();
  const requestedArchitecture = (input.architecture || 'x64').toLowerCase();
  const requestedType = input.installerType?.toLowerCase();
  const requestedScope = input.installScope?.toLowerCase();

  return installers.some((installer) => {
    if (!hashesEqual(installer.sha256 || '', expectedHash)) return false;
    if (installer.architecture && installer.architecture.toLowerCase() !== requestedArchitecture) return false;
    if (requestedType && installer.type && installer.type.toLowerCase() !== requestedType) return false;
    if (requestedScope && installer.scope && installer.scope.toLowerCase() !== requestedScope) return false;
    return true;
  });
}

async function waitForSharedResult(cacheKey: string): Promise<InstallerPreflightResult> {
  const deadline = Date.now() + WAIT_FOR_CLAIM_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const row = await readHealth(cacheKey);
    if (!row) continue;
    if (row.status === 'quarantined') throwForRow(row);
    if (row.status === 'healthy' && isFresh(row)) {
      return {
        cacheKey,
        status: 'healthy',
        source: 'cache',
        actualSha256: row.actual_sha256 || undefined,
      };
    }
    if (row.status === 'error' && isFresh(row)) throwForRow(row);
    if (row.status === 'checking' && row.lease_expires_at && new Date(row.lease_expires_at).getTime() > Date.now()) {
      continue;
    }
    break;
  }

  throw new InstallerPreflightError(
    'PREFLIGHT_IN_PROGRESS',
    'Installer verification did not complete before the dispatch deadline',
    true,
  );
}

async function performLivePreflight(
  cacheKey: string,
  input: InstallerPreflightRequest,
): Promise<InstallerPreflightResult> {
  try {
    const installers = await getLiveInstallers(input.wingetId, input.version);
    if (installers.length === 0) {
      throw new InstallerPreflightError(
        'MANIFEST_UNAVAILABLE',
        `The trusted WinGet installer manifest for ${input.wingetId} ${input.version} is unavailable`,
        true,
      );
    }

    if (!installerExistsInManifest(input, installers)) {
      const error = new InstallerPreflightError(
        'MANIFEST_CHANGED',
        `The selected installer for ${input.wingetId} ${input.version} no longer matches the trusted WinGet manifest`,
      );
      await writeHealth(buildHealthRow(cacheKey, input, 'quarantined', {
        reason_code: error.code,
        reason_message: error.message,
      }));
      throw error;
    }

    const downloaded = await hashRemoteInstaller(input.installerUrl);
    if (!hashesEqual(downloaded.sha256, input.installerSha256)) {
      const error = new InstallerPreflightError(
        'HASH_MISMATCH',
        `The publisher currently serves different bytes for ${input.wingetId} ${input.version}. The deployment was quarantined before the packaging pipeline started.`,
        false,
        downloaded.sha256,
      );
      await writeHealth(buildHealthRow(cacheKey, input, 'quarantined', {
        actual_sha256: downloaded.sha256,
        reason_code: error.code,
        reason_message: error.message,
      }));
      throw error;
    }

    const ttl = isLikelyMutableInstallerUrl(input.installerUrl, input.version)
      ? HEALTHY_MUTABLE_TTL_MS
      : HEALTHY_VERSIONED_TTL_MS;
    await writeHealth(buildHealthRow(cacheKey, input, 'healthy', {
      actual_sha256: downloaded.sha256,
      expires_at: new Date(Date.now() + ttl).toISOString(),
    }));

    return {
      cacheKey,
      status: 'healthy',
      source: 'live',
      actualSha256: downloaded.sha256,
      bytes: downloaded.bytes,
    };
  } catch (error) {
    if (error instanceof InstallerPreflightError && !error.retryable) throw error;

    const normalized = error instanceof InstallerPreflightError
      ? error
      : new InstallerPreflightError(
          'PREFLIGHT_UNAVAILABLE',
          error instanceof Error ? error.message : 'Installer verification failed',
          true,
        );

    await writeHealth(buildHealthRow(cacheKey, input, 'error', {
      reason_code: normalized.code,
      reason_message: normalized.message,
      expires_at: new Date(Date.now() + ERROR_TTL_MS).toISOString(),
    }));
    throw normalized;
  }
}

async function enforceInternal(input: InstallerPreflightRequest): Promise<InstallerPreflightResult> {
  assertTrustedInput(input);
  const cacheKey = createInstallerHealthKey(input);
  const cached = await readHealth(cacheKey);
  if (cached?.status === 'quarantined') throwForRow(cached);
  if (cached?.status === 'healthy' && isFresh(cached)) {
    return {
      cacheKey,
      status: 'healthy',
      source: 'cache',
      actualSha256: cached.actual_sha256 || undefined,
    };
  }
  if (cached?.status === 'error' && isFresh(cached)) throwForRow(cached);

  const claimed = await claimHealth(cacheKey, input);
  if (!claimed) return waitForSharedResult(cacheKey);
  return performLivePreflight(cacheKey, input);
}

export async function enforceInstallerPreflight(
  input: InstallerPreflightRequest,
): Promise<InstallerPreflightResult> {
  if (input.sourceType === 'custom' || input.wingetId.startsWith('Custom.')) {
    return { cacheKey: '', status: 'skipped', source: 'custom' };
  }
  if (isHostedRuntime() && !getHealthClient()) {
    throw new InstallerPreflightError(
      'PREFLIGHT_STATE_UNAVAILABLE',
      'Shared installer health state is required in hosted mode',
      true,
    );
  }

  const cacheKey = createInstallerHealthKey(input);
  const existing = inFlight.get(cacheKey);
  if (existing) return existing;

  const promise = enforceInternal(input).finally(() => inFlight.delete(cacheKey));
  inFlight.set(cacheKey, promise);
  return promise;
}

export async function quarantineInstaller(
  input: InstallerPreflightRequest,
  actualSha256?: string,
  reasonCode = 'HASH_MISMATCH',
  reasonMessage = 'The installer failed SHA256 verification and is quarantined',
): Promise<void> {
  if (input.sourceType === 'custom' || input.wingetId.startsWith('Custom.')) return;
  assertTrustedInput(input);
  const cacheKey = createInstallerHealthKey(input);
  await writeHealth(buildHealthRow(cacheKey, input, 'quarantined', {
    actual_sha256: actualSha256?.toUpperCase() || null,
    reason_code: reasonCode,
    reason_message: reasonMessage,
  }));
}
