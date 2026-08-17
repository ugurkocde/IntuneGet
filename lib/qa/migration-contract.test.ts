import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPaths = [
  'supabase/migrations/20260807193111_qa_release_gate.sql',
  'supabase/migrations/20260807205000_qa_candidate_terminal_evidence.sql',
  'supabase/migrations/20260808193500_qa_candidate_catalog_promotion.sql',
  'supabase/migrations/20260808194800_harden_qa_catalog_promotion_order.sql',
  'supabase/migrations/20260815004500_preserve_deployment_config_qa_retries.sql',
];

describe.each(migrationPaths)('QA candidate migration contract: %s', (migrationPath) => {
  const sql = readFileSync(resolve(process.cwd(), migrationPath), 'utf8');

  it('only clears per-attempt evidence when another retry will run', () => {
    for (const column of ['dispatched_at', 'started_at', 'github_run_id', 'github_run_url']) {
      expect(sql).toContain(
        `${column} = case when normalized_outcome = 'retry' and attempts < 2 then null else ${column} end`
      );
    }
  });

  it('keeps terminal retry exhaustion distinct from a re-queued retry', () => {
    expect(sql).toContain("when normalized_outcome = 'retry' and attempts < 2 then 'queued'");
    expect(sql).toContain("when normalized_outcome = 'retry' then 'error'");
  });
});

describe('QA candidate catalog promotion migration contract', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/20260808194800_harden_qa_catalog_promotion_order.sql'),
    'utf8'
  );

  it('requires exact passed package evidence before promotion', () => {
    expect(sql).toContain("result.outcome = 'Passed'");
    expect(sql).toContain('result.tested_version = candidate.version');
    expect(sql).toContain('result.installer_sha256 = candidate.installer_sha256');
    expect(sql).toContain('result.package_profile_sha256 = candidate.package_profile_sha256');
  });

  it('uses an optimistic catalog-version guard to prevent rollback', () => {
    expect(sql).toContain('app.latest_version is not distinct from candidate.catalog_version_at_enqueue');
    expect(sql).toContain('later.enqueued_at > candidate.enqueued_at');
    expect(sql).not.toContain('catalog_version_at_enqueue = candidate.version');
  });

  it('supersedes stale retries and records skipped promotions', () => {
    expect(sql).toContain("set status = 'superseded'");
    expect(sql).toContain('Retry superseded because the catalog version changed after enqueue.');
    expect(sql).toContain('Catalog promotion skipped because a newer release candidate exists.');
    expect(sql).toContain('Catalog promotion skipped because the catalog version changed after enqueue.');
  });
});

describe('QA exact deployment-config retry migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260815004500_preserve_deployment_config_qa_retries.sql'
    ),
    'utf8'
  );

  it('limits catalog-drift supersession to catalog-default candidates', () => {
    const retryGuard = sql.slice(
      sql.indexOf("if normalized_outcome = 'retry'"),
      sql.indexOf("if normalized_outcome = 'passed'")
    );
    expect(retryGuard).toContain("candidate.test_config->>'profileKind' = 'catalog-default'");
    expect(retryGuard).not.toContain("candidate.test_config->>'profileKind' = 'deployment-config'");
  });

  it('continues to restrict catalog promotion to catalog-default candidates', () => {
    expect(sql).toContain("candidate.test_config->>'profileKind' = 'catalog-default'");
    expect(sql).toContain('insert into public.version_history');
  });
});

describe('QA dispatcher schema contract', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/20260807193111_qa_release_gate.sql'),
    'utf8'
  );

  it('defines superseded as terminal and provides its completion timestamp', () => {
    expect(sql).toContain("'error', 'superseded'");
    expect(sql).toContain('finished_at timestamptz');
  });

  it('enforces a non-null integer priority and a single active candidate', () => {
    expect(sql).toContain('priority integer not null default 0');
    expect(sql).toContain('create unique index qa_candidates_single_active_idx');
    expect(sql).toContain("where status in ('dispatched', 'running')");
  });
});

describe('QA live dashboard migration contract', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/20260808165628_qa_live_dashboard.sql'),
    'utf8'
  );

  it('keeps phase writes monotonic and limited to active candidates', () => {
    expect(sql).toContain("status in ('dispatched', 'running')");
    expect(sql).toContain('p_observed_at > phase_updated_at');
    expect(sql).toContain('returns boolean');
  });

  it('preserves User context while stripping public execution provenance', () => {
    expect(sql).toContain("row_data.environment->>'executionContext' = 'User'");
    expect(sql).toContain('test_id = null');
    expect(sql).toContain('github_run_id = null');
  });
});

describe('QA retry phase reset migration contract', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/20260808182702_clear_qa_retry_phase.sql'),
    'utf8'
  );

  it('clears previous-attempt phase evidence only when a retry is re-queued', () => {
    for (const column of ['phase', 'phase_started_at', 'phase_updated_at']) {
      expect(sql).toContain(
        `${column} = case when normalized_outcome = 'retry' and attempts < 2 then null else ${column} end`
      );
    }
  });
});

describe('QA effective configuration migration contract', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/20260809060000_add_qa_effective_configuration.sql'),
    'utf8'
  );

  it('allows only the compact public configuration shape', () => {
    for (const field of [
      'deployMode',
      'vendorSilentArguments',
      'restartBehavior',
      'promptConfiguration',
      'processCloseCount',
      'uiEvidenceExpected',
    ]) {
      expect(sql).toContain(`'${field}'`);
    }
    expect(sql).toContain("effective_configuration - array[");
    expect(sql).not.toMatch(/promptMessage|processName|brandingPath|registryPath|fileSystemPath/);
  });

  it('keeps the legacy helper private while syncing the new column', () => {
    expect(sql).toContain('effective_configuration = excluded.effective_configuration');
    expect(sql).toContain('from public, anon, authenticated, service_role');
  });
});

describe('demanded-app QA backfill migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260809204500_demanded_app_qa_backfill.sql'
    ),
    'utf8'
  );

  it('selects only supported, demanded apps missing current catalog QA', () => {
    expect(sql).toContain('from public.upload_history as history');
    expect(sql).toContain("policy.policy_type = 'auto_update'");
    expect(sql).toContain('policy.is_enabled is true');
    expect(sql).toContain('app.is_verified is true');
    expect(sql).toContain('app.is_winget_verified is true');
    expect(sql).toContain("app.app_source = 'win32'");
    expect(sql).toContain('app.is_locale_variant is false');
    expect(sql).toContain('candidate.version = app.latest_version');
    expect(sql).toContain("candidate.status <> 'superseded'");
    expect(sql).toContain("candidate.test_config @> '{\"profileKind\":\"catalog-default\"}'::jsonb");
  });

  it('keeps selection bounded, indexed, and service-only', () => {
    expect(sql).toContain('limit greatest(1, least(coalesce(p_limit, 3), 100))');
    expect(sql).toContain('qa_candidates_current_catalog_profile_idx');
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain('from public, anon, authenticated');
    expect(sql).toContain('to service_role');
  });
});

describe('customer-deployed QA campaign migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260810115941_restrict_qa_backfill_to_deployed_apps.sql'
    ),
    'utf8'
  );

  it('requires upload history and uses auto-update only for ordering', () => {
    expect(sql).toContain('from public.upload_history as history');
    expect(sql).toContain("policy.policy_type = 'auto_update'");
    expect(sql).toContain('from deployed');
    expect(sql).not.toContain('union all');
  });
});

describe('QA package compatibility block migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260812072500_qa_package_compatibility_blocks.sql'
    ),
    'utf8'
  );

  it('records an exact immutable installer tuple and keeps it private', () => {
    expect(sql).toContain('primary key (winget_id, version, architecture, installer_sha256)');
    expect(sql).toContain("block_code in ('user_scope_machine_dependencies')");
    expect(sql).toContain('enable row level security');
    expect(sql).toContain('from public, anon, authenticated');
    expect(sql).toContain('to service_role');
  });

  it('skips only the blocked version while preserving deployed-only demand', () => {
    expect(sql).toContain('from public.qa_package_blocks as block');
    expect(sql).toContain('block.version = app.latest_version');
    expect(sql).toContain('from public.upload_history as history');
    expect(sql).toContain('from deployed');
    expect(sql).not.toContain('union all');
  });
});

describe('failed QA backfill priority migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260812184500_prioritize_failed_qa_backfill.sql'
    ),
    'utf8'
  );

  it('prioritizes only failures for the current catalog version', () => {
    expect(sql).toContain('current_app.latest_version = candidate.version');
    expect(sql).toContain("candidate.status in ('failed', 'error')");
    expect(sql).toContain('failure.last_failed_at desc nulls last');
    expect(sql.indexOf('failure.last_failed_at desc nulls last')).toBeLessThan(
      sql.indexOf('demand.has_auto_update desc')
    );
  });

  it('preserves the customer-demand, compatibility, and service-only boundaries', () => {
    expect(sql).toContain('from public.upload_history as history');
    expect(sql).toContain('from public.qa_package_blocks as block');
    expect(sql).toContain("candidate.test_config @> '{\"profileKind\":\"catalog-default\"}'::jsonb");
    expect(sql).toContain('limit greatest(1, least(coalesce(p_limit, 3), 100))');
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain('from public, anon, authenticated');
    expect(sql).toContain('to service_role');
  });
});

describe('retired catalog app migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260812205027_block_retired_catalog_apps.sql'
    ),
    'utf8'
  );

  it('defines a private application-level block and keeps catalog verification false', () => {
    expect(sql).toContain('create table public.package_eligibility_blocks');
    expect(sql).toContain("block_code in ('vendor_retired')");
    expect(sql).toContain('before insert or update on public.curated_apps');
    expect(sql).toContain('new.is_verified := false');
    expect(sql).toContain('enable row level security');
    expect(sql).toContain('from public, anon, authenticated');
    expect(sql).toContain('to service_role');
  });

  it('blocks Autodesk Desktop App from retries and customer-deployed backfill', () => {
    expect(sql).toContain("'Autodesk.DesktopApp'");
    expect(sql).toContain("candidate.status = 'queued'");
    expect(sql).toContain('from public.package_eligibility_blocks as eligibility_block');
    expect(sql).toContain('from public.qa_package_blocks as block');
    expect(sql).toContain('from public.upload_history as history');
    expect(sql).toContain('failure.last_failed_at desc nulls last');
  });
});

describe('unsupported managed uninstall migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260814111854_block_unsupported_managed_uninstall.sql'
    ),
    'utf8'
  );

  it('blocks Cygwin consistently across catalog, customer packaging, and QA', () => {
    expect(sql).toContain("'unsupported_managed_uninstall'");
    expect(sql).toContain("'Cygwin.Cygwin'");
    expect(sql).toContain('https://cygwin.com/faq/faq.html#faq.setup.uninstall-all');
    expect(sql).toContain('set is_verified = false');
    expect(sql).toContain("status = 'superseded'");
    expect(sql).toContain("status = 'queued'");
  });
});

describe('CapCut managed uninstall block migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260814142700_block_capcut_unsupported_managed_uninstall.sql'
    ),
    'utf8'
  );

  it('blocks CapCut consistently across catalog, customer packaging, and QA', () => {
    expect(sql).toContain("'unsupported_managed_uninstall'");
    expect(sql).toContain("'ByteDance.CapCut'");
    expect(sql).toContain('https://github.com/microsoft/winget-pkgs/pull/413669');
    expect(sql).toContain('set is_verified = false');
    expect(sql).toContain("status = 'superseded'");
    expect(sql).toContain("status in ('queued', 'failed')");
  });
});

describe('Firezone managed uninstall block migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260814165000_block_firezone_unsupported_managed_uninstall.sql'
    ),
    'utf8'
  );

  it('blocks Firezone consistently across catalog, customer packaging, and QA', () => {
    expect(sql).toContain("'unsupported_managed_uninstall'");
    expect(sql).toContain("'Firezone.Client.GUI'");
    expect(sql).toContain(
      'https://github.com/firezone/firezone/blob/gui-client-1.5.16/rust/gui-client/src-tauri/win_files/sparse-package.wxs'
    );
    expect(sql).toContain('set is_verified = false');
    expect(sql).toContain("status = 'superseded'");
    expect(sql).toContain("status in ('queued', 'failed')");
  });
});

describe('AOMEI managed uninstall block migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260815054000_block_aomei_unsupported_managed_uninstall.sql'
    ),
    'utf8'
  );

  it('blocks AOMEI consistently across catalog, customer packaging, and QA', () => {
    expect(sql).toContain("'unsupported_managed_uninstall'");
    expect(sql).toContain("'AOMEI.PartitionAssistant'");
    expect(sql).toContain('https://www.diskpart.com/help/install-and-uninstall.html');
    expect(sql).toContain('set is_verified = false');
    expect(sql).toContain("status = 'superseded'");
    expect(sql).toContain("status in ('queued', 'failed')");
  });
});

describe('NVIDIA GeForce NOW managed install block migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260815063000_block_nvidia_geforce_now_managed_install.sql'
    ),
    'utf8'
  );

  it('blocks the unreliable bootstrapper across catalog, customer packaging, and QA', () => {
    expect(sql).toContain("'unsupported_managed_install'");
    expect(sql).toContain("'Nvidia.GeForceNow'");
    expect(sql).toContain(
      'https://github.com/microsoft/winget-pkgs/issues/56299'
    );
    expect(sql).toContain('set is_verified = false');
    expect(sql).toContain("status = 'superseded'");
    expect(sql).toContain("status in ('queued', 'failed')");
  });
});

describe('Roblox managed uninstall block migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260815151000_block_roblox_unsupported_managed_uninstall.sql'
    ),
    'utf8'
  );

  it('blocks the unreliable lifecycle across catalog, customer packaging, and QA', () => {
    expect(sql).toContain("'unsupported_managed_uninstall'");
    expect(sql).toContain("'Roblox.Roblox'");
    expect(sql).toContain(
      'https://github.com/microsoft/winget-pkgs/pull/391567'
    );
    expect(sql).toContain('set is_verified = false');
    expect(sql).toContain("status = 'superseded'");
    expect(sql).toContain("status in ('queued', 'failed')");
  });
});

describe('Sonos Controller managed install block migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260815191000_block_sonos_unsupported_managed_install.sql'
    ),
    'utf8'
  );

  it('blocks the unsupported Sonos launcher across catalog, customer packaging, and QA', () => {
    expect(sql).toContain("'unsupported_managed_install'");
    expect(sql).toContain("'Sonos.Controller'");
    expect(sql).toContain(
      'https://ideas.patchmypc.com/ideas/PATCHMYPC-I-1498'
    );
    expect(sql).toContain('set is_verified = false');
    expect(sql).toContain("status = 'superseded'");
    expect(sql).toContain("status in ('queued', 'failed')");
  });
});

describe('Nmap managed install block migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260816183000_block_nmap_unsupported_managed_install.sql'
    ),
    'utf8'
  );

  it('blocks the unsupported Nmap installer across catalog, customer packaging, and QA', () => {
    expect(sql).toContain("'unsupported_managed_install'");
    expect(sql).toContain("'Insecure.Nmap'");
    expect(sql).toContain(
      'https://github.com/microsoft/winget-pkgs/issues/341747'
    );
    expect(sql).toContain('set is_verified = false');
    expect(sql).toContain("status = 'superseded'");
    expect(sql).toContain("status in ('queued', 'failed')");
  });
});

describe('Yandex Browser managed uninstall block migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260815204500_block_yandex_unsupported_managed_uninstall.sql'
    ),
    'utf8'
  );

  it('blocks the interactive Yandex uninstaller across catalog, customer packaging, and QA', () => {
    expect(sql).toContain("'unsupported_managed_uninstall'");
    expect(sql).toContain("'Yandex.Browser'");
    expect(sql).toContain(
      'https://browser.yandex.com/help/en/about/install'
    );
    expect(sql).toContain('set is_verified = false');
    expect(sql).toContain("status = 'superseded'");
    expect(sql).toContain("status in ('queued', 'failed')");
  });
});

describe('Lark EXE managed uninstall block migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260815235000_block_lark_exe_unsupported_managed_uninstall.sql'
    ),
    'utf8'
  );

  it('blocks the interactive Lark EXE while preserving the enterprise MSI route', () => {
    expect(sql).toContain("'unsupported_managed_uninstall'");
    expect(sql).toContain("'ByteDance.Lark'");
    expect(sql).toContain('ByteDance.Lark.MSI');
    expect(sql).toContain(
      'https://www.larksuite.com/hc/en-US/articles/360048487868-deploy-lark-by-using-microsoft-installer'
    );
    expect(sql).toContain('set is_verified = false');
    expect(sql).toContain("status = 'superseded'");
    expect(sql).toContain("status in ('queued', 'failed')");
  });
});

describe('DWG FastView managed uninstall block migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260816135000_block_dwgfastview_unsupported_managed_uninstall.sql'
    ),
    'utf8'
  );

  it('blocks the unreliable vendor uninstaller across catalog, customer packaging, and QA', () => {
    expect(sql).toContain("'unsupported_managed_uninstall'");
    expect(sql).toContain("'Gstarsoft.DWGFastView'");
    expect(sql).toContain('Gstarsoft.DWGFastView.installer.yaml');
    expect(sql).toContain('set is_verified = false');
    expect(sql).toContain("status = 'superseded'");
    expect(sql).toContain("status in ('queued', 'failed')");
  });
});

describe('Malwarebytes consumer managed uninstall block migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260816193746_block_malwarebytes_unsupported_managed_uninstall.sql'
    ),
    'utf8'
  );

  it('blocks the interactive consumer removal flow across packaging and QA', () => {
    expect(sql).toContain("'unsupported_managed_uninstall'");
    expect(sql).toContain("'Malwarebytes.Malwarebytes'");
    expect(sql).toContain('31589300070683-Uninstall-Malwarebytes-for-Windows-and-Mac');
    expect(sql).toContain('set is_verified = false');
    expect(sql).toContain("status = 'superseded'");
    expect(sql).toContain("status in ('queued', 'failed')");
  });
});

describe('Insta360 Link Controller managed uninstall block migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260817131620_block_insta360_unsupported_managed_uninstall.sql'
    ),
    'utf8'
  );

  it('blocks the unreliable vendor removal flow across packaging and QA', () => {
    expect(sql).toContain("'unsupported_managed_uninstall'");
    expect(sql).toContain("'Insta360.Link.Controller'");
    expect(sql).toContain('controller-client-error/crash');
    expect(sql).toContain('{C05A30CA-A10A-4553-9524-5B377F959166}_is1');
    expect(sql).toContain('set is_verified = false');
    expect(sql).toContain("status = 'superseded'");
    expect(sql).toContain("status in ('queued', 'failed')");
  });
});

describe('QA package result duration migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260812114805_qa_package_result_duration.sql'
    ),
    'utf8'
  );

  it('stores measured duration for every exact package profile', () => {
    expect(sql).toContain('add column if not exists overall_duration_seconds numeric');
    expect(sql).toContain('row_data.overall_duration_seconds');
    expect(sql).toContain('overall_duration_seconds = excluded.overall_duration_seconds');
    expect(sql).toContain('overall_duration_seconds is null or overall_duration_seconds >= 0');
  });

  it('retains the authenticated replay guard and restricted RPC grants', () => {
    expect(sql).toContain('QA result rows must share one non-null source synchronization timestamp');
    expect(sql).toContain('Stale or replayed QA synchronization payload');
    expect(sql).toContain('from public, authenticated, service_role');
    expect(sql).toContain('to anon');
  });
});

describe('QA candidate operator recovery migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260812174000_qa_candidate_operator_recovery.sql'
    ),
    'utf8'
  );

  it('uses the bounded synchronization credential and only terminal infrastructure states', () => {
    expect(sql).toContain("extensions.digest(coalesce(p_secret, ''), 'sha256')");
    expect(sql).toContain("test_level = 'psadt-package'");
    expect(sql).toContain("status in ('error', 'superseded')");
    expect(sql).not.toContain("status in ('failed'");
    expect(sql).not.toContain("status in ('dispatched', 'running')");
  });

  it('clears all prior attempt state and exposes only the narrow RPC', () => {
    for (const column of [
      'attempts = 0',
      'dispatched_at = null',
      'started_at = null',
      'finished_at = null',
      'github_run_id = null',
      'github_run_url = null',
      'phase = null',
      'live_activity = null',
      'live_log = null',
      'failure_summary = null',
    ]) {
      expect(sql).toContain(column);
    }
    expect(sql).toContain('from public, authenticated, service_role');
    expect(sql).toContain('to anon');
  });
});

describe('QA package compatibility block expansion contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260814085000_expand_qa_package_compatibility_blocks.sql'
    ),
    'utf8'
  );

  it('keeps every reviewed preflight incompatibility version-specific', () => {
    expect(sql).toContain('alter table public.qa_package_blocks');
    expect(sql).toContain("'user_scope_machine_dependencies'");
    expect(sql).toContain("'user_scope_elevation_required'");
    expect(sql).toContain("'trusted_installer_tuple_unavailable'");
    expect(sql).toContain("'unreviewed_dependency'");
  });
});

describe('unsupported dependency shape compatibility block contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260814121500_block_unsupported_dependency_shapes.sql'
    ),
    'utf8'
  );

  it('keeps unsupported dependency shapes out of QA and customer packages', () => {
    expect(sql).toContain('alter table public.qa_package_blocks');
    expect(sql).toContain("'unsupported_dependency_shape'");
  });
});
