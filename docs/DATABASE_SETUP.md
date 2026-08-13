# Database Setup

IntuneGet uses Supabase PostgreSQL for application state, catalog data, and server-side Microsoft authentication data.

## Apply the migrations

The supported setup path is the Supabase CLI. It applies the files in `supabase/migrations/` in filename order and records migration history.

```bash
npm install -g supabase
supabase login
supabase link --project-ref your-project-ref
supabase db push
```

Always start with `000_user_profiles.sql`. This migration creates the profile table required for authentication and token persistence.

If you must use the Supabase SQL Editor, run every file in `supabase/migrations/` in exact lexicographic filename order. The directory contains duplicate numeric prefixes, including two `014_` files and two `015_` files. The complete filename, not just its numeric prefix, determines the order. Do not rename existing migrations because their filenames are part of Supabase migration history.

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

After pulling a newer release, run `supabase db push` again to apply migrations that are not yet in the linked database's migration history.

## Troubleshooting

- Confirm `000_user_profiles.sql` was applied before migrations that reference `user_profiles`.
- Confirm the project URL and keys belong to the same Supabase project.
- For manual execution, check that no migration filename was skipped and that files were run in lexicographic order.
