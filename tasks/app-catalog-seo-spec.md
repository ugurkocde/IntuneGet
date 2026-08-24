# App catalog SEO: per-app pages, category hubs, browse, segmented sitemaps

## Goal

Turn the public /apps marketing page into a real catalog surface with per-app detail pages built for the query space "deploy [app] to Microsoft Intune". Strategy: full catalog browsable for users, curated (verified) subset indexable for Google. Everything below is public and unauthenticated.

All catalog reads MUST go through the existing `CatalogSource` abstraction (`lib/catalog/index.ts`, `getCatalogSource()`, interface in `lib/catalog/types.ts`). Do not query Supabase directly from pages. Follow the existing marketing-page conventions in `app/(marketing)/apps/page.tsx`: `Header`/`Footer` components, gt-next `<T>`/`<Var>` for user-facing copy, Tailwind token classes (bg-bg-deepest, text-text-primary, accent-cyan etc.), `AppIcon` component.

HARD COPY RULE: never use em dashes or en dashes in any user-facing text. Restructure the sentence instead.

## 1. Per-app detail pages: `app/(marketing)/apps/[wingetId]/page.tsx`

Routing and rendering:
- Dynamic segment is the winget id (e.g. `Google.Chrome`). Winget ids contain dots; they are fine in a path segment. Decode with `decodeURIComponent`.
- `generateStaticParams`: prerender only the top ~100 apps (verified, ordered by `popularity_rank`) to keep builds fast. Set `export const dynamicParams = true` so every other app renders on demand, and `export const revalidate = 86400` (1 day ISR).
- Resolution logic:
  - Load via `source.getAppByWingetId(id)`.
  - If not found, try `source.appExistsCaseInsensitive(id)`; on a hit, `permanentRedirect` to the canonical-cased URL. Otherwise `notFound()` (real 404, no soft-200 shells).
  - If `app.is_locale_variant` is true and `parent_winget_id` is set, `permanentRedirect` to the parent's page. We do not want pages for translated/locale variants at all.
- Indexability gate: if `app.is_verified` is not true, add `robots: { index: false, follow: true }` to the page metadata. Verified apps are indexable; the long tail renders for users but stays out of the index.

Data to fetch (parallel, each with `.catch(() => null)` so one failure does not 500 the page):
- `getAppByWingetId(id)` for the app row, versions list, locale variants (ignore variants beyond the redirect above).
- `getQaResult(wingetId)` for the latest QA outcome.
- `getInstallationChangelog(wingetId)` for install behavior snapshot.
- `getVersionInstallerInfo(wingetId, latest_version)` for installer type, scope, silent args.
- Related apps: same `category`, verified, by popularity, excluding self, 6 items. Use `getPopularPackages(limit, category)` and filter, or the closest existing method. Do NOT add new RPCs or migrations; if a needed query does not exist on `CatalogSource`, add a method to the interface and implement it in `supabase-source.ts` AND `snapshot-source.ts` following the existing patterns exactly (both implementations, plus reasonable handling in tests if the existing test files cover the surface).

Page content, in order (all copy Intune-framed, not app-marketing-framed):
1. Breadcrumb (Home / App Catalog / {name}) + matching BreadcrumbList JSON-LD.
2. H1: "Deploy {name} to Microsoft Intune". Subline with publisher and category.
3. App card: AppIcon, description, publisher, homepage link (rel="noopener nofollow"), license, category, tags.
4. "Deployment details" section: latest version, installer type, install scope (machine/user), silent install arguments (code-styled), app source. Only render rows that have data.
5. QA section: if a QA result exists, show status (passed/failed), version tested, and when. Frame as "Tested by IntuneGet QA". If none, omit the section entirely (no empty placeholders).
6. Version history: up to 10 recent versions from the versions list. Omit if empty.
7. How-it-works blurb: 2-3 sentences on what happens when you deploy this app with IntuneGet (packaged as Win32, uploaded to your tenant, assignments configured). Keep generic but concrete.
8. CTA band: "Deploy {name} to your tenant" linking to /auth/signin, same styling as the existing CTA band on /apps.
9. Related apps grid: 6 cards linking to their detail pages, plus a link to the app's category hub and to /apps.

Metadata:
- Title: "Deploy {name} to Microsoft Intune - IntuneGet". Description: one sentence with app name, publisher, and that IntuneGet packages and uploads it to Intune automatically. Canonical: `https://intuneget.com/apps/{winget_id}` (exact stored casing).
- JSON-LD `SoftwareApplication`: name, publisher as Organization, softwareVersion (latest), operatingSystem "Windows", applicationCategory (map from category, fallback omit), license URL/text if present, image (icon URL if resolvable). Do NOT emit aggregateRating or offers.

## 2. Category hub pages: `app/(marketing)/apps/category/[slug]/page.tsx`

- Categories come from `source.getCategories()` (name + count). Slugify with a small helper (lowercase, spaces to hyphens); keep a slug-to-category resolver that works by slugifying each known category and matching (no hardcoded list). Unknown slug: `notFound()`.
- `generateStaticParams` from `getCategories()`, `revalidate = 86400`.
- Content: H1 "Deploy {Category} apps to Microsoft Intune", one short intro paragraph per category (write a generic but category-aware template sentence set; 2-3 sentences, no filler), grid of apps in the category (verified first, by popularity, server-rendered, cap at 60) with cards linking to detail pages, count line, CTA band.
- JSON-LD: `ItemList` of the listed app detail URLs + BreadcrumbList.
- Indexable, canonical `https://intuneget.com/apps/category/{slug}`.

## 3. Browse page (UX layer, not an SEO target): `app/(marketing)/apps/browse/page.tsx`

- Server-rendered paginated list of the whole catalog: 60 per page, `?page=N` searchParams, ordered by name. Use `getPopularApps({ limit, offset, sort: "name" })`.
- Locale variants must not appear. If the existing method returns them, add a filter (or extend the CatalogSource method with an option) so variants are excluded.
- Simple prev/next pagination plus a page indicator. Each card links to the detail page.
- Metadata: `robots: { index: false, follow: true }` on every browse page (deliberate: this layer is for users and crawl paths, not for ranking). Self-canonical.

## 4. Update `/apps` (`app/(marketing)/apps/page.tsx` and `CatalogSearch.tsx`)

- Popular-app cards become `<Link>` to their detail pages (keep exact visual style, add hover state consistent with site).
- Add a "Browse by category" section: chips/cards for each category (name + count) linking to hubs.
- Add a "Browse all apps" link to `/apps/browse`.
- `CatalogSearch` result cards become links to detail pages (client-side `<Link>`).

## 5. Sitemaps

- Convert app sitemap output to segmented sitemaps using Next's `generateSitemaps` in `app/sitemap.ts` (or split files if cleaner with the App Router API in this Next version; check `package.json` for the version and use the supported pattern):
  - Segment 0: existing static + docs + blog pages, PLUS the missing `/qa` page.
  - Segment 1 (apps-core): all VERIFIED, non-locale-variant app detail URLs. Add a `CatalogSource` method to list them (winget_id only, verified filter) implemented in both sources.
  - Segment 2 (apps-categories): category hub URLs.
- Browse pages stay out of all sitemaps.

## 6. robots.ts

- Add `Disallow: /api/winget/search` and `Disallow: /apps/browse` for all user agents (keep existing rules intact).

## Constraints and quality bar

- TypeScript strict, no `any` unless the surrounding file already does it.
- No new dependencies. No database migrations. No new RPCs.
- Both `SupabaseCatalogSource` and `SnapshotCatalogSource` must implement any interface additions; run the existing catalog tests.
- All user-facing strings wrapped in gt-next `<T>`/`<Var>` following the existing pages, and NO em/en dashes anywhere in copy.
- Handle the catalog source being unavailable gracefully on every new page (render a friendly fallback or 404, never a crash).
- Icons in grids: keep using `AppIcon` (it already handles sizing).
- Verify with: `npm run lint` and `npx tsc --noEmit` (or the repo's typecheck script; check package.json). Run `npm run build` if feasible; if the build needs env vars that are missing, note that instead of faking them.
- Commit your work in logical commits on the current branch (`feat/app-catalog-seo`). Do not push.

## Definition of done

- All six sections above implemented.
- Lint and typecheck clean.
- A short SUMMARY of what was built, decisions taken, and anything skipped, written to `tasks/app-catalog-seo-result.md`.
