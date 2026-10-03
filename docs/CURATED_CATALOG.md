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
| PuTTY | Windows x64 MSI | Publisher-linked versioned archive metadata |

Definitions are in `lib/curated-catalog/definitions.json`. These are initial contracts for verification, not evidence that the installers work. In particular, review actual Authenticode publisher identities, payload architecture, unattended arguments, licensing, and redirected download destinations before approving each release. Change a definition through code review if the actual publisher differs; never label a mismatch as a valid signature.

All ten entries start **awaiting verification**, with deployment disabled. `catalog/curated/catalog.json` intentionally contains no approvals, signing key, fabricated scan, or VM result. The unit-test fixtures use synthetic evidence and must never become catalog records.

## Trust and deployment

The model follows the publicly documented [Patch My PC catalog validation approach](https://patchmypc.com/security-release/pmpc-application-catalog-security-validation/): publisher downloads, installer checksums, security checks, application testing, and a signed catalog. This is our implementation; it does not claim equivalent operational coverage.

An Ed25519 signature binds release records and the complete definitions digest. Each release must name a preparer and a different approver, bind source, security, and VM evidence to the measured installer hash, and bind the tested PSADT package to the shared execution profile and current packager commit. Evidence must be collected after discovery and within 14 days of approval. Catalog signatures have at most seven days of validity.

The server checks the signature and current package profile when serving deployable entries, receiving a cart item, dispatching hosted packaging, and handing a claimed job to the local packager. QA overrides and custom-source downgrades cannot enable a curated release. The packager's existing complete-payload hash verification still runs on the downloaded file. A withdrawn or expired release cannot be used for new deployment. This does not recall a job already handed to a worker or an application already installed.

Users can choose assignments, categories, enrollment profiles, and update preferences. Execution settings are fixed for the pilot. Update detection includes only approved curated versions, and update packaging regenerates the approved execution settings for the new version while retaining rollout choices. It never falls back to Winget. Vendor self-updaters remain enabled where disclosed in the definitions, so endpoint versions may advance independently of the catalog.

The protected `Curated catalog verification` workflow in the QA repository produces bounded evidence from the isolated VM. Approval authenticates the workflow run, attempt, protected source history, artifact ID and GitHub artifact checksum. It recomputes the execution profile using the current website code and requires both exact installer hashes, clean security evidence, every lifecycle phase and successful VM restoration. Evidence and reviewer names are then bound into the signed catalog. Public deployment verifies this signature; it does not fetch the private QA service.

The signing key exists only in the public website repository's `curated-catalog-approval` environment. That environment requires a maintainer review, disables administrator bypass and permits protected branches only. The signer verifies GitHub's actual required-reviewer history; a workflow input cannot supply an approver name. The committed `catalog/curated/trusted-keys.json` holds public keys only. Optional `CURATED_CATALOG_PUBLIC_KEYS` adds deployment trust keys. The key never enters the application server, browser, physical QA host or verification VM.

## Operator workflow

1. Run `npm run curated:validate` to validate definitions and the committed catalog. The empty bootstrap needs no keys.
2. Run `npm run curated:discover -- --output output/curated/discovery.json`. Discovery requests bounded text metadata only. It does not download, extract, install, approve, or queue installers. The daily GitHub workflow stores this report as a review artifact, including source errors. It has read-only repository permission and no signing or deployment credentials.
3. Select a candidate. Discovery reports wrap candidates in `results`; save the selected `candidate` object to its own JSON file. For Adobe, or an unavailable feed, use `node scripts/curated-catalog.mjs candidate --app APP_ID --version EXACT_VERSION --installer-url REVIEWED_HTTPS_URL --output output/curated/candidate.json`. Add `--sha256` only when the publisher provides that checksum. Always record the measured hash during isolated verification.
4. Select a genuine earlier version from the same official publisher and record its candidate metadata separately. A mutable latest URL cannot substitute for a historical installer. Chrome therefore needs an available official older enterprise installer for first qualification. Adobe requires a full installer and distribution-rights review; an MSP alone is insufficient.
5. Dispatch `Curated catalog verification` on the private QA repository's `main`, supplying `app_label`, `candidate` and `previous` JSON. The workflow shares the single-test concurrency group and host mutex with ordinary QA. It restores the golden VM before and after the test. All vendor downloads, template extraction, installer security checks, package builds, installation and removal happen in the guest under LocalSystem. No tenant credentials enter the VM. The exact shared production packager and PSADT template pins must match.
6. Inspect the `curated-verification-evidence` artifact. Both vendor installers must pass Authenticode policy and a completed Defender scan with current signatures. The clean install and genuine upgrade must each match installed registry identity, version, x64 executable architecture and production detection. Production uninstall, application removal and detection of absence must pass. No vendor artifacts are manually removed to obtain a pass. A failed phase or failed checkpoint restoration leaves the release pending.
7. Dispatch the public website's `Curated catalog approval` workflow on `main`, using operation `approve`, the successful verification run ID, and a specific source/licensing/arguments review note. Supply a reviewed unsigned-installer exception for 7-Zip. The workflow uses a dedicated `CURATED_QA_READ_TOKEN` when configured, otherwise the existing repository automation `PAT`, to authenticate the private evidence. It prepares a concrete review artifact before asking the required maintainer to approve the signing environment.
8. The required maintainer reviews that artifact and approves the environment. The signer revalidates the evidence and creates `curated-approved-catalog`, containing the signed catalog and public evidence. It never deploys or modifies production data. Approver identity comes from GitHub review history. `node scripts/setup-curated-signing.mjs` initializes a protected environment key without writing or printing the private key; `--rotate` requires an explicit reviewed rotation. Review and commit every new public trust entry.
9. Publish `signed-catalog.json` as `catalog/curated/catalog.json` and `evidence.json` as `catalog/curated/evidence/APP_ID/CANDIDATE_ID.json` through a reviewed website PR. Run required validation and deploy after review. No schema migration is required. Preserve immutable approval records and evidence.

The authenticated operator profile endpoint remains available for diagnostics. `node scripts/build-curated-runtime.mjs` produces the same test profile builder as a standalone source-only module for QA, avoiding a dependency on a live website or its secrets.

Use the protected approval workflow's `withdraw` operation with an existing release ID and rationale. Withdrawn releases remain in history and are excluded from deployments and latest-version discovery; an older unwithdrawn release may remain available. Removal of an installed version requires a separate deployment action.

Use the protected workflow's `renew` operation to renew the catalog after maintainer review. It can verify an expired catalog at its final valid instant before producing a fresh signature; deployment always verifies current time. Review renewed release availability and security evidence operationally. Changing definitions invalidates the old signature, and changing the shared packaging toolchain invalidates affected execution approvals. Reverify and produce a reviewed catalog. Renewal is never an unattended trust heartbeat. The low-level CLI remains a recovery tool for a protected signing context; routine operations use the authenticated workflow.

Daily discovery reports source failures, newly discovered versions, changed publisher checksums and catalog expiry within two days. Problems fail the monitoring workflow and appear in its step summary and retained JSON artifact. GitHub Actions failure notifications follow repository notification settings. Monitoring cannot approve an application and makes no Winget lookup. Curated-only update requests skip the ordinary catalog entirely; a failed source cannot suppress successful results from the other source.

## Verification and current limits

Run `npm test`, `npx tsc --noEmit`, `npm run lint`, and `npm run build:ci`. Tests exercise tampering, unknown keys, expiration, source spoofing, evidence/hash mismatches, failed lifecycle phases, unsigned exceptions, withdrawal, changed package inputs, local-worker validation, and operator endpoint access. They establish software behavior; they are not application installation evidence.

Adobe remains manual. PuTTY discovery uses the publisher-linked official archive directory, avoiding its unavailable primary HTML page, and allows only the exact redirect from `latest/w64/` to a numeric version directory on the same publisher host. Protected signing setup and verification automation do not constitute installer qualification. No installers are approved in the bootstrap catalog. The operational milestone remains ten genuine passing verification records and maintainer-reviewed approvals, starting with a straightforward MSI. Do not advertise ten deployable apps until those records exist.
