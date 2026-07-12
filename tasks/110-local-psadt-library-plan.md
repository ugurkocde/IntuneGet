# Plan — #110 Local PSADT package library as a catalog source

> DECISION (2026-06-13): NOT PLANNED. Issue #110 closed. The feature only works
> for the local-packager segment (the hosted pipeline can't reach on-prem file
> shares), so hosted web-app users can't use it. Kept as a record of the analysis;
> not active work.

Surface and deploy a customer's existing PSADT-packaged apps through IntuneGet (self-hosted / local-packager only) instead of repackaging them.

## Core constraints (drive every decision)
- **Self-hosted only.** The packages live on a customer Windows machine; the hosted pipeline (Vercel / GitHub Actions) cannot read customer file shares. Discovery and deploy both happen on the local packager.
- **Machine-bound.** A discovered folder exists on exactly one machine = one packager instance. A deploy of that package MUST be routed back to the packager that discovered it. This requires a stable packager identity, which does not exist today (packager_id is regenerated every process start).
- **Deploy as-is.** The customer's PSADT folder already has its own deploy script. We must NOT regenerate it — we run `IntuneWinAppUtil` over the folder unchanged and upload through the existing Graph path.
- **Two packager transports.** Everything new must work in both Supabase-direct mode and API mode (`/api/packager/*`).

## What already exists (no rework needed)
- `sourceType` axis on `CartItem` (`types/upload.ts:134`) — extend with `'local'`.
- The win32 packaging pipeline, `IntuneWinAppUtil` invocation over a `Package/` dir (`packager/src/job-processor.ts`), Graph upload (`intune-uploader.ts`), and `package_config` JSONB carrying the full cart item.
- Registry-marker detection (`lib/detection-rules.ts`, `lib/registry-marker.ts`).
- The "Custom app" precedent (`lib/custom-app.ts`, `CustomAppModal.tsx`, the amber badge) — the Local source mirrors its shape.

---

## Phases

### Phase 0 — Packager identity & registry (prerequisite, currently missing)
The web app must be able to list a tenant's packagers and target one for a deploy.
- New `packagers` table: `id` (stable, persisted on the packager host), `tenant_ids` (which tenants it serves), `hostname`, `label`, `last_seen_at`, `version`, `capabilities` (e.g. `library_scan`).
- Packager persists its identity (write a generated id to `config.paths.work/packager-id` if `PACKAGER_ID` env unset) instead of regenerating per start (`packager/src/config.ts:61`).
- Packager registers + heartbeats presence: new `POST /api/packager/register` (API mode) or upsert into `packagers` (Supabase mode), on startup and on each poll.
- **Acceptance:** the web app can list packagers for the current tenant with a fresh `last_seen_at`.

### Phase 1 — Library discovery on the packager
- New `LIBRARY_FOLDERS` env (`;`-separated) → `config.libraryFolders: string[]` (`packager/src/config.ts`).
- New `packager/src/library-scanner.ts`:
  - Walk each library folder for subdirs containing `Invoke-AppDeployToolkit.ps1` (PSADT v4) or `Deploy-Application.ps1` (PSADT v3).
  - Parse app variables: v4 `$adtSession` `AppVendor/AppName/AppVersion/AppArch`; v3 `$appVendor/$appName/$appVersion`.
  - Detect toolkit version + the setup-file entry point present (`Invoke-AppDeployToolkit.exe` vs `Deploy-Application.exe`).
  - Read optional sidecar `intuneget.yaml` next to the deploy script (see schema below).
  - Compute a stable per-package id: `Local.<slug(vendor)>.<slug(name)>` (+ folder hash to disambiguate duplicates).
- New scan loop in `packager/src/index.ts` (separate from the job poll; on startup + every N minutes).
- Reporting: new `LibraryReporter` — Supabase mode upserts into `library_packages`; API mode `POST /api/packager/library`. Reconcile: mark packages no longer found as removed (folder deleted/moved).
- **Acceptance:** pointing `LIBRARY_FOLDERS` at a folder of PSADT packages results in `library_packages` rows (vendor/name/version/path/toolkit version/sidecar metadata/packager_id), and removing a folder clears its row on the next scan.

### Phase 2 — Surface in the catalog under a "Local" source
- New `library_packages` table (tenant + packager scoped): `id`, `tenant_id`, `packager_id`, `local_id` (`Local.<vendor>.<name>`), `display_name`, `publisher`, `version`, `architecture`, `install_scope`, `folder_path`, `toolkit_version` (`v3`|`v4`), `setup_file`, `sidecar` (JSONB: detection rules, icon, description, command overrides), `discovered_at`, `last_seen_at`, `removed_at`.
- New read endpoint `GET /api/library/packages?tenant_id=` → maps rows to a `NormalizedPackage`-shaped object with `appSource:'win32'` + a `sourceSubtype:'local'` marker and the folder/packager refs.
- Catalog UI (`app/dashboard/apps/page.tsx`): add a **Source filter** (the panel has none today — `renderFilterPanel` only has Sort/Categories). When "Local" is selected, fetch from `/api/library/packages` instead of the winget catalog; render cards via the existing card components with a "Local" badge (mirror the store badge in `AppCard.tsx:147`). Show which packager/host each came from.
- **Acceptance:** discovered packages appear as catalog cards under a Local filter, badged, attributed to their host; winget/store browsing is unchanged.

### Phase 3 — Configure & deploy as-is
- Selecting a Local card opens `PackageConfig` with the full config surface (assignments, categories, ESP, relationships) — version/architecture/installer selectors are read-only (fixed by the folder).
- Detection pre-filled from the sidecar; if absent, apply the chosen default (see Open Decision 1).
- `buildLocalAppCartItem` (`lib/local-app.ts`, mirrors `custom-app.ts`): `appSource:'win32'`, `sourceType:'local'`, `localId`, `folderPath`, `targetPackagerId`, no `installerUrl`.
- `types/upload.ts`: add `'local'` to `sourceType`; add `folderPath?` / `targetPackagerId?` to `Win32CartItem`.
- Pipeline (`app/api/package/route.ts`): for `sourceType:'local'` items, create the job WITHOUT an installer URL, set `package_config.sourceType='local'`, `package_config.folderPath`, and **pin `target_packager_id`** (new `packaging_jobs` column); never dispatch to GitHub Actions (force the local-packager path).
- Packager job routing: the poll/claim must let a packager claim jobs where `target_packager_id` is null (normal) OR equals its own id (`packager/src/job-poller.ts:228` query + claim). A pinned job is only ever claimed by its packager.
- Packager `processJob` branch (`job-processor.ts:44`): when `sourceType==='local'`, **skip** `downloadInstaller` + `verifyChecksum` + `createPsadtPackage`; pass the existing `folderPath` straight to `createIntunewinPackage` with a version-aware `-s` setup file (v4 `Invoke-AppDeployToolkit.exe`, v3 `Deploy-Application.exe`); set the matching install/uninstall command lines in `intune-uploader.ts`.
- **Acceptance:** deploying a Local package produces an `.intunewin` of the original folder, uploads to Intune with the configured assignments/categories/detection, records `upload_history` with `app_source='local'`, and the job ran only on the discovering packager.

### Phase 4 — Polish
- Sidecar schema + docs page; validation + clear errors when a sidecar is malformed.
- "Local" badge in cart (`UploadCart.tsx:303`) and uploads history.
- Settings UI to view configured library folders + discovered counts per packager (read-only mirror of the packager's `LIBRARY_FOLDERS`; the folders themselves are set on the host).
- Update detection skips Local apps (no winget version source) — same exclusion the custom apps already get.

---

## Sidecar `intuneget.yaml` (next to the deploy script)
```yaml
detection:            # optional; else Open Decision 1 default applies
  - type: file|registry|msi|script
    ...               # same shape generateDetectionRules emits
icon: ./icon.png      # optional, relative to the package folder
description: ...
architecture: x64|x86|arm64
installScope: machine|user
installCommand: ...   # optional override of the Intune command line
uninstallCommand: ...
```

## New data model (Supabase migrations)
- `packagers` (Phase 0)
- `library_packages` (Phase 2)
- `packaging_jobs.target_packager_id TEXT` (Phase 3)
- `upload_history.app_source` already exists; write `'local'` for local deploys.

## New API contracts
- `POST /api/packager/register` (+ Supabase upsert path) — Phase 0
- `POST /api/packager/library` (+ Supabase upsert path) — Phase 1
- `GET /api/library/packages` — Phase 2
- Extend `GET /api/packager/jobs` claim to honor `target_packager_id` — Phase 3

---

## Open decisions (need answers before/at implementation)
1. **Detection default for as-is packages (most important).** The issue suggests "default to the IntuneGet registry marker," but an as-is customer script does NOT write that marker, so marker-based detection would always fail. Options: (a) require sidecar-provided detection for packages with no sidecar (block deploy until provided); (b) default to a generic ARP/file-existence rule derived from vendor/name/version; (c) have the packager inject a tiny registry-marker write into a COPY of the folder at package time (mild deviation from pure "as-is" but makes marker detection real). Recommend (b) as default + allow sidecar override; consider (c) as an opt-in.
2. **Discovery transport priority.** Build Supabase-direct first (the default mode), API-mode endpoints second? Both are needed eventually.
3. **Packager identity persistence.** Persist a generated id on the host (recommended) vs require admins to set `PACKAGER_ID`. Affects Phase 0.
4. **Multi-tenant packager.** A packager may serve multiple tenants (MSP). Which tenant owns a discovered library row — all tenants the packager serves, or a configured default? Recommend a configured `LIBRARY_TENANT_ID` (or the packager's primary tenant) to avoid leaking one customer's library across tenants.
5. **Catalog vs dedicated page.** Wedge Local into the winget catalog (issue's wording) vs a dedicated "Local Library" page. Recommend the source filter as asked, but a dedicated page is cleaner given local packages have no version history/winget id.
6. **Re-scan cadence + trust.** Scan interval, and whether to surface parse failures (a folder that looks like PSADT but variables can't be parsed) to the admin.

## Risks
- Packager identity/registry (Phase 0) is a foundational addition the current architecture lacks; underestimating it stalls everything downstream.
- Routing a deploy to a specific offline/old packager — need clear UX when the target packager hasn't checked in.
- PSADT v3 vs v4 entry-point and variable-parsing differences are brittle (regex over PowerShell); needs real-world sample coverage.
- Depends on the source-filter UI that #109 was supposed to introduce but did not (custom apps bypass the catalog) — so the Source filter is net-new work here.

## Acceptance criteria (feature-level)
- A self-hosted admin can configure library folders, have their PSADT packages discovered, see them in the catalog under a Local source filter (badged, attributed to host).
- Selecting one and deploying packages the existing folder as-is, routed only to the discovering packager, and uploads to Intune with the full config surface and a working detection rule.
- Removing/moving a folder removes it from the catalog on the next scan.
- Winget/store/custom flows and the hosted pipeline are unaffected; Local apps are excluded from update detection.
