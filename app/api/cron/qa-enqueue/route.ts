import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import {
  emitQaPollAlert,
  qaPollRunStatus,
  structuredQaPollLog,
  type QaPollAlertDelivery,
  type QaPollRunStatus,
  type QaPollSummary,
} from '@/lib/qa/poll-observability';
import {
  normalizeInstallerSha256,
  normalizeQaInstallerType,
  qaInstallerFileName,
  selectQaVmInstaller,
  selectWingetInstaller,
} from '@/lib/qa/candidate';
import { buildQaCatalogTestConfig } from '@/lib/qa/test-config';
import { evaluatePackagingContract } from '@/lib/packaging-contract';
import {
  isWingetDependencyCompatibilityError,
  resolveWingetPackageDependencies,
} from '@/lib/winget-dependencies';
import {
  QA_PSADT_TOOLCHAIN,
  buildQaPackageIdentity,
  validateCompatiblePassedCatalogQaProfile,
  validateCurrentQaPackageProfile,
} from '@/lib/qa/package-profile';
import {
  prioritizeToolchainBackfill,
  shouldRetryTerminalToolchainCandidate,
  type QaToolchainBackfillCandidate,
} from '@/lib/qa/toolchain-backfill';
import { getQaPipelineControl } from '@/lib/qa/pipeline-control';
import { detectWingetChanges } from '@/lib/qa/winget-changes';
import {
  createWingetManifestClient,
  resolveWingetManifest,
} from '@/lib/winget-sync-resolution.mjs';

const BATCH_SIZE = 3;
const POLL_STATE_ID = 'microsoft/winget-pkgs';
const INITIAL_LOOKBACK_MINUTES = 30;
const MAX_RECORDED_ERRORS = 100;
const MAX_ERROR_LENGTH = 1_000;
const TOOLCHAIN_BACKFILL_BATCH_SIZE = 3;
const TOOLCHAIN_BACKFILL_PAGE_SIZE = 1_000;
const DEMAND_BACKFILL_BATCH_SIZE = 3;

interface QaCandidateProfileRow {
  id: string;
  winget_id: string;
  version: string;
  architecture: string;
  installer_sha256: string;
  enqueued_at: string;
  package_profile_sha256: string | null;
  test_config: unknown;
  status: string;
  priority: number;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function hasInteractiveCatalogQaProfile(testConfig: unknown): boolean {
  const canonicalJson = object(testConfig).packageProfileCanonicalJson;
  if (typeof canonicalJson !== 'string') return false;
  try {
    const canonical = object(JSON.parse(canonicalJson));
    const psadtConfig = object(canonical.psadtConfig);
    const progressDialog = object(psadtConfig.progressDialog);
    return psadtConfig.deployMode === 'Auto' && progressDialog.enabled === true;
  } catch {
    return false;
  }
}

async function findToolchainBackfillIds(
  supabase: ReturnType<typeof createServerClient>
): Promise<{ ids: string[]; pagesScanned: number }> {
  const decidedIds = new Set<string>();
  const supportedStaleCandidates: QaToolchainBackfillCandidate[] = [];
  let cursor: { enqueuedAt: string; id: string } | null = null;
  let pagesScanned = 0;

  while (true) {
    let candidateQuery = supabase
      .from('qa_candidates')
      .select(
        'id, winget_id, version, architecture, installer_sha256, enqueued_at, package_profile_sha256, test_config, status, priority'
      )
      .eq('test_level', 'psadt-package')
      .not('package_profile_sha256', 'is', null)
      .order('enqueued_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(TOOLCHAIN_BACKFILL_PAGE_SIZE);
    if (cursor) {
      candidateQuery = candidateQuery.or(
        `enqueued_at.lt.${cursor.enqueuedAt},and(enqueued_at.eq.${cursor.enqueuedAt},id.lt.${cursor.id})`
      );
    }

    const { data, error } = await candidateQuery;
    if (error) throw new Error(`Could not scan prior QA toolchains: ${error.message}`);
    const rows = (data || []) as QaCandidateProfileRow[];
    pagesScanned++;

    const pageStaleRows: QaCandidateProfileRow[] = [];
    for (const row of rows) {
      const config = object(row.test_config);
      if (config.profileKind !== 'catalog-default' || decidedIds.has(row.winget_id)) continue;
      decidedIds.add(row.winget_id);
      const validation = validateCurrentQaPackageProfile({
        testConfig: row.test_config,
        candidatePackageProfileSha256: row.package_profile_sha256,
        candidateWingetId: row.winget_id,
        candidateVersion: row.version,
        candidateArchitecture: row.architecture,
        candidateInstallerSha256: row.installer_sha256,
      });
      const compatiblePassedValidation = row.status === 'passed'
        ? validateCompatiblePassedCatalogQaProfile({
            testConfig: row.test_config,
            candidatePackageProfileSha256: row.package_profile_sha256,
            candidateWingetId: row.winget_id,
            candidateVersion: row.version,
            candidateArchitecture: row.architecture,
            candidateInstallerSha256: row.installer_sha256,
          })
        : null;
      const hasCompatiblePassedProfile = compatiblePassedValidation?.valid === true;
      if (
        !shouldRetryTerminalToolchainCandidate(QA_PSADT_TOOLCHAIN.packagerCommit, {
          wingetId: row.winget_id,
          status: row.status,
        })
      ) {
        continue;
      }
      if (
        (!validation.valid && !hasCompatiblePassedProfile) ||
        !hasInteractiveCatalogQaProfile(row.test_config)
      ) {
        pageStaleRows.push(row);
      }
    }

    if (pageStaleRows.length > 0) {
      const pageStaleIds = pageStaleRows.map((row) => row.winget_id);
      const [supportedResult, deployedResult] = await Promise.all([
        supabase
          .from('curated_apps')
          .select('winget_id')
          .in('winget_id', pageStaleIds)
          .eq('is_verified', true)
          .eq('is_winget_verified', true)
          .eq('app_source', 'win32')
          .eq('is_locale_variant', false),
        supabase
          .from('upload_history')
          .select('winget_id')
          .in('winget_id', pageStaleIds),
      ]);
      const { data: supported, error: supportedError } = supportedResult;
      if (supportedError) {
        throw new Error(`Could not filter QA toolchain backfill apps: ${supportedError.message}`);
      }
      if (deployedResult.error) {
        throw new Error(
          `Could not filter QA toolchain backfill demand: ${deployedResult.error.message}`
        );
      }
      const supportedIds = new Set((supported || []).map((app) => app.winget_id));
      // Toolchain refreshes consume the same single-VM queue as new tests.
      // An auto-update policy may raise priority, but only a durable tenant
      // deployment is allowed to put an app into the background campaign.
      const demandedIds = new Set(
        (deployedResult.data || []).map((row) => row.winget_id)
      );
      for (const row of pageStaleRows) {
        if (supportedIds.has(row.winget_id) && demandedIds.has(row.winget_id)) {
          supportedStaleCandidates.push({
            wingetId: row.winget_id,
            status: typeof row.status === 'string' ? row.status : '',
            priority: Number.isFinite(row.priority) ? row.priority : 0,
            enqueuedAt: row.enqueued_at,
          });
        }
      }
    }

    if (supportedStaleCandidates.length >= TOOLCHAIN_BACKFILL_BATCH_SIZE) {
      return {
        ids: prioritizeToolchainBackfill(supportedStaleCandidates).slice(
          0,
          TOOLCHAIN_BACKFILL_BATCH_SIZE
        ),
        pagesScanned,
      };
    }
    if (rows.length < TOOLCHAIN_BACKFILL_PAGE_SIZE) {
      return {
        ids: prioritizeToolchainBackfill(supportedStaleCandidates),
        pagesScanned,
      };
    }

    const last = rows.at(-1);
    if (!last?.enqueued_at || !last.id) {
      throw new Error('Could not advance the QA toolchain backfill cursor.');
    }
    cursor = { enqueuedAt: last.enqueued_at, id: last.id };
  }
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR_LENGTH);
}

function recordPollError(summary: QaPollSummary, scope: string, error: unknown): void {
  summary.errorCount++;
  if (summary.errors.length < MAX_RECORDED_ERRORS) {
    summary.errors.push(`${scope}: ${errorMessage(error)}`);
  }
}

async function findDemandBackfillIds(
  supabase: ReturnType<typeof createServerClient>
): Promise<string[]> {
  const { data, error } = await supabase.rpc('qa_missing_demand_backfill_ids', {
    p_limit: DEMAND_BACKFILL_BATCH_SIZE,
  });
  if (error) throw new Error(`Could not select demanded-app QA backfill: ${error.message}`);
  return Array.from(
    new Set(
      ((data || []) as Array<{ winget_id?: unknown }>)
        .map((row) => (typeof row.winget_id === 'string' ? row.winget_id.trim() : ''))
        .filter(Boolean)
    )
  );
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = new Date().toISOString();
  const startedAtMs = Date.now();
  const requestId = request.headers.get('x-vercel-id');
  const summary: QaPollSummary = {
    checked: 0,
    updatesFound: 0,
    queued: 0,
    alreadyKnown: 0,
    unavailable: 0,
    errorCount: 0,
    errors: [],
  };
  let recipeCount = 0;
  let changedPackageCount = 0;
  let supportedChangedCount = 0;
  let toolchainBackfillCount = 0;
  let toolchainBackfillPagesScanned = 0;
  let demandBackfillRequestedCount = 0;
  let demandBackfillCount = 0;
  let baseSha: string | null = null;
  let headSha: string | null = null;
  let runId: string | null = null;
  let supabase: ReturnType<typeof createServerClient> | null = null;

  const persistRun = async (
    status: QaPollRunStatus,
    durationMs: number,
    alertDelivery: QaPollAlertDelivery | null
  ) => {
    if (!supabase || !runId) return;
    const { error } = await supabase
      .from('qa_poll_runs')
      .update({
        status,
        finished_at: new Date().toISOString(),
        duration_ms: durationMs,
        recipe_count: recipeCount,
        checked_count: summary.checked,
        updates_found_count: summary.updatesFound,
        queued_count: summary.queued,
        already_known_count: summary.alreadyKnown,
        unavailable_count: summary.unavailable,
        error_count: summary.errorCount,
        errors: summary.errors,
        alert_delivery: alertDelivery,
        base_sha: baseSha,
        head_sha: headSha,
        changed_package_count: changedPackageCount,
        supported_changed_count: supportedChangedCount,
        demand_backfill_requested_count: demandBackfillRequestedCount,
        demand_backfill_count: demandBackfillCount,
      })
      .eq('id', runId);
    if (error) throw new Error(`Could not finalize QA poll run ${runId}: ${error.message}`);
  };

  try {
    supabase = createServerClient();
    const control = await getQaPipelineControl(supabase);
    if (control.paused) {
      return NextResponse.json({
        success: true,
        paused: true,
        reason: 'maintenance_paused',
        maintenanceReason: control.reason,
        pausedAt: control.updatedAt,
      });
    }
    const { data: pollRun, error: pollRunError } = await supabase
      .from('qa_poll_runs')
      .insert({ request_id: requestId, started_at: startedAt })
      .select('id')
      .single();
    if (pollRunError) throw new Error(`Could not create QA poll run: ${pollRunError.message}`);
    runId = pollRun.id;

    const [coverageResult, stateResult] = await Promise.all([
      supabase
        .from('curated_apps')
        .select('winget_id', { count: 'exact', head: true })
        .eq('is_verified', true)
        .eq('is_winget_verified', true)
        .eq('app_source', 'win32')
        .eq('is_locale_variant', false),
      supabase
        .from('qa_winget_poll_state')
        .select('head_sha, last_checked_at, github_etag, github_rate_limited_until')
        .eq('id', POLL_STATE_ID)
        .maybeSingle(),
    ]);
    if (coverageResult.error) {
      throw new Error(`Could not count the supported QA catalog: ${coverageResult.error.message}`);
    }
    if (stateResult.error) {
      throw new Error(`Could not read the WinGet poll cursor: ${stateResult.error.message}`);
    }
    recipeCount = coverageResult.count || 0;
    baseSha = stateResult.data?.head_sha || null;

    const lookbackStart = new Date(
      Date.now() - INITIAL_LOOKBACK_MINUTES * 60 * 1000
    ).toISOString();
    const changes = await detectWingetChanges({
      token: process.env.GITHUB_PAT,
      baseSha,
      since: stateResult.data?.last_checked_at || lookbackStart,
      etag: stateResult.data?.github_etag || null,
      rateLimitedUntil: stateResult.data?.github_rate_limited_until || null,
    });
    baseSha = changes.baseSha;
    headSha = changes.headSha;
    changedPackageCount = changes.changedPackageIds.length;
    if (changes.comparisonTruncated) {
      structuredQaPollLog('info', 'qa_winget_compare_reanchored', {
        runId,
        requestId,
        baseSha,
        headSha,
        sampledChangedPackageCount: changedPackageCount,
        recovery: 'demanded_app_reconciliation',
      });
    }
    if (changes.rateLimitedUntil) {
      const { error: rateLimitStateError } = await supabase
        .from('qa_winget_poll_state')
        .update({
          github_rate_limited_until: changes.rateLimitedUntil,
          updated_at: new Date().toISOString(),
        })
        .eq('id', POLL_STATE_ID);
      if (rateLimitStateError) {
        throw new Error(`Could not persist the GitHub rate-limit reset: ${rateLimitStateError.message}`);
      }
      recordPollError(
        summary,
        'system',
        `WinGet GitHub change feed paused until ${changes.rateLimitedUntil}`
      );
    }
    const [backfill, demandBackfillIds] = await Promise.all([
      findToolchainBackfillIds(supabase),
      findDemandBackfillIds(supabase),
    ]);
    toolchainBackfillPagesScanned = backfill.pagesScanned;
    demandBackfillRequestedCount = demandBackfillIds.length;
    const changedIds = new Set(changes.changedPackageIds);
    const backfillIds = new Set(backfill.ids);
    const demandBackfillIdSet = new Set(demandBackfillIds);
    const targetPackageIds = Array.from(
      new Set([...changedIds, ...backfillIds, ...demandBackfillIdSet])
    );

    structuredQaPollLog('info', 'qa_poll_started', {
      runId,
      requestId,
      startedAt,
      coveredApps: recipeCount,
      baseSha,
      headSha,
      changedPackageCount,
      toolchainBackfillRequestedCount: backfill.ids.length,
      toolchainBackfillPagesScanned,
      demandBackfillRequestedCount,
    });

    let supportedApps: Array<{
      winget_id: string;
      name: string;
      publisher: string;
      latest_version: string | null;
    }> = [];
    if (targetPackageIds.length > 0) {
      const { data, error } = await supabase
        .from('curated_apps')
        .select('winget_id, name, publisher, latest_version')
        .in('winget_id', targetPackageIds)
        .eq('is_verified', true)
        .eq('is_winget_verified', true)
        .eq('app_source', 'win32')
        .eq('is_locale_variant', false);
      if (error) throw new Error(`Could not filter changed WinGet packages: ${error.message}`);
      supportedApps = data || [];
    }
    const supportedIds = supportedApps.map((app) => app.winget_id);
    let recipes: Array<{
      winget_id: string;
      definition_path: string;
      architecture: string;
      installer_type: string;
    }> = [];
    let policies: Array<{ winget_id: string }> = [];
    let deployedApps: Array<{ winget_id: string }> = [];
    let results: Array<{
      winget_id: string;
      tested_version: string;
      architecture: string;
      installer_sha256: string | null;
      outcome: string;
      tested_at_utc: string;
      package_profile_sha256: string | null;
    }> = [];
    if (supportedIds.length > 0) {
      const [recipeResult, policyResult, deployedResult, resultResult] = await Promise.all([
        supabase
          .from('qa_recipes')
          .select('winget_id, definition_path, architecture, installer_type')
          .in('winget_id', supportedIds)
          .eq('active', true),
        supabase
          .from('app_update_policies')
          .select('winget_id')
          .in('winget_id', supportedIds)
          .eq('policy_type', 'auto_update')
          .eq('is_enabled', true),
        supabase
          .from('upload_history')
          .select('winget_id')
          .in('winget_id', supportedIds),
        supabase
          .from('qa_package_results')
          .select(
            'winget_id, tested_version, architecture, installer_sha256, outcome, tested_at_utc, package_profile_sha256'
          )
          .in('winget_id', supportedIds),
      ]);
      if (recipeResult.error) {
        throw new Error(`Could not read optional QA recipes: ${recipeResult.error.message}`);
      }
      if (policyResult.error) {
        throw new Error(`Could not prioritize QA candidates: ${policyResult.error.message}`);
      }
      if (deployedResult.error) {
        throw new Error(`Could not read deployed-app QA demand: ${deployedResult.error.message}`);
      }
      if (resultResult.error) {
        throw new Error(`Could not read existing QA results: ${resultResult.error.message}`);
      }
      recipes = recipeResult.data || [];
      policies = policyResult.data || [];
      deployedApps = deployedResult.data || [];
      results = resultResult.data || [];
    }

    const priorities = new Map<string, number>();
    for (const policy of policies) {
      priorities.set(policy.winget_id, (priorities.get(policy.winget_id) || 0) + 1);
    }
    const demandedIds = new Set<string>(policies.map((policy) => policy.winget_id));
    for (const deployed of deployedApps) {
      demandedIds.add(deployed.winget_id);
      if (!priorities.has(deployed.winget_id)) priorities.set(deployed.winget_id, 1);
    }
    supportedApps = supportedApps.filter((app) => demandedIds.has(app.winget_id));
    supportedChangedCount = supportedApps.filter((app) => changedIds.has(app.winget_id)).length;
    toolchainBackfillCount = supportedApps.filter((app) => backfillIds.has(app.winget_id)).length;
    demandBackfillCount = supportedApps.filter((app) =>
      demandBackfillIdSet.has(app.winget_id)
    ).length;
    const recipeById = new Map(recipes.map((row) => [row.winget_id, row]));
    const passedResultByPayload = new Map<string, (typeof results)[number]>();
    for (const result of results) {
      if (result.outcome !== 'Passed' || !result.installer_sha256) continue;
      const key = [
        result.winget_id.toLowerCase(),
        result.tested_version,
        result.architecture.toLowerCase(),
        result.installer_sha256.toUpperCase(),
      ].join('|');
      const existing = passedResultByPayload.get(key);
      if (!existing || result.tested_at_utc > existing.tested_at_utc) {
        passedResultByPayload.set(key, result);
      }
    }
    const client = createWingetManifestClient({ token: process.env.GITHUB_PAT, maxRetries: 2 });

    for (let index = 0; index < supportedApps.length; index += BATCH_SIZE) {
      const batch = supportedApps.slice(index, index + BATCH_SIZE);
      await Promise.all(
        batch.map(async (app) => {
          summary.checked++;
          try {
            const recipe = recipeById.get(app.winget_id);
            const resolution = await resolveWingetManifest({
              client,
              wingetId: app.winget_id,
              storedVersion: undefined,
              preferLive: true,
            });
            if (resolution.status !== 'resolved') {
              summary.unavailable++;
              return;
            }

            const manifest = resolution.manifest as Record<string, unknown>;
            const installers = (manifest.Installers || []) as Array<Record<string, unknown>>;
            const selectedForVm = recipe
              ? (() => {
                  const installer = selectWingetInstaller(installers, recipe.architecture);
                  return installer
                    ? { installer, architecture: recipe.architecture as 'x64' | 'x86' | 'arm64' }
                    : null;
                })()
              : selectQaVmInstaller(installers);
            if (!selectedForVm) {
              summary.unavailable++;
              return;
            }
            const selected = selectedForVm.installer as Record<string, unknown>;
            const installerUrl = String(selected.InstallerUrl || '');
            const installerSha256 = normalizeInstallerSha256(
              String(selected.InstallerSha256 || '')
            );
            const sourceInstallerType = String(
              selected.InstallerType || manifest.InstallerType || ''
            );
            const installerType = normalizeQaInstallerType(
              sourceInstallerType,
              recipe?.installer_type || 'exe'
            );
            if (!installerUrl.startsWith('https://') || !installerSha256) {
              throw new Error('resolved installer is missing a valid HTTPS URL or SHA-256');
            }

            const architecture = selectedForVm.architecture;
            const testConfig = buildQaCatalogTestConfig({
              app: { ...app, wingetId: app.winget_id, version: resolution.version },
              manifest,
              installer: selectedForVm.installer as never,
            });
            let packageDependencies: Awaited<
              ReturnType<typeof resolveWingetPackageDependencies>
            >;
            try {
              packageDependencies = await resolveWingetPackageDependencies({
                wingetId: app.winget_id,
                version: resolution.version,
                architecture,
                installerSha256,
                installScope: testConfig.scope,
              });
            } catch (error) {
              if (!isWingetDependencyCompatibilityError(error)) throw error;
              const { error: blockError } = await supabase!
                .from('qa_package_blocks')
                .upsert({
                  winget_id: app.winget_id,
                  version: resolution.version,
                  architecture,
                  installer_sha256: installerSha256,
                  block_code: error.blockCode,
                  detail: error.message,
                  observed_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                }, {
                  onConflict: 'winget_id,version,architecture,installer_sha256',
                });
              if (blockError) {
                throw new Error(`Could not persist the QA compatibility block: ${blockError.message}`);
              }
              summary.unavailable++;
              structuredQaPollLog('info', 'qa_package_compatibility_blocked', {
                runId,
                wingetId: app.winget_id,
                version: resolution.version,
                architecture,
                blockCode: error.blockCode,
              });
              return;
            }
            if (packageDependencies.length > 0) {
              testConfig.packageDependencies = packageDependencies;
            }
            const packageIdentity = buildQaPackageIdentity({
              profileKind: testConfig.profileKind,
              wingetId: app.winget_id,
              displayName: testConfig.displayName,
              publisher: testConfig.publisher,
              version: resolution.version,
              architecture,
              installerSha256,
              sourceInstallerType: testConfig.sourceInstallerType,
              silentArgs: testConfig.silentArgs,
              successCodes: testConfig.successCodes,
              uninstallCommand: testConfig.uninstallCommand,
              installScope: testConfig.scope,
              nestedInstallerType: testConfig.nestedInstallerType,
              nestedInstallerFiles: testConfig.nestedInstallerFiles,
              psadtConfig: testConfig.psadtConfig,
              detectionRules: testConfig.detectionRules,
              packageDependencies,
            });
            const packagingContract = evaluatePackagingContract({
              wingetId: app.winget_id,
              installerType: sourceInstallerType,
              silentArgs: testConfig.silentArgs,
              nestedInstallerType: testConfig.nestedInstallerType,
              nestedInstallerFiles: testConfig.nestedInstallerFiles,
            });
            testConfig.packageProfileCanonicalJson = packageIdentity.canonicalJson;
            testConfig.packageProfileSha256 = packageIdentity.packageProfileSha256;
            testConfig.psadtConfigSha256 = packageIdentity.psadtConfigSha256;
            testConfig.detectionRulesSha256 = packageIdentity.detectionRulesSha256;
            const payloadKey = [
              app.winget_id.toLowerCase(),
              resolution.version,
              architecture.toLowerCase(),
              installerSha256,
            ].join('|');
            const previous = passedResultByPayload.get(payloadKey);
            // A successful QA run qualifies the immutable installer payload.
            // Presentation-only PSADT profile changes must not schedule the same
            // app version repeatedly.
            const previousMatches = Boolean(previous);
            const now = new Date().toISOString();
            const initialStatus = !packagingContract.valid
              ? 'failed'
              : previousMatches
                ? 'passed'
                : 'queued';
            const { data: inserted, error: insertError } = await supabase!
              .from('qa_candidates')
              .insert({
                winget_id: app.winget_id,
                definition_path: recipe?.definition_path || null,
                version: resolution.version,
                architecture,
                installer_url: installerUrl,
                installer_sha256: installerSha256,
                installer_type: installerType,
                installer_file_name: qaInstallerFileName(installerUrl, installerType),
                test_level: 'psadt-package',
                package_profile_sha256: packageIdentity.packageProfileSha256,
                test_config: testConfig as never,
                catalog_version_at_enqueue: app.latest_version,
                status: initialStatus,
                priority: priorities.get(app.winget_id) || 0,
                demand_source: policies.some((policy) => policy.winget_id === app.winget_id)
                  ? 'auto_update'
                  : 'managed',
                failure_summary: !packagingContract.valid
                  ? `Packaging preflight: ${packagingContract.message}`
                  : null,
                finished_at: initialStatus === 'queued'
                  ? null
                  : !packagingContract.valid
                    ? now
                    : previous?.tested_at_utc || now,
                updated_at: now,
              })
              .select('id')
              .single();

            if (insertError?.code === '23505') {
              summary.alreadyKnown++;
              const { data: existing, error: existingError } = await supabase!
                .from('qa_candidates')
                .select('id, status')
                .eq('winget_id', app.winget_id)
                .eq('version', resolution.version)
                .eq('architecture', architecture)
                .eq('installer_sha256', installerSha256)
                .eq('package_profile_sha256', packageIdentity.packageProfileSha256)
                .maybeSingle();
              if (existingError) {
                throw new Error(`Could not read the existing QA candidate: ${existingError.message}`);
              }
              if (existing?.status === 'superseded') {
                const { error: reactivateError } = await supabase!
                  .from('qa_candidates')
                  .update({
                    status: 'queued',
                    priority: priorities.get(app.winget_id) || 0,
                    attempts: 0,
                    finished_at: null,
                    failure_summary: null,
                    test_config: testConfig as never,
                    catalog_version_at_enqueue: app.latest_version,
                    updated_at: now,
                  })
                  .eq('id', existing.id)
                  .eq('status', 'superseded');
                if (reactivateError) throw reactivateError;
                const { error: supersedeError } = await supabase!
                  .from('qa_candidates')
                  .update({ status: 'superseded', finished_at: now, updated_at: now })
                  .eq('winget_id', app.winget_id)
                  .eq('architecture', architecture)
                  .eq('test_level', 'psadt-package')
                  .contains('test_config', { profileKind: 'catalog-default' })
                  .eq('status', 'queued')
                  .neq('id', existing.id);
                if (supersedeError) throw supersedeError;
                summary.queued++;
              } else if (existing?.status === 'queued') {
                const { error: priorityError } = await supabase!
                  .from('qa_candidates')
                  .update({
                    priority: priorities.get(app.winget_id) || 0,
                    test_config: testConfig as never,
                    updated_at: now,
                  })
                  .eq('id', existing.id)
                  .eq('status', 'queued');
                if (priorityError) throw priorityError;
              }
              return;
            }
            if (insertError) throw insertError;

            summary.updatesFound++;
            if (initialStatus !== 'queued') {
              summary.alreadyKnown++;
              return;
            }

            summary.queued++;
            const { error: supersedeError } = await supabase!
              .from('qa_candidates')
              .update({ status: 'superseded', finished_at: now, updated_at: now })
              .eq('winget_id', app.winget_id)
              .eq('architecture', architecture)
              .eq('test_level', 'psadt-package')
              .contains('test_config', { profileKind: 'catalog-default' })
              .eq('status', 'queued')
              .neq('id', inserted.id);
            if (supersedeError) throw supersedeError;
          } catch (error) {
            recordPollError(summary, app.winget_id, error);
          }
        })
      );
    }

    // The change-feed cursor represents a successful GitHub comparison, not
    // the outcome of every package inspected from that comparison. Advancing
    // it must not be blocked by an isolated manifest, policy, or packaging
    // error; demanded apps that still lack QA are retried by the bounded
    // reconciliation query on subsequent polls. A GitHub rate-limit deferral
    // is different: no new comparison was performed, so preserve the cursor.
    if (!changes.rateLimitedUntil) {
      const { error: cursorError } = await supabase
        .from('qa_winget_poll_state')
        .update({
          head_sha: headSha,
          github_etag: changes.etag,
          github_rate_limited_until: null,
          last_checked_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', POLL_STATE_ID);
      if (cursorError) throw new Error(`Could not advance the WinGet poll cursor: ${cursorError.message}`);
    }

    const status = qaPollRunStatus(summary);
    const durationMs = Date.now() - startedAtMs;
    const alertDelivery =
      status === 'partial'
        ? await emitQaPollAlert({
            runId,
            requestId,
            status,
            startedAt,
            durationMs,
            recipeCount,
            summary,
          })
        : null;

    await persistRun(status, durationMs, alertDelivery);
    structuredQaPollLog('info', 'qa_poll_completed', {
      runId,
      requestId,
      status,
      durationMs,
      coveredApps: recipeCount,
      baseSha,
      headSha,
      changedPackageCount,
      supportedChangedCount,
      toolchainBackfillCount,
      toolchainBackfillPagesScanned,
      demandBackfillRequestedCount,
      demandBackfillCount,
      ...summary,
    });

    return NextResponse.json(
      {
        success: status === 'succeeded',
        runId,
        coveredApps: recipeCount,
        recipeCount,
        durationMs,
        baseSha,
        headSha,
        changedPackageCount,
        supportedChangedCount,
        toolchainBackfillCount,
        toolchainBackfillPagesScanned,
        demandBackfillRequestedCount,
        demandBackfillCount,
        ...summary,
      },
      { status: status === 'succeeded' ? 200 : 207 }
    );
  } catch (error) {
    recordPollError(summary, 'system', error);
    const durationMs = Date.now() - startedAtMs;
    const alertDelivery = await emitQaPollAlert({
      runId,
      requestId,
      status: 'failed',
      startedAt,
      durationMs,
      recipeCount,
      summary,
    });
    try {
      await persistRun('failed', durationMs, alertDelivery);
    } catch (persistError) {
      structuredQaPollLog('error', 'qa_poll_persistence_failed', {
        runId,
        requestId,
        error: errorMessage(persistError),
      });
    }
    return NextResponse.json(
      {
        success: false,
        runId,
        coveredApps: recipeCount,
        recipeCount,
        durationMs,
        baseSha,
        headSha,
        changedPackageCount,
        supportedChangedCount,
        toolchainBackfillCount,
        toolchainBackfillPagesScanned,
        demandBackfillRequestedCount,
        demandBackfillCount,
        ...summary,
      },
      { status: 500 }
    );
  }
}

export const maxDuration = 300;
