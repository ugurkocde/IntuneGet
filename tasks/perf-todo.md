# Website performance improvement

## Findings (baseline)

- Production landing page: TTFB ~0.8-1.0s, `x-vercel-cache: MISS`, `cache-control: no-store` on every hit.
- `next build`: every route is dynamic (f). Root cause: root layout awaits `getLocale()` (gt-next cookie-mode locale) which opts the whole tree out of static/ISR. `revalidate = 300` on the landing page is inert.
- gt-next only supports SSG via path-based [locale] routing, which this repo deliberately avoids (cookie-only mode, issue #136). Not changing that unilaterally.
- Every page ships the full app provider stack: MSAL (@azure/msal-browser), react-query, UserSettingsProvider, MspProvider. Landing Header + LandingCatalogSearch pull MSAL via useMicrosoftAuth only for an isAuthenticated boolean and avatar.
- getPublicLandingStats() queries Supabase + catalog stats on every request (page is dynamic, so per visitor).
- Largest client chunks: ~400KB, ~376KB, ~359KB.

## Plan

- [x] 1. Cache landing stats server-side: wrap getPublicLandingStats in unstable_cache (revalidate 30; /api/stats/public is polled every 8-20s by live counters, so 300 would make them stale) so per-request renders stop hitting Supabase/catalog.
- [x] 2. hooks/useAuthHint.ts: client hook reading the existing msal-auth-hint cookie (no MSAL).
- [x] 3. LandingCatalogSearch: replace useMicrosoftAuth with useAuthHint.
- [x] 4. Header: replace useMicrosoftAuth with useAuthHint; move avatar + profile-image fetch into a lazily imported component that mounts its own MicrosoftAuthProvider (signed-in users only download MSAL on demand).
- [x] 5. ThemeProvider.tsx: share one ThemeContext; add PublicThemeProvider (localStorage-only, key intuneget-theme) for pages without UserSettingsProvider.
- [x] 6. Route groups: app/(marketing)/(about, blog, changelog, docs, pricing, privacy, security, terms, page.tsx) with lean tree; app/(app)/(apps, auth, dashboard, msp, onboarding, redirect) keeps QueryProvider > MicrosoftAuthProvider > UserSettingsProvider > ThemeProvider > MspProvider. Root layout keeps fonts, head scripts, GTProvider, PublicThemeProvider, PlausibleLoader, CookieConsentBanner, Toaster, skip link.
- [x] 7. Rebuild and compare landing First Load JS + chunk composition; smoke-test landing, docs, error page, signin, dashboard redirect, theme toggle in browser.
- [x] 8. Separate code-review agent on the diff; fix findings.

## Acceptance criteria

- Landing page no longer loads @azure/msal-browser, @tanstack/react-query, or user-settings/MSP provider code for anonymous visitors (verify via build chunk analysis).
- Signed-in UX on landing unchanged: avatar with profile image still appears (lazy chunk), Dashboard button still shows.
- Dashboard, sign-in, onboarding, redirect flows unchanged (providers intact in (app) group).
- Theme toggle works on landing/docs (localStorage) and still syncs to account inside the app.
- All routes still build; no route URL changes (groups only).
- Landing stats still SSR'd and live-updating; Supabase/catalog queried at most once per 5 min per instance, not per request.

## Review

- Landing page initial JS: 1602 KB -> 1308 KB uncompressed (-18%); /apps similarly lean (1185 KB). Neither loads @azure/msal-browser or react-query anymore (verified by chunk content scan: only the msal-auth-hint cookie name string remains).
- MSAL now loads lazily on marketing pages only when the msal-auth-hint cookie is set (AuthedAvatar via next/dynamic). Verified in browser: chunks arrive on demand; a stale hint cookie is cleared by MicrosoftAuthProvider, which notifies useAuthHint so the header falls back to Get Started without showing a bogus avatar.
- Code review agent found 3 issues, all fixed: /apps (public, no-sign-in page) initially placed in (app) group; PublicThemeProvider state went stale after theme changes inside the app surface (fixed with intuneget:theme-change event dispatched from applyThemeClass); stale auth hint could show a "U" avatar indefinitely (fixed by gating AvatarInner on real isAuthenticated + auth-hint change event).
- Verified in browser against the production build: landing renders with SSR stats, theme toggle persists to localStorage and re-syncs via the change event, 404 page renders outside providers, /dashboard redirects to signin, all public routes return 200.
- Not done (product decision, would unlock CDN caching): gt-next only supports static rendering with path-based [locale] routing; the site stays dynamically rendered per request (TTFB ~0.8-1.0s at the edge) as long as cookie-only locale mode is kept.
