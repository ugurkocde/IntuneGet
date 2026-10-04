# Curated catalog status (2026-10-04)

Goal: finalize the first ten curated applications with genuine installer qualification, protected approval, and hosted/local Intune packaging checks. Reliability is modelled on PatchMyPC: releases are pinned by publisher hash, IntuneGet never hosts installer binaries, and the vendor download goes straight into the customer's own tenant.

Read [CURATED_CATALOG.md](./CURATED_CATALOG.md) and the private repository's `qa/curated/README.md` for the operator workflow.

## Current state

- **Zero approved releases.** All ten definitions await verification and curated deployment remains disabled.
- **Blocker: QA golden checkpoint.** Defender in the restored guest cannot update its signatures (`0x80070652` from both the default source and MMPC), so every curated run stops at inspection with `failedStep: defenderStatus`. The maintainer refreshes the checkpoint on the runner host: boot the VM, let Windows Update and the Defender platform and signature updates finish, then retake the golden checkpoint. Never touch the host from automation.
- **Dev tenant:** the maintainer's lab tenant, confirmed by the maintainer and reached through the Lokka app-only connection. Confirm the active Lokka tenant before any deployment check; never target a customer tenant.

## Policy decisions (2026-10-04)

- **Vendor-updated apps** (`autoUpdate: "vendor-managed"`) may be approved without an upgrade test when no older official build exists. The skip needs a reviewer-written `upgrade_exception` at approval and is signed into the release. Seven definitions are vendor-managed; Chrome is the case that needs it, because Google publishes no historical enterprise MSI.
- **Adobe Reader** requires each tenant to accept the Adobe Acrobat Reader Distribution License Agreement before deployment. Enforced server-side on every deployment path; acceptances live in `curated_licence_attestations` (applied to production Supabase).
- **VLC** may download from any HTTPS mirror, but only with the publisher SHA-256 pinned.

## Merged work

Website: #1322 (Chrome full-rollout discovery), #1327 (publisher checksums for Firefox ESR, PuTTY, VLC and WinSCP; VLC mirror policy; WinSCP x86), #1328 (licence attestation), #1329 (upgrade test exemption).

QA workflows: #5317 (bounded guest failure step and error ID in evidence), #5319 (Windows PowerShell 5.1 exit codes), #5321 and #5345 (Defender signature update retries with MMPC fallback and UTC freshness check), #5359 (hash-pinned mirrors and x86 apps), #5361 (verification without an earlier release for vendor-managed apps).

## Qualification order after the checkpoint refresh

1. **7-Zip** 26.02 to 26.03 x64 MSI first, to prove the pipeline. Approval needs the reviewed unsigned-installer exception.
2. **Firefox ESR** (140.16 to 140.17), **Notepad++** (8.9.8 to 8.9.8.1), **VS Code** (1.139.1 to 1.140.0), **Git** (2.55.0.5 to 2.56.0), **PuTTY** (0.84 to 0.85). Previous installers and publisher hashes were confirmed by metadata on 2026-10-03.
3. **VLC** and **WinSCP**, now that mirror and architecture handling exist.
4. **Chrome** with the upgrade test exemption.
5. **Adobe Reader** after the distribution rights review, with the full `_en_US.exe` installer (never an MSP patch).

Signer names for Git, Notepad++ and WinSCP are compared exactly and can only be confirmed by the first guest run.

Generate candidate JSON from fresh metadata for every dispatch, for example:

```bash
node scripts/curated-catalog.mjs candidate --app 7zip --version 26.03 \
  --installer-url https://github.com/ip7z/7zip/releases/download/26.03/7z2603-x64.msi \
  --sha256 <GitHub asset digest> --output output/curated/candidate.json
```

Failed runs now report `failedStep` and `failedErrorId` in the bounded evidence; use them before changing code.

## After qualification

For each passing run: dispatch the protected approval workflow with a specific review note (and any unsigned or upgrade exception), have the maintainer approve the signing environment, then publish the signed catalog and evidence through a reviewed website PR. Catalog signatures last at most seven days. Finally verify the dashboard/API, hosted packaging and local packager claim, package and upload in the dev tenant, including installed identity, detection, upgrade, uninstall and curated update isolation.

## Safety

- The physical QA host is the runner host. Never download, extract or execute vendor installers there, and never access `C:\actions-runner-intuneqa` directly.
- Never commit private signing keys, tenant credentials, raw host or guest logs, or synthetic unit-test evidence as approvals.
- Do not interrupt ordinary QA to accelerate this pilot.
