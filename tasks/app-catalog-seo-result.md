# App catalog SEO result

## Summary

Implemented all six feature sections:

- Added canonical per-app deployment pages with ISR, top-100 static generation, case and locale redirects, verified-only indexing, deployment and QA data, version history, related apps, metadata, and JSON-LD.
- Added category hubs generated from catalog categories, plus a noindex paginated browse layer for the full non-locale catalog.
- Updated `/apps` and public search results with detail links, category navigation, full-catalog browsing, and shared catalog cards and calls to action.
- Added catalog-source support for full-catalog browsing and paginated verified ID listing in both Supabase and snapshot implementations, with snapshot coverage.
- Split the sitemap into static, verified app, and category segments, added `/qa`, and excluded browse and search surfaces through robots rules.

## Decisions

- Existing `getPopularApps` callers remain verified-only by default. The browse page opts into unverified rows with `verifiedOnly: false`.
- Verified sitemap IDs are fetched in batches so Supabase's per-request row cap cannot truncate the sitemap.
- Detail lookup is request-cached so metadata and page rendering reuse the same catalog resolution.
- Missing catalog data resolves to a real 404 for dynamic detail and category routes, while list surfaces render a friendly unavailable state.

## Verification

- `npm run lint`: passed.
- Production TypeScript check with repository test files excluded: passed (`npx tsc --noEmit -p tsconfig.feature-check.json`; the temporary config was removed afterward).
- Full `npx tsc --noEmit`: feature code is clean, but the repository currently fails on pre-existing test-global and unrelated fixture type errors, including missing `vi` and `describe` globals.
- Catalog Vitest: could not start because the sandbox denied Vite's child-process spawn with `EPERM`.
- `npm run build:ci`: reached the production compile, then failed because the optional native `better-sqlite3` package could not be installed in this sandbox.
- `git diff --check`: passed.
- User-facing app catalog copy contains no em dash or en dash characters.

## Skipped or blocked

- No feature section was skipped.
- Logical commits could not be created because this linked worktree stores its Git index under the parent repository outside the writable workspace. Git failed to create `index.lock` with `Permission denied`. No push was attempted.
