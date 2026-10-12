-- Curated catalog QA history and verified custom PSADT execution settings.
-- Both tables are written only by the curated automation (service role) and
-- read by the server; neither is exposed to browser clients.

-- One row per curated verification run attempt, pass or fail, in the shape of
-- qa_results (which keeps only the latest result per Winget package).
create table if not exists public.curated_qa_runs (
  github_run_id text not null,
  github_run_attempt integer not null default 1,
  kind text not null check (kind in ('release', 'config')),
  config_verification_id uuid,
  winget_id text not null check (winget_id ilike 'IntuneGet.Curated.%'),
  app_id text not null,
  display_name text not null,
  publisher text not null,
  tested_version text not null,
  architecture text not null check (architecture in ('x64', 'x86')),
  outcome text not null check (outcome in ('Passed', 'Failed')),
  tested_at_utc timestamptz not null,
  candidate_id text not null,
  installer_type text,
  installer_url text,
  installer_sha256 text,
  install_command text,
  uninstall_command text,
  silent_args text,
  detection jsonb not null default '[]'::jsonb,
  phase_results jsonb not null default '{}'::jsonb,
  psadt_config jsonb,
  psadt_config_sha256 text,
  package_profile_sha256 text,
  packager_commit text,
  upgrade_from_version text,
  upgrade_tested boolean,
  signature_status text,
  signer text,
  defender_status text,
  defender_signature_version text,
  failed_phase text,
  failed_step text,
  failed_message text,
  failed_lifecycle text,
  failed_signature text,
  failed_location text,
  workflow_commit text,
  website_commit text,
  github_run_url text not null,
  synced_at timestamptz not null default now(),
  primary key (github_run_id, github_run_attempt)
);

create index if not exists curated_qa_runs_app_tested_idx on public.curated_qa_runs (winget_id, tested_at_utc desc);
alter table public.curated_qa_runs enable row level security;

-- A custom PSADT execution configuration may deploy a curated release only
-- after it passed its own VM verification for that release.
create table if not exists public.curated_config_verifications (
  id uuid primary key default gen_random_uuid(),
  release_id text not null,
  app_id text not null,
  winget_id text not null check (winget_id ilike 'IntuneGet.Curated.%'),
  version text not null,
  psadt_config_sha256 text not null check (psadt_config_sha256 ~ '^[a-f0-9]{64}$'),
  psadt_config jsonb not null,
  status text not null default 'requested' check (status in ('requested', 'verifying', 'passed', 'failed')),
  github_run_id text,
  execution_profile_sha256 text,
  packager_commit text,
  failure_detail text,
  tenant_id text,
  requested_by_user_id text,
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  verified_at timestamptz,
  unique (release_id, psadt_config_sha256)
);

create index if not exists curated_config_verifications_status_idx on public.curated_config_verifications (status, requested_at);
alter table public.curated_config_verifications enable row level security;
