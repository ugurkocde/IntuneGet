# IntuneGet Curated Catalog pilot

The pilot is an IntuneGet-owned catalog sourced from publishers. It has independent `IntuneGet.Curated.*` identifiers, separate release approval, and a dashboard at `/dashboard/apps/curated`. It is distinct from the proposed tenant-private catalog. A definition's `wingetId` is a reference for humans; curated packaging and updates do not resolve it through Winget.

## First ten definitions

| Application | Selected installer | Discovery |
| --- | --- | --- |
| Google Chrome | Enterprise stable, x64 machine MSI | Google version history; mutable enterprise URL |
| Mozilla Firefox ESR | en-US x64 MSI | Mozilla release metadata and archive |
| Adobe Acrobat Reader | Continuous, x64 full installer EXE | Manual vendor release/source review |
| 7-Zip | x64 MSI | Publisher GitHub release |
| Notepad++ | x64 EXE | Publisher GitHub release |
| Visual Studio Code | Stable system x64 installer | Microsoft update API |
| Git for Windows | x64 EXE | Publisher GitHub release |
| VLC | Windows x64 EXE | VideoLAN release feed |
| WinSCP | Machine installer EXE | WinSCP update feed; official SourceForge distribution |
| PuTTY | Windows x64 MSI | Publisher download page; manual review if unavailable |

Definitions are in `lib/curated-catalog/definitions.json`. These are initial contracts for verification, not evidence that the installers work. In particular, review actual Authenticode publisher identities, payload architecture, unattended arguments, licensing, and redirected download destinations before approving each release. Change a definition through code review if the actual publisher differs; never label a mismatch as a valid signature.

All ten entries start **awaiting verification**, with deployment disabled. `catalog/curated/catalog.json` intentionally contains no approvals, signing key, fabricated scan, or VM result. The unit-test fixtures use synthetic evidence and must never become catalog records.

## Trust and deployment

The model follows the publicly documented [Patch My PC catalog validation approach](https://patchmypc.com/security-release/pmpc-application-catalog-security-validation/): publisher downloads, installer checksums, security checks, application testing, and a signed catalog. This is our implementation; it does not claim equivalent operational coverage.

An Ed25519 signature binds release records and the complete definitions digest. Each release must name a preparer and a different approver, bind source, security, and VM evidence to the measured installer hash, and bind the tested PSADT package to the shared execution profile and current packager commit. Evidence must be collected after discovery and within 14 days of approval. Catalog signatures have at most seven days of validity.

The server checks the signature and current package profile when serving deployable entries, receiving a cart item, dispatching hosted packaging, and handing a claimed job to the local packager. QA overrides and custom-source downgrades cannot enable a curated release. The packager's existing complete-payload hash verification still runs on the downloaded file. A withdrawn or expired release cannot be used for new deployment. This does not recall a job already handed to a worker or an application already installed.

Users can choose assignments, categories, enrollment profiles, and update preferences. Execution settings are fixed for the pilot. Update detection includes only approved curated versions, and update packaging regenerates the approved execution settings for the new version while retaining rollout choices. It never falls back to Winget. Vendor self-updaters remain enabled where disclosed in the definitions, so endpoint versions may advance independently of the catalog.

Evidence URLs and reviewer names are signed maintainer attestations. The application validates their structure and binding; it does not independently authenticate a report service or fetch reports. Protect the signing key and require review of the actual reports. Automated candidate VM execution and authenticated evidence ingestion are future integration work; the existing Winget QA queue does not accept unapproved curated candidates.

## Operator workflow

1. Run `npm run curated:validate` to validate definitions and the committed catalog. The empty bootstrap needs no keys.
2. Run `npm run curated:discover -- --output output/curated/discovery.json`. Discovery requests bounded text metadata only. It does not download, extract, install, approve, or queue installers. The daily GitHub workflow stores this report as a review artifact, including source errors. It has read-only repository permission and no signing or deployment credentials.
3. Select a candidate. Discovery reports wrap candidates in `results`; save the selected `candidate` object to its own JSON file. For Adobe, or an unavailable feed, use `node scripts/curated-catalog.mjs candidate --app APP_ID --version EXACT_VERSION --installer-url REVIEWED_HTTPS_URL --output output/curated/candidate.json`. Add `--sha256` only when the publisher provides that checksum. Always record the measured hash during isolated verification.
4. In an isolated Windows verification VM, review the source and redirect chain, download the original installer, measure SHA256, inspect the actual version and architecture, verify the Authenticode signature policy, and scan the exact file. Never download, extract, or run these installers on the physical QA host. For unsigned 7-Zip MSI, approval requires a written source/checksum exception; unsigned exceptions are blocked for other definitions. Chrome's mutable URL requires confirming the MSI's actual version against the candidate. Adobe must be a full installer, not an MSP. WinSCP requires checking the final SourceForge destination and x64 installed payload.
5. With the measured hash, request a test profile from the running pilot server. Set `CURATED_CATALOG_OPERATOR_TOKEN` on the server and operator process, then run `node scripts/curated-catalog.mjs profile --candidate output/curated/candidate.json --sha256 MEASURED_SHA256 --server https://YOUR_PILOT_SERVER --output output/curated/profile.json`. This authenticated endpoint creates test inputs only. It cannot approve or deploy a candidate. Local HTTP is allowed only for loopback development.
6. Use that exact profile and its pinned shared PSADT packager commit in an isolated Windows VM under LocalSystem. Test installation, detection after installation, upgrade from a recorded earlier version, detection after upgrade, uninstallation, and detection of removal. Use a clean baseline without implicit prerequisites or Winget dependency bundling. Archive the actual logs and security/source reports. A smoke test or installer exit code alone is insufficient. The profile's `packageProfileCanonicalJson` and `executionProfileSha256` bind the inputs; do not edit them after testing.
7. Assemble a release record matching `CuratedRelease` in `lib/curated-catalog/types.ts`. The release ID is `APP_ID:CANDIDATE_ID`. Copy actual measured values and report URLs; missing or failed evidence blocks approval. Have a separate reviewer inspect the reports and record `approvedBy` and `approvedAt`.
8. Supply the protected Ed25519 private PEM as `CURATED_CATALOG_SIGNING_KEY` only to the operator CLI. Supply `CURATED_CATALOG_PUBLIC_KEYS` as JSON mapping key IDs to public PEM strings on the server and in validation environments. Never use `NEXT_PUBLIC_` variables or commit private keys. Run `node scripts/curated-catalog.mjs approve --release output/curated/verified-release.json --key-id KEY_ID --output output/curated/signed-catalog.json`.
9. Review the signed artifact before replacing `catalog/curated/catalog.json` in a reviewed commit and deploying. The CLI writes a new file with exclusive creation; it never overwrites the committed catalog, writes the production database, pushes, or deploys. Run validation with the public trust configuration in CI. No schema migration is required.

Use `withdraw --release RELEASE_ID --key-id KEY_ID --output NEW_FILE` to sign a withdrawal for review. Withdrawn releases remain in history and are excluded from deployments and latest-version discovery; an older unwithdrawn release may remain available. Removal of an installed version requires a separate deployment action.

Use `sign --key-id KEY_ID --output NEW_FILE` to explicitly renew the catalog. It can verify an expired catalog at its final valid instant before producing a fresh signature; deployment verification always uses current time. Review renewed release availability and security evidence operationally. Changing definitions invalidates the old signature, and changing the shared packaging toolchain invalidates affected execution approvals. Reverify and produce a reviewed catalog rather than bypassing those checks. Do not rely on an unattended heartbeat to renew trust indefinitely.

## Verification and current limits

Run `npm test`, `npx tsc --noEmit`, `npm run lint`, and `npm run build:ci`. Tests exercise tampering, unknown keys, expiration, source spoofing, evidence/hash mismatches, failed lifecycle phases, unsigned exceptions, withdrawal, changed package inputs, local-worker validation, and operator endpoint access. They establish software behavior; they are not application installation evidence.

Initial live discovery produced candidates for eight feeds. Adobe remains manual. PuTTY's publisher page timed out in this development environment; keep it pending and retry or perform explicit publisher-source review. No installers have been approved by this change. The next operational milestone is ten genuine verification records, starting with a simple MSI, plus protected signing-key setup. Do not advertise ten deployable apps until those records exist.
