# Database Setup

IntuneGet uses Supabase PostgreSQL for application state, catalog data, and server-side Microsoft authentication data.

## Apply the migrations

Supabase CLI migrations use the version prefix before the first underscore as
their unique history identifier. A different filename suffix does not create a
different version. See the [Supabase migration history reference](https://supabase.com/docs/reference/cli/supabase-migration-repair).

Migration versions are unique. The former duplicate versions reported in
[issue #449](https://github.com/ugurkocde/IntuneGet/issues/449) are separated into
`014_sccm_migration.sql`, `0141_winget_index_v2.sql`,
`015_enhanced_error_handling.sql`, and `0151_msp_batch_and_webhooks.sql`.
Use the CLI's migration version order rather than sorting complete filenames.

Use Supabase CLI 2.115.0 or later for these migrations and confirm the installed
version with `supabase --version` before following either installation path.
The migration version ordering was checked with CLI 2.115.0. A tool that sorts
complete filenames places `0141_...` before `014_...` and `0151_...` before
`015_...`, which does not match version order.

For a fresh installation, install the CLI using
the [official installation guide](https://supabase.com/docs/guides/local-development/cli/getting-started),
then use the normal deployment commands:

```bash
supabase login
supabase link --project-ref your-project-ref
supabase db push
```

Always start with `000_user_profiles.sql`. This migration creates the profile table required for authentication and token persistence.

Direct SQL Editor execution does not maintain the CLI migration history and is
not an interchangeable fallback for `db push`. If an installation already used
that method, preserve its schema and reconcile its actual history before moving
to CLI migrations.

## Credentials

From **Settings > API** in the Supabase dashboard, configure:

| Supabase value | Environment variable |
|---|---|
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` |
| Anonymous key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| Service role key | `SUPABASE_SERVICE_ROLE_KEY` |

Keep the service role key server-side. The `user_profiles` table contains Microsoft access and refresh tokens and is accessible only to the service role through row level security.

## Core tables

- `user_profiles`: Microsoft identity profile, tenant, and token persistence
- `packaging_jobs`: packaging and Intune upload job state
- `curated_apps`: curated application catalog metadata

Additional feature tables are introduced by later migrations. Treat [`supabase/migrations/`](../supabase/migrations/) as the source of truth for the current schema.

## Updating an installation

Before applying an update, inspect the linked project's history with
`supabase migration list`. Once version uniqueness and history alignment have
been established, `supabase db push` applies pending migrations.

The QA resume due-time column migration must run before the separate
`qa_resume_due_index` migration. The latter uses `CREATE INDEX CONCURRENTLY`
and must run outside a transaction. CLI 2.115.0 executes that statement
separately from its transactional migration batches. Do not apply it through
a runner that wraps the SQL in a transaction.

If the concurrent build fails, inspect the index before retrying. An invalid
index can remain after a failure; remove that incomplete index with
`DROP INDEX CONCURRENTLY IF EXISTS public.idx_packaging_jobs_qa_resume_due`
outside a transaction, then rerun the pending index migration. Confirm
`pg_index.indisvalid` is true afterwards. The migration deliberately omits
`IF NOT EXISTS` so an incomplete index cannot silently count as success.

`supabase migration repair` changes history records; it does not execute SQL.
Mark a version as applied only after verifying that its complete schema changes
already exist. Do not delete history or mark missing schema as applied.

### Upgrading an installation created before the version correction

Back up the database and inspect `supabase migration list` before any write.
Existing `014` and `015` records do not prove that both formerly duplicated
files ran. Each record may belong to either file that shared its version, so
check all four migrations separately. Do not treat a recorded `014` or `015`
as proof of its schema:

* For `014`, compare the complete definitions in
  [`014_sccm_migration.sql`](../supabase/migrations/014_sccm_migration.sql):
  the `sccm_migrations`, `sccm_apps`, `sccm_winget_mappings`, and
  `sccm_migration_history` tables with their columns, foreign keys, and indexes,
  including the generated `fts` column and its GIN index, enabled row level
  security and the five policies, the seven `sccm` functions, and the four
  triggers. The global mapping seed rows are data, not schema; their absence
  alone does not establish a schema mismatch.
* For `015`, compare the `error_stage`, `error_category`, and `error_code`
  columns (TEXT), `error_details` (JSONB), their column comments, and the
  `idx_packaging_jobs_error_code` and `idx_packaging_jobs_error_category`
  partial indexes on the `packaging_jobs` table from `001_packaging_jobs.sql`
  with
  [`015_enhanced_error_handling.sql`](../supabase/migrations/015_enhanced_error_handling.sql).
  If `packaging_jobs` is missing, stop and reconcile the installation.
* For `0141`, if it is local only, compare `curated_apps.winget_last_update` and
  `idx_curated_apps_winget_last_update` with
  [`0141_winget_index_v2.sql`](../supabase/migrations/0141_winget_index_v2.sql).
* For `0151`, if it is local only, compare the complete definitions in
  [`0151_msp_batch_and_webhooks.sql`](../supabase/migrations/0151_msp_batch_and_webhooks.sql):
  the four `msp_batch_deployments`, `msp_batch_deployment_items`,
  `msp_webhook_configurations`, and `msp_webhook_deliveries` tables, their indexes,
  the `update_msp_webhook_updated_at` function,
  `trigger_update_msp_webhook_updated_at`, the four service role policies and
  enabled row level security, and the `msp_batch_deployment_stats` view.

If all changes for a local only version already match, reconcile only that
version's history, for example `supabase migration repair --status applied 0141`.
Use `0151` instead only after its own complete schema has been verified.
Preserve the original `014` and `015` records.

If all changes for a pending version are absent, inspect
`supabase db push --include-all --dry-run` and confirm every listed migration is
appropriate before running `supabase db push --include-all`. This allows missing
versions older than the latest recorded version to run in migration order.
If only some changes exist, definitions differ, or history is ambiguous, stop
and reconcile that installation before pushing. The `0151` trigger and policies
are not replay safe and can fail with SQLSTATE `42710` if executed again.

If a recorded `014` or `015` lacks its complete schema, stop and reconcile that
installation before pushing. `db push` will not run a version that is already
recorded, and `trigger_sccm_apps_stats_update` is not replay safe.

Recheck history and schema afterwards. These instructions provide an upgrade
decision path; they do not establish that a particular existing installation
has been repaired.

## Troubleshooting

- Confirm `000_user_profiles.sql` was applied before migrations that reference `user_profiles`.
- Confirm the project URL and keys belong to the same Supabase project.
- For `schema_migrations_pkey` / SQLSTATE `23505`, check duplicate version
  prefixes and the existing history. This error does not indicate missing API
  credentials.
- For an older installation, follow the schema and history checks above before
  applying the renamed migrations. File names alone do not prove applied schema.
