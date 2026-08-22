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

describe('ExpressVPN managed install block migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260818162500_block_expressvpn_unsupported_managed_install.sql'
    ),
    'utf8'
  );

  it('blocks the undocumented ExpressVPN 14 installer across customer packaging and QA', () => {
    expect(sql).toContain("'unsupported_managed_install'");
    expect(sql).toContain("'ExpressVPN.ExpressVPN'");
    expect(sql).toContain(
      'https://github.com/microsoft/winget-pkgs/pull/390529'
    );
    expect(sql).toContain('set is_verified = false');
    expect(sql).toContain("status = 'superseded'");
    expect(sql).toContain("status in ('queued', 'failed')");
  });
});

describe('Bria managed uninstall block migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260818165200_block_bria_unsupported_managed_uninstall.sql'
    ),
    'utf8'
  );

  it('blocks the unsupported Bria removal lifecycle across customer packaging and QA', () => {
    expect(sql).toContain("'unsupported_managed_uninstall'");
    expect(sql).toContain("'Bria.Bria'");
    expect(sql).toContain(
      'https://support.counterpath.com/hc/how-to-fully-uninstall-bria'
    );
    expect(sql).toContain('set is_verified = false');
    expect(sql).toContain("status = 'superseded'");
    expect(sql).toContain("status in ('queued', 'failed')");
  });
});

describe('Acronis managed uninstall block migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260818213904_block_acronis_unsupported_managed_uninstall.sql'
    ),
    'utf8'
  );

  it('blocks the unsupported Acronis removal lifecycle across customer packaging and QA', () => {
    expect(sql).toContain("'unsupported_managed_uninstall'");
    expect(sql).toContain("'Acronis.CyberProtectHomeOffice'");
    expect(sql).toContain(
      'https://dl.acronis.com/u/pdf/ATI2026_userguidewindows_en-US.pdf'
    );
    expect(sql).toContain('set is_verified = false');
    expect(sql).toContain("status = 'superseded'");
    expect(sql).toContain("status in ('queued', 'failed')");
  });
});

describe('3CX Phone System managed uninstall block migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260818171800_block_3cx_unsupported_managed_uninstall.sql'
    ),
    'utf8'
  );

  it('blocks the unsupported 3CX removal lifecycle across customer packaging and QA', () => {
    expect(sql).toContain("'unsupported_managed_uninstall'");
    expect(sql).toContain("'3CX.PhoneSystem'");
    expect(sql).toContain('https://www.3cx.com/docs/upgrading-pbx/');
    expect(sql).toContain('set is_verified = false');
    expect(sql).toContain("status = 'superseded'");
    expect(sql).toContain("status in ('queued', 'failed')");
  });
});

describe('PotPlayer managed install block migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260818183000_block_potplayer_unsupported_managed_install.sql'
    ),
    'utf8'
  );

  it('blocks the unsupported PotPlayer LocalSystem install across customer packaging and QA', () => {
    expect(sql).toContain("'unsupported_managed_install'");
    expect(sql).toContain("'Daum.PotPlayer'");
    expect(sql).toContain(
      'https://learn.microsoft.com/en-us/answers/questions/991238/sccm-deployed-apps-failed-with-errors'
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

describe('Logitech SetPoint managed uninstall block migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260817133612_block_setpoint_unsupported_managed_uninstall.sql'
    ),
    'utf8'
  );

  it('blocks the interactive legacy removal flow across packaging and QA', () => {
    expect(sql).toContain("'unsupported_managed_uninstall'");
    expect(sql).toContain("'Logitech.SetPoint'");
    expect(sql).toContain('360023237354-Unable-to-customize-my-mouse-or-keyboard-in-SetPoint');
    expect(sql).toContain('exact sp6');
    expect(sql).toContain('set is_verified = false');
    expect(sql).toContain("status = 'superseded'");
    expect(sql).toContain("status in ('queued', 'failed')");
  });
});

describe('Battle.net managed uninstall block migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260817145500_block_battlenet_unsupported_managed_uninstall.sql'
    ),
    'utf8'
  );

  it('blocks the interactive vendor removal flow across packaging and QA', () => {
    expect(sql).toContain("'unsupported_managed_uninstall'");
    expect(sql).toContain("'Blizzard.BattleNet'");
    expect(sql).toContain('us.support.blizzard.com/en/article/30304');
    expect(sql).toContain('exact Battle.net registration');
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

describe('Canon printer driver managed install block migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260818194500_block_canon_printer_driver_unsupported_managed_install.sql'
    ),
    'utf8'
  );

  it('blocks the undocumented plain EXE lifecycle across packaging and QA', () => {
    expect(sql).toContain("'unsupported_managed_install'");
    expect(sql).toContain("'Canon.GPCL6_V4_PrinterDriver_V21.00'");
    expect(sql).toContain('d7f86d1703d858d6f7fe0308016a2134f05cc03e');
    expect(sql).toContain('set is_verified = false');
    expect(sql).toContain("status = 'superseded'");
    expect(sql).toContain("status in ('queued', 'failed')");
  });
});

describe('darktable managed install block migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260819113500_block_darktable_unsupported_managed_install.sql'
    ),
    'utf8'
  );

  it('blocks the non-terminating LocalSystem lifecycle across customer packaging and QA', () => {
    expect(sql).toContain("'unsupported_managed_install'");
    expect(sql).toContain("'darktable.darktable'");
    expect(sql).toContain(
      'https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/32246509168'
    );
    expect(sql).toContain('set is_verified = false');
    expect(sql).toContain("status = 'superseded'");
    expect(sql).toContain("status in ('queued', 'failed')");
  });
});

describe('FlashPrint managed install block migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260821164000_block_flashprint_unsupported_managed_install.sql'
    ),
    'utf8'
  );

  it('blocks the non-terminating nested LocalSystem lifecycle across customer packaging and QA', () => {
    expect(sql).toContain("'unsupported_managed_install'");
    expect(sql).toContain("'Flashforge.FlashPrint'");
    expect(sql).toContain(
      'https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/32501894421'
    );
    expect(sql).toContain('reviewed 15-minute LocalSystem installation ceiling');
    expect(sql).toContain('set is_verified = false');
    expect(sql).toContain("status = 'superseded'");
    expect(sql).toContain("status in ('queued', 'failed')");
  });
});

describe('.NET Framework Developer Pack managed uninstall block migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260821180000_block_dotnet_developerpack_unsupported_managed_uninstall.sql'
    ),
    'utf8'
  );

  it('blocks the legacy developer pack after both exact vendor removal identities fail', () => {
    expect(sql).toContain("'unsupported_managed_uninstall'");
    expect(sql).toContain("'Microsoft.DotNet.Framework.DeveloperPack.4.6'");
    expect(sql).toContain(
      'https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/32510508197'
    );
    expect(sql).toContain('exact Burn removal command');
    expect(sql).toContain('exact legacy MSI identity');
    expect(sql).toContain('set is_verified = false');
    expect(sql).toContain("status = 'superseded'");
    expect(sql).toContain("status in ('queued', 'failed', 'error')");
  });
});

describe('TreeSize managed uninstall block migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260821195200_block_treesize_unsupported_managed_uninstall.sql'
    ),
    'utf8'
  );

  it('blocks TreeSize after both exact Inno install modes fail managed removal', () => {
    expect(sql).toContain("'unsupported_managed_uninstall'");
    expect(sql).toContain("'JAMSoftware.TreeSize'");
    expect(sql).toContain(
      'https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/32519690272'
    );
    expect(sql).toContain('default current-user mode');
    expect(sql).toContain('reviewed /ALLUSERS administrative mode');
    expect(sql).toContain('set is_verified = false');
    expect(sql).toContain("status = 'superseded'");
    expect(sql).toContain("status in ('queued', 'failed', 'error')");
  });
});

describe('WPS Office unsupported managed install block migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260821212500_block_wps_unsupported_managed_install.sql'
    ),
    'utf8'
  );

  it('blocks both failed unattended WPS execution contexts', () => {
    expect(sql).toContain("'unsupported_managed_install'");
    expect(sql).toContain("'Kingsoft.WPSOffice'");
    expect(sql).toContain(
      'https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/32527160668'
    );
    expect(sql).toContain('user scope requests elevation and is cancelled');
    expect(sql).toContain('reviewed LocalSystem -S retry stalls without activity');
    expect(sql).toContain('set is_verified = false');
    expect(sql).toContain("status = 'superseded'");
    expect(sql).toContain("status in ('queued', 'failed', 'error')");
  });
});

describe('SQL Server 2017 Express unsupported managed install block migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260821233000_block_sql_server_2017_express_unsupported_managed_install.sql'
    ),
    'utf8'
  );

  it('blocks the deployment-specific SQL Server lifecycle from generic packaging', () => {
    expect(sql).toContain("'unsupported_managed_install'");
    expect(sql).toContain("'Microsoft.SQLServer.2017.Express'");
    expect(sql).toContain(
      'https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/32536238628'
    );
    expect(sql).toContain('features or role, instance identity, and SQL sysadmin accounts');
    expect(sql).toContain('exact manifest command exited -1');
    expect(sql).toContain('set is_verified = false');
    expect(sql).toContain("status = 'superseded'");
    expect(sql).toContain("status in ('queued', 'failed', 'error')");
  });
});

describe('SQL Server 2025 Express unsupported managed install block migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260822120000_block_sql_server_2025_express_unsupported_managed_install.sql'
    ),
    'utf8'
  );

  it('blocks the deployment-specific SQL Server lifecycle from generic packaging', () => {
    expect(sql).toContain("'unsupported_managed_install'");
    expect(sql).toContain("'Microsoft.SQLServer.2025.Express'");
    expect(sql).toContain(
      'https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/32566074806'
    );
    expect(sql).toContain('features or role, instance identity, and SQL sysadmin accounts');
    expect(sql).toContain('exact manifest command exited -1');
    expect(sql).toContain('set is_verified = false');
    expect(sql).toContain("status = 'superseded'");
    expect(sql).toContain("status in ('queued', 'failed', 'error')");
  });
});

describe('QA canonical sync statement timeout migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260822000500_extend_qa_sync_statement_timeout.sql'
    ),
    'utf8'
  );

  it('extends only the secret-gated sync RPC instead of the shared anon role', () => {
    expect(sql).toContain(
      'alter function public.sync_qa_results_v2(text, jsonb, jsonb, boolean)'
    );
    expect(sql).toContain("set statement_timeout = '30s'");
    expect(sql).not.toContain('alter role anon');
    expect(sql).not.toContain('alter role authenticator');
  });
});

describe('OpenSCAD unsupported managed uninstall block migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260822005500_block_openscad_unsupported_managed_uninstall.sql'
    ),
    'utf8'
  );

  it('blocks the vendor-confirmed orphaned uninstall registration lifecycle', () => {
    expect(sql).toContain("'unsupported_managed_uninstall'");
    expect(sql).toContain("'OpenSCAD.OpenSCAD'");
    expect(sql).toContain('https://github.com/openscad/openscad/issues/5494');
    expect(sql).toContain('documented /S switch');
    expect(sql).toContain('full five-minute completion window');
    expect(sql).toContain('set is_verified = false');
    expect(sql).toContain("status = 'superseded'");
    expect(sql).toContain("status in ('queued', 'failed', 'error')");
  });
});

describe('Open Live Writer unsupported managed install block migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260822010000_block_openlivewriter_unsupported_managed_install.sql'
    ),
    'utf8'
  );

  it('blocks the Squirrel per-user lifecycle from LocalSystem deployment', () => {
    expect(sql).toContain("'unsupported_managed_install'");
    expect(sql).toContain("'OpenLiveWriter.OpenLiveWriter'");
    expect(sql).toContain(
      'https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/32541754573'
    );
    expect(sql).toContain('executing user\'s %LocalAppData%');
    expect(sql).toContain('SYSTEM profile instead of employee profiles');
    expect(sql).toContain('set is_verified = false');
    expect(sql).toContain("status = 'superseded'");
    expect(sql).toContain("status in ('queued', 'failed', 'error')");
  });
});

describe('ReSharper EAP host-dependent install block migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260821104500_block_resharper_eap_host_dependent_install.sql'
    ),
    'utf8'
  );

  it('blocks the Visual Studio-dependent lifecycle across customer packaging and QA', () => {
    expect(sql).toContain("'unsupported_managed_install'");
    expect(sql).toContain("'JetBrains.ReSharper.EAP'");
    expect(sql).toContain(
      'https://www.jetbrains.com/help/resharper/Installation_Guide.html'
    );
    expect(sql).toContain('32472961245');
    expect(sql).toContain('set is_verified = false');
    expect(sql).toContain("status = 'superseded'");
    expect(sql).toContain("status in ('queued', 'failed')");
  });
});

describe('ReSharper stable host-dependent install block migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260822083000_block_resharper_host_dependent_install.sql'
    ),
    'utf8'
  );

  it('blocks the Visual Studio-dependent lifecycle across customer packaging and QA', () => {
    expect(sql).toContain("'unsupported_managed_install'");
    expect(sql).toContain("'JetBrains.ReSharper'");
    expect(sql).toContain(
      'https://www.jetbrains.com/help/resharper/Installation_Guide.html'
    );
    expect(sql).toContain('32556611318');
    expect(sql).toContain('set is_verified = false');
    expect(sql).toContain("status = 'superseded'");
    expect(sql).toContain("status in ('queued', 'failed')");
  });
});

describe('Gather SYSTEM-profile install block migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260822093000_block_gather_unsupported_managed_install.sql'
    ),
    'utf8'
  );

  it('blocks the per-user lifecycle across customer packaging and QA', () => {
    expect(sql).toContain("'unsupported_managed_install'");
    expect(sql).toContain("'Gather.Gather'");
    expect(sql).toContain(
      'https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/32558961384'
    );
    expect(sql).toContain('systemprofile');
    expect(sql).toContain('set is_verified = false');
    expect(sql).toContain("status = 'superseded'");
    expect(sql).toContain("status in ('queued', 'failed', 'error')");
  });
});

describe('Amazon Music managed uninstall block migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260822100000_block_amazon_music_unsupported_managed_uninstall.sql'
    ),
    'utf8'
  );

  it('blocks the incomplete vendor removal lifecycle across packaging and QA', () => {
    expect(sql).toContain("'unsupported_managed_uninstall'");
    expect(sql).toContain("'Amazon.Music'");
    expect(sql).toContain(
      'https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/32559549247'
    );
    expect(sql).toContain('fifteen minutes');
    expect(sql).toContain('residual snapshot');
    expect(sql).toContain('set is_verified = false');
    expect(sql).toContain("status = 'superseded'");
    expect(sql).toContain("status in ('queued', 'failed', 'error')");
  });
});

describe('Standard Notes SYSTEM-profile lifecycle block migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260822104500_block_standard_notes_unsupported_managed_install.sql'
    ),
    'utf8'
  );

  it('blocks the unsafe per-user lifecycle across customer packaging and QA', () => {
    expect(sql).toContain("'unsupported_managed_install'");
    expect(sql).toContain("'StandardNotes.StandardNotes'");
    expect(sql).toContain(
      'https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/32562682034'
    );
    expect(sql).toContain('LocalSystem profile');
    expect(sql).toContain('2,890');
    expect(sql).toContain('set is_verified = false');
    expect(sql).toContain("status = 'superseded'");
    expect(sql).toContain("status in ('queued', 'failed', 'error')");
  });
});

describe('superProductivity SYSTEM-profile lifecycle block migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260822111500_block_superproductivity_unsupported_managed_install.sql'
    ),
    'utf8'
  );

  it('blocks the unsafe per-user lifecycle across customer packaging and QA', () => {
    expect(sql).toContain("'unsupported_managed_install'");
    expect(sql).toContain("'JohannesMillan.superProductivity'");
    expect(sql).toContain(
      'https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/32564266080'
    );
    expect(sql).toContain('LocalSystem profile');
    expect(sql).toContain('2,914');
    expect(sql).toContain('set is_verified = false');
    expect(sql).toContain("status = 'superseded'");
    expect(sql).toContain("status in ('queued', 'failed', 'error')");
  });
});

describe('AMD Cloud Edition hardware-dependent install block migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260821132000_block_amd_cloud_hardware_dependent_install.sql'
    ),
    'utf8'
  );

  it('blocks the Azure AMD GPU-dependent lifecycle across customer packaging and QA', () => {
    expect(sql).toContain("'unsupported_managed_install'");
    expect(sql).toContain("'AMD.AMDSoftwareCloudEdition'");
    expect(sql).toContain(
      'https://learn.microsoft.com/en-us/azure/virtual-machines/windows/n-series-amd-driver-setup'
    );
    expect(sql).toContain('32484265649');
    expect(sql).toContain('set is_verified = false');
    expect(sql).toContain("status = 'superseded'");
    expect(sql).toContain("status in ('queued', 'failed')");
  });
});

describe('Teradata TTU Base suite managed uninstall block migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260822130000_block_teradata_base_suite_unsupported_managed_uninstall.sql'
    ),
    'utf8'
  );

  it('blocks both suite aliases after the exact vendor removal left the suite installed', () => {
    expect(sql).toContain("'unsupported_managed_uninstall'");
    expect(sql).toContain("'Teradata.TeradataBaseSuite'");
    expect(sql).toContain("'Teradata.TTUBase'");
    expect(sql).toContain(
      'https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/32568333477'
    );
    expect(sql).toContain('all 28 added uninstall entries');
    expect(sql).toContain('6,033');
    expect(sql).toContain('all 18 shortcuts');
    expect(sql).toContain('set is_verified = false');
    expect(sql).toContain("status = 'superseded'");
    expect(sql).toContain("status in ('queued', 'failed', 'error')");
  });
});

describe('Wise Disk Cleaner managed uninstall block migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260822133000_block_wise_disk_cleaner_unsupported_managed_uninstall.sql'
    ),
    'utf8'
  );

  it('blocks the incomplete vendor removal lifecycle across packaging and QA', () => {
    expect(sql).toContain("'unsupported_managed_uninstall'");
    expect(sql).toContain("'WiseCleaner.WiseDiskCleaner'");
    expect(sql).toContain(
      'https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/32569486048'
    );
    expect(sql).toContain('Wise Disk Cleaner_is1');
    expect(sql).toContain('both shortcuts');
    expect(sql).toContain('2,967');
    expect(sql).toContain('set is_verified = false');
    expect(sql).toContain("status = 'superseded'");
    expect(sql).toContain("status in ('queued', 'failed', 'error')");
  });
});

describe('Tencent QQ NT managed uninstall block migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260822170000_block_tencent_qq_unsupported_managed_uninstall.sql'
    ),
    'utf8'
  );

  it('blocks the interactive vendor removal lifecycle across packaging and QA', () => {
    expect(sql).toContain("'unsupported_managed_uninstall'");
    expect(sql).toContain("'Tencent.QQ.NT'");
    expect(sql).toContain(
      'https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/32582110657'
    );
    expect(sql).toContain('exact QQ registration');
    expect(sql).toContain('both shortcuts');
    expect(sql).toContain('4,826');
    expect(sql).toContain('set is_verified = false');
    expect(sql).toContain("status = 'superseded'");
    expect(sql).toContain("status in ('queued', 'failed', 'error')");
  });
});

describe('Git for Windows SDK managed uninstall block migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260822173000_block_git_sdk_unsupported_managed_uninstall.sql'
    ),
    'utf8'
  );

  it('blocks the extraction-only SDK lifecycle across packaging and QA', () => {
    expect(sql).toContain("'unsupported_managed_uninstall'");
    expect(sql).toContain("'Git.SDK'");
    expect(sql).toContain(
      'git-sdk-1.0.8/sdk-installer/release.sh'
    );
    expect(sql).toContain('self-extracting .7z archive');
    expect(sql).toContain('zero matching uninstall entries');
    expect(sql).toContain('2,944');
    expect(sql).toContain('set is_verified = false');
    expect(sql).toContain("status = 'superseded'");
    expect(sql).toContain("status in ('queued', 'failed', 'error')");
  });
});
