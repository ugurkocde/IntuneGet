# Curated catalog continuation — 2026-10-03

Resume the existing goal: finalize the first ten curated applications, including genuine installer qualification, protected approval, and hosted/local Intune packaging checks. The user requested this checkpoint to continue on a device with Lokka MCP and their dev tenant.

## Checkouts

Both repositories have a pushed continuation branch named `feat/curated-catalog-handoff`:

- Website: https://github.com/ugurkocde/IntuneGet/tree/feat/curated-catalog-handoff
- Private QA workflows: https://github.com/ugurkocde/IntuneGet-Workflows/tree/feat/curated-catalog-handoff

Fetch and check out that branch in each repository. These branches start from protected `main`, including the already merged implementation. No uncommitted implementation changes remain in the original feature worktrees. Local generated output and dependency directories are not required for continuation.

## Completed implementation

- Website/catalog PR [#1319](https://github.com/ugurkocde/IntuneGet/pull/1319) merged as `b3766876cbdbc9814708b2d4e543fa5e21bc0d83`.
- Isolated verification PR [#5314](https://github.com/ugurkocde/IntuneGet-Workflows/pull/5314) merged as `e35f6303702be40a728d43ad83c6b9b8d37cb281`.
- Independent publisher discovery, monitoring, identifiers, source validation, execution profiles, signed releases, dashboard, hosted/local preflight, and approved-version update handling are implemented. Curated packaging and updates do not resolve Winget metadata; the production PSADT packager and deployment infrastructure remain shared.
- Protected verification builds and exercises the production package under LocalSystem inside the disposable Windows QA VM. Installer downloads, security scans, extraction and execution stay inside that VM.
- Website environment `curated-catalog-approval` requires maintainer `ugurkocde`, disables administrator bypass, and permits protected branches only. Its signing key is already installed as an environment-only GitHub secret. Public trust is committed in `catalog/curated/trusted-keys.json`; do not generate another key just to resume.
- Catalog approval authenticates actual private workflow artifacts and actual GitHub maintainer approval. It emits a signed artifact for a subsequent reviewed website PR; it does not publish automatically.
- Required PR checks passed, including Linux full tests. Locally 2,348 tests passed excluding two existing Unix-only script tests; TypeScript, lint, production build and changelog validation passed. Discovery and QA contract checks passed. These are software checks, not proof of application installation.

Read [CURATED_CATALOG.md](./CURATED_CATALOG.md) and the private repository's `qa/curated/README.md` for the operator workflow.

## Live state at checkpoint

Checked at 2026-10-03 18:24 UTC. Recheck the linked runs; their state can change after this commit.

- [Publisher discovery run 37143563600](https://github.com/ugurkocde/IntuneGet/actions/runs/37143563600): **success**, nine automatic candidates; Adobe remains manual.
- [7-Zip verification run 37143619787](https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/37143619787): **pending**, behind ordinary QA in the shared single-test queue. It targets genuine 26.02 → 26.03 x64 MSI qualification. Do not dispatch a duplicate until checking this run.
- [Changelog publication run 37143912901](https://github.com/ugurkocde/IntuneGet/actions/runs/37143912901): **in progress**. Verify completion and the public feed. The global `publish-changelog` skill was unavailable; the normal reviewed-entry CI publisher was used.
- **Zero approved releases.** All ten definitions remain awaiting verification, and curated deployment remains disabled. No real installer lifecycle has yet been confirmed by this work.
- No dev tenant has been selected and no hosted/local deployment has been performed. Lokka was absent from this device's exposed tool catalog and saved MCP configuration. The user explicitly requested **Lokka MCP and their dev tenant**; do not guess a tenant or target a customer tenant.

## Resume in order

1. Connect Lokka on the new device. Read tenant identity through Lokka and confirm the actual dev tenant display name and tenant ID before targeting it. Keep authentication material out of handoff files, logs and the QA VM.
2. Check the existing 7-Zip run. Inspect its bounded evidence artifact. If it fails, repair the actual failed phase through a new branch/PR, follow the QA skill's failure-loop controls, and rerun. Do not turn failed phases into a pass or bypass checkpoint restoration.
3. Qualify the remaining definitions: Chrome Enterprise, Firefox ESR, Adobe Reader, Notepad++, VS Code, Git for Windows, VLC, WinSCP and PuTTY. Use genuine official previous installers for upgrade tests. Chrome's mutable latest URL cannot provide a historical version; Adobe needs a full installer plus distribution-rights review, not an MSP patch. Actual publisher identities and redirects may require reviewed definition changes.
4. For each genuine passing run, prepare the website's protected approval workflow with a specific source/licensing/arguments review note. 7-Zip additionally needs an explicit reviewed unsigned-installer exception. A maintainer must review the concrete artifact and approve the signing environment. Confirm the configured `CURATED_QA_READ_TOKEN` or fallback `PAT` can read private QA evidence; access has not yet been exercised by approval.
5. Commit each signed catalog and immutable public evidence from the approved artifact through a reviewed website PR. Validate signatures, current package pins and deployment expiry. Catalog signatures have at most seven days of validity; renewal is a protected reviewed operation.
6. Verify the deployed dashboard/API, hosted packaging, and local worker claim/package/upload using the actual approved release and the dev tenant. Confirm installed identity/version, detection, upgrade, uninstall and curated update isolation. Mark the goal complete only after the ten genuine qualifications and deployment checks have succeeded.

## Pins and safety

- Shared production packager commit: `60395492a3d51b2ff6f14b50ed7cd0c7f558be70` at checkpoint. Recheck live QA control and repository pins before new dispatch.
- PSADT 4.1.8 template SHA-256: `50CB8D32973FC7648060A48CAD63912ECB5CACA5A70754F37E83AA06BD380283`.
- The current physical host is the QA runner host. Never download, extract or execute vendor installers there; do not access `C:\actions-runner-intuneqa` directly. Use the protected workflow and isolated VM.
- Preserve unrelated edits in other checkouts. Do not interrupt ordinary QA to accelerate this pilot.
- Never commit private signing keys, tenant credentials, raw host/guest logs or synthetic unit-test evidence as approvals.

Exact metadata-only inputs for the already queued run are preserved in [curated-7zip-verification-inputs.json](./curated-7zip-verification-inputs.json). They contain no installer payload or credentials and are not an approval. For a new dispatch, rediscover/review source metadata and refresh timestamps; avoid presenting stale inputs as fresh discovery.
