# IntuneGet Curated Catalog pilot

The pilot is an IntuneGet-owned catalog sourced from publishers. It has independent `IntuneGet.Curated.*` identifiers, its own fully automated release pipeline, and a dashboard at `/dashboard/apps/curated`. It is distinct from the proposed tenant-private catalog. A definition's `wingetId` is a reference for humans; curated packaging and updates do not resolve it through Winget.

## Catalog definitions

| Application | Selected installer | Discovery |
| --- | --- | --- |
| Google Chrome | Enterprise stable, x64 machine MSI | Google version history; mutable enterprise URL |
| Mozilla Firefox ESR | en-US x64 MSI | Mozilla release metadata and archive; SHA256 pinned from the release `SHA256SUMS` |
| Adobe Acrobat Reader | Continuous, x64 full installer EXE | Adobe enterprise download service; the matching full en-US installer must exist (HEAD check, never an MSP patch) |
| 7-Zip | x64 MSI | Publisher GitHub release |
| Notepad++ | x64 EXE | Publisher GitHub release |
| Visual Studio Code | Stable system x64 installer | Microsoft update API |
| Git for Windows | x64 EXE | Publisher GitHub release |
| VLC | Windows x64 EXE | VideoLAN release feed; SHA256 pinned from the `.sha256` file beside the installer |
| WinSCP | x86 machine installer EXE (Program Files (x86)) | WinSCP update feed; official SourceForge distribution; SHA256 pinned from the release ReadMe on winscp.net |
| PuTTY | Windows x64 MSI | Publisher-linked versioned archive metadata; SHA256 pinned from the versioned `sha256sums` |
| Mozilla Firefox | Stable en-US x64 MSI | Separate stable release feed and versioned archive; publisher SHA256SUMS; earlier stable build for upgrade QA |
| Zoom Workplace | Windows x64 enterprise MSI | Publisher download service; versioned CDN path; initial reviewed older MSI baseline for upgrade QA |
| Audacity | Stable Windows x86_64 MSI | Publisher GitHub releases and asset SHA256; earlier MSI for upgrade QA |
| PowerShell LTS | Windows x64 MSI, 7.6 channel | Publisher GitHub releases filtered to stable 7.6 builds; earlier LTS MSI for upgrade QA |
| AWS CLI | Windows x64 MSI, v2 | Publisher GitHub v2 tags and versioned AWS MSI downloads; earlier v2 MSI for upgrade QA |

Definitions are in `lib/curated-catalog/definitions.json`. Every definition is a machine install; WinSCP is x86 because its stable release ships only a 32-bit setup, and all others are x64. Definitions are the reviewed contract: payload architecture, unattended arguments, licensing and allowed download hosts are fixed in code review, and the automation applies them identically to every release.

Trust rests on the SHA256 hash, not on Authenticode certificates (decided 2026-10-05). Signer names change whenever a publisher renews its certificate, and some publishers ship unsigned (7-Zip) or self-signed installers, so exact signer matching failed releases that were genuine. A release is bound to the publisher's own checksum where one exists (GitHub asset digests, SHA256SUMS, checksum files) and to the hash measured in the isolated VM otherwise; every deployment downloads the installer again and must match that exact hash. The observed Authenticode result (`valid`, `unsigned` or `untrusted`, with the signer name) is recorded in each release and shown in the catalog for transparency, but it is not a release gate. `signaturePublishers` in a definition documents the expected signer only.

An app is deployable only once a release has passed verification and been signed into `catalog/curated/catalog.json`. The unit-test fixtures use synthetic evidence and must never become catalog records.

The Audacity publisher's [Windows packaging source](https://github.com/audacity/audacity/blob/Audacity-4.0.1/buildscripts/packaging/Windows/SetupWindowsPackaging.cmake) appends a build number to the public three-part release version. Its reviewed installed identity compares three components, while the exact installer build remains pinned by SHA256 and must pass production detection and removal. All other definitions retain the default four-component installed-version comparison.

## Trust and deployment

The model follows the publicly documented [Patch My PC catalog validation approach](https://patchmypc.com/security-release/pmpc-application-catalog-security-validation/): publisher downloads, installer checksums, security checks, application testing, and a signed catalog. This is our implementation; it does not claim equivalent operational coverage.

An Ed25519 signature binds release records and the complete definitions digest. Each release names the verification workflow as preparer and the automation workflow as approver, binds source, security, and VM evidence to the measured installer hash, and binds the tested PSADT package to its exact execution profile and packager commit. Evidence must be collected after discovery and within 14 days of approval. Catalog signatures have at most seven days of validity.

Releases are hash pinned. A definition's optional `checksumSource` names a publisher checksum file (a URL template on the release metadata or installer host, an entry template, and a parser format); discovery fetches it as a second bounded text request and records the SHA256 for exactly the candidate installer file. VLC sets `installerRedirectPolicy: "any-https-mirror-with-pinned-sha256"`: VideoLAN hands downloads to third-party mirrors, so the isolated verifier accepts a redirect to any HTTPS host on the default port, provided the first URL is the approved VideoLAN source and the publisher SHA256 is pinned. Such definitions must have a checksum source, discovery fails without a pin, and candidates without `vendorSha256` are rejected. Production packagers already follow redirects and enforce the approved installer hash, so customers need no action.

Shared packager releases ship every few days. A release tested on an earlier packager commit stays deployable while its exact profile is unchanged and no intervening packager release (from `QA_PACKAGER_RELEASE_HISTORY`) changes behavior that profile exercises, the same rule ordinary QA uses. Otherwise only that app is withheld and the automation verifies it again.

The server checks the signature and package profile compatibility when serving deployable entries, receiving a cart item, dispatching hosted packaging, and handing a claimed job to the local packager. QA overrides and custom-source downgrades cannot enable a curated release. The packager's existing complete-payload hash verification still runs on the downloaded file. A withdrawn or expired release cannot be used for new deployment. This does not recall a job already handed to a worker or an application already installed.

Users can choose assignments, categories, enrollment profiles, update preferences and PSADT settings. Every curated app is packaged with the shared PSADT packager, and the VM verifies that exact PSADT package. Installer, unattended arguments, uninstall identity and detection always come from the signed release. Update detection includes only approved curated versions, and update packaging regenerates them for the new version while retaining the tenant's rollout and PSADT choices.

### Custom PSADT execution settings

PSADT presentation settings (branding, dialog and prompt text, balloon text, process descriptions) never change how the package executes and need no verification. Execution settings (which processes to close, deferrals, deploy mode, restart behaviour, whether prompts appear) do. The signed default is verified with each release. When requested execution settings have not passed QA, deployment uses those tested defaults and queues the requested configuration for verification:

1. A new configuration queues a request in `curated_config_verifications`, keyed by release and the execution configuration hash (`psadtConfigSha256`). The cart shows that tested defaults will be used, and deployment can continue immediately with those defaults.
2. The automation dispatches the verification workflow with the `psadt_config` input, using one of its two VM slots ahead of new releases. The run tests the same lifecycle as the release, including the upgrade where an earlier release exists.
3. A pass for exactly that release and configuration is recorded and the configuration may deploy, including through hosted packaging, the local packager, MSP batches and auto-updates. Like releases, a pass stays valid across compatible packager releases and is verified again otherwise. A failure in the package lifecycle is final for that configuration (`CURATED_CONFIG_VERIFICATION_FAILED`, with the reason); failures before the lifecycle (Defender, download) are retried.
4. When a new release is approved, every passed configuration of the app is queued for it automatically. A tenant's auto-update uses the tested defaults while the requested settings are verified for the new release.

Self-hosted installations cannot reach the hosted QA service and deploy curated apps with the verified default execution settings only. It never falls back to Winget. Vendor self-updaters remain enabled where disclosed in the definitions, so endpoint versions may advance independently of the catalog.

The protected `Curated catalog verification` workflow in the QA repository produces bounded evidence from the isolated VM. Approval authenticates the workflow run, attempt, protected source history, artifact ID and GitHub artifact checksum. It checks the tested execution profile against the current website code and requires every tested exact installer hash, the observed signature (recorded, not gated), clean Defender evidence, every lifecycle phase and successful VM restoration. The evidence is then bound into the signed catalog and published under `catalog/curated/evidence/`. Public deployment verifies this signature; it does not fetch the private QA service.

The signing key exists only in the public website repository's `curated-catalog-approval` environment. That environment permits protected branches only, so only workflows on `main` can sign. Approval is automated: the policy checks above replace a human reviewer, and no workflow input can add an exception. The committed `catalog/curated/trusted-keys.json` holds public keys only. Optional `CURATED_CATALOG_PUBLIC_KEYS` adds deployment trust keys. The key never enters the application server, browser, physical QA host or verification VM.

## Licence attestations

Some publishers allow redistribution only after the deploying organization accepts their terms. A definition declares this with `licenceAttestation: { id, title, url, version }`. The `id` names the agreement and may be shared by several applications, which must then declare identical values. The `url` must be the publisher's official HTTPS page for the agreement. `validateDefinitions` enforces these rules, and the definitions digest binds the requirement into the signed catalog.

Adobe Acrobat Reader requires the Adobe Acrobat Reader Distribution License Agreement (`adobe-acrobat-reader-distribution`). The URL is Adobe's distribution application form at `https://get.adobe.com/reader/licenseform`, which the "Apply now" link on Adobe's volume distribution page resolves to. No other pilot definition declares an agreement.

The curated catalog page shows the agreement title and link. A user who can deploy to the tenant must explicitly confirm acceptance before the application can be added to the cart. `POST /api/curated-catalog/attestations` records the acceptance for the caller's resolved tenant, including MSP customer tenants selected with `X-MSP-Tenant-Id`. Accepting for a managed customer tenant requires an MSP role with the deploy permission. `GET` on the same route reports the current status. Only the current agreement version can be accepted.

Acceptances are stored in `curated_licence_attestations`, unique per tenant, agreement, and version. The first acceptance of a version is kept as the audit record, with the accepting user and time. The browser cart is untrusted. The server checks the stored acceptance for the target tenant at every packaging boundary:

- `POST /api/package` rejects the item with `409 CURATED_LICENCE_NOT_ACCEPTED` before any job exists, and stores the verified acceptance in the job's `package_config.curatedLicenceAcceptance`. A value supplied by the cart is discarded.
- `triggerPackagingWorkflow` refuses every hosted dispatch: cart deployments, QA resume, manual and automatic updates, and MSP batches.
- The local packager claim fails the job with `CURATED_LICENCE_NOT_ACCEPTED` instead of handing it to the worker.
- Hosted and self-hosted automatic updates skip the update with that code and a readable reason, without creating a job or counting a policy failure. Manual update requests return the reason to the user. MSP batches skip the tenant item.

An acceptance never covers another tenant. Changing the `version` in a definition requires every tenant to accept again before new jobs run; existing acceptances of the earlier version remain as history. Apps without `licenceAttestation` are unaffected. Apply the `curated_licence_attestations` Supabase migration before deploying code that reads it. Self-hosted SQLite databases receive the table through migration 4.

## Automation

The `Curated catalog automation` workflow runs every 30 minutes (`7,37 * * * *`) and needs no manual step. Each run:

1. **Discovers** every app's current publisher release (`lib/curated-catalog/discovery.mjs`). Discovery reads bounded text metadata and publisher checksum files only, plus HEAD requests for constructed Adobe, Zoom and AWS installer URLs. It never downloads an installer on the runner.
2. **Dispatches verification** for releases newer than the approved one: the private `Curated catalog verification` workflow, labeled `App Version Arch [candidateId]`. At most two curated runs are queued at a time so ordinary QA keeps its share of the VM. The upgrade test uses the last approved release, or before the first approval the newest earlier official release (GitHub releases, the PuTTY archive). Vendor-managed apps without an immutable earlier installer (Chrome's mutable URL, first runs of Firefox ESR, VS Code, VLC, WinSCP and Adobe) run without an upgrade test under the exemption below.
3. **Approves** each passing run whose authenticated evidence satisfies the release policy, then the `publish` job re-authenticates the evidence, signs the catalog with the environment key, writes the public evidence files and pushes branch `automation/curated-catalog`. The PR squash-merges automatically once the required checks pass, and the merge deploys.
4. **Renews** the signature when it is within three days of expiry, and re-signs after a definitions change. Releases that no longer satisfy the current definitions or packaging profile are dropped and verified again.
5. **Retries** failed runs at most twice per verifier revision, two hours apart. A merged verifier fix therefore retries automatically. When an earlier installer fails to download or inspect for a vendor-managed app, the retry runs without the upgrade test.

Every completed verification run, release or custom configuration, pass or fail, is stored in the `curated_qa_runs` Supabase table: install and uninstall commands, silent arguments, detection rules, PSADT configuration, phase results, observed signature, Defender result and, for failures, the failed step, redacted message and PSADT error entries. Unlike `qa_results`, which keeps the latest result per Winget package, it keeps one row per run attempt, so the history outlives GitHub's 90-day artifact retention.

Problems the automation cannot resolve (repeated verification failures, a publisher replacing an approved installer, a publication PR that has not merged after three hours, a catalog close to expiry) are listed in the `Curated catalog automation needs attention` issue in the private QA repository. The issue updates on every run and closes itself once the alerts clear. The run summary shows each app's publisher release, approved version and state.

For an emergency withdrawal, run the workflow manually with `withdraw_release_id` and a `withdraw_reason`. Withdrawn releases remain in history and are excluded from deployments and latest-version discovery; an older unwithdrawn release may remain available. Removal of an installed version requires a separate deployment action. A withdrawn version is not verified again; the next publisher release is.

Run locally with `CURATED_DRY_RUN=true node scripts/curated-automation.mjs plan` after `node scripts/build-curated-runtime.mjs` to see the plan without dispatching anything. `npm run curated:validate` and `npm run curated:discover -- --output output/curated/discovery.json` remain available.

### Upgrade test exemption

Apps whose own updater handles upgrades (`autoUpdate: "vendor-managed"` in the definition) may be qualified without an upgrade from an earlier build when no older immutable official build is available. Google, for example, publishes no historical Chrome enterprise MSI. All other apps (`autoUpdate: "none"`: 7-Zip, Git for Windows and PuTTY) always require a genuine earlier release.

The skip is never silent:

- QA accepts an empty `previous` only for a vendor-managed definition and refuses before using the VM otherwise. The report then has `previous: null`, no previous inspection, and `qa.upgrade: { tested: false }` with only the install, detection, uninstall and removal phases.
- Approval records the automation's fixed policy reason in the public evidence and signs it into the release as `evidence.qa.upgrade: { tested: false, reason }`.
- `validateRelease` rejects a skipped upgrade for a non-vendor-managed app, without a reason, or carrying any upgrade evidence (`upgradeFromVersion`, `previousInstallerSha256`, `upgrade` or `detectionAfterUpgrade` phases).
- When `previous` is supplied, the upgrade always runs and must pass, even for a vendor-managed app.

Releases without `qa.upgrade` keep the original shape and still require `upgradeFromVersion` and both upgrade phases.

The authenticated operator profile endpoint remains available for diagnostics. `node scripts/build-curated-runtime.mjs` produces the same test profile builder as a standalone source-only module for QA, avoiding a dependency on a live website or its secrets.

## Verification and current limits

Run `npm test`, `npx tsc --noEmit`, `npm run lint`, and `npm run build:ci`. Tests exercise tampering, unknown keys, expiration, re-signing, source spoofing, evidence/hash mismatches, failed lifecycle phases, unsigned exceptions, packager compatibility, withdrawal, changed package inputs, local-worker validation, and operator endpoint access. They establish software behavior; they are not application installation evidence. Only a passing VM verification run can qualify a release.

WinSCP downloads from SourceForge, which rate limits GitHub-hosted runners; hosted packaging of WinSCP can therefore fail even after it qualifies. PuTTY discovery uses the publisher-linked official archive directory, avoiding its unavailable primary HTML page, and allows only the exact redirect from `latest/w64/` to a numeric version directory on the same publisher host.
