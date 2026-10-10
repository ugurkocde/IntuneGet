# Database Setup

IntuneGet uses Supabase PostgreSQL for application state, catalog data, and server-side Microsoft authentication data.

## Apply the migrations

Supabase CLI migrations use the version prefix before the first underscore as
their unique history identifier. A different filename suffix does not create a
different version. See the [Supabase migration history reference](https://supabase.com/docs/reference/cli/supabase-migration-repair).

This repository currently contains two `014_` migrations and two `015_`
migrations. As reported in [issue #449](https://github.com/ugurkocde/IntuneGet/issues/449),
`supabase db push` can fail with `schema_migrations_pkey` and SQLSTATE `23505`
when it records the second file with the same version. Sorting the complete
filenames does not resolve that history conflict.

Keep both files: they contain different schema changes. Do not skip a file,
rename historical migrations or delete migration history to get past the error.
An existing installation needs its applied schema and migration history checked
before choosing a compatible version transition. The instructions below do not
resolve the duplicate versions.

For migrations with unique versions and matching history, install the CLI using
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

`supabase migration repair` changes history records; it does not execute the
SQL in a missing migration. Marking a version as applied therefore does not
establish that both files sharing that version have run.

## Troubleshooting

- Confirm `000_user_profiles.sql` was applied before migrations that reference `user_profiles`.
- Confirm the project URL and keys belong to the same Supabase project.
- For `schema_migrations_pkey` / SQLSTATE `23505`, check duplicate version
  prefixes and the existing history. This error does not indicate missing API
  credentials.
- Preserve both `014_` files and both `015_` files while reconciling which schema
  changes actually ran. Migration version normalization remains tracked in
  issue #449; this guide does not claim that it is resolved.
