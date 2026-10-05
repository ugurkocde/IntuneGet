# Curated catalog status (2026-10-04)

The curated catalog runs without manual steps. Every 30 minutes the `Curated catalog automation` workflow reads each publisher's release metadata, dispatches isolated VM verification for new versions, approves passing runs under a fixed policy, signs the catalog and publishes it through an auto-merging PR. The merge deploys, and existing curated update policies pick up the new version. Reliability is modelled on PatchMyPC: releases are pinned by publisher hash, IntuneGet never hosts installer binaries, and the vendor download goes straight into the customer's own tenant.

Read [CURATED_CATALOG.md](./CURATED_CATALOG.md) for the pipeline, trust model and withdrawal procedure, and the private repository's `qa/curated/README.md` for the verifier.

## Where to look

- **Current state:** the latest `Curated catalog automation` run summary lists every app's publisher release, approved version and state.
- **Problems:** the `Curated catalog automation needs attention` issue in the private QA repository. It closes itself when the alerts clear.
- **Published releases:** `catalog/curated/catalog.json` and the public evidence under `catalog/curated/evidence/`.

## Policy decisions

- **Automated approval (2026-10-04).** No maintainer review. Approval requires the authenticated passing run, exact installer hash, observed Authenticode result recorded but not gated (trust rests on the SHA256 pin), clean Defender scan, every lifecycle phase and VM restoration.
- **Vendor-updated apps** (`autoUpdate: "vendor-managed"`) may be approved without an upgrade test when no immutable earlier official build is available. The fixed policy reason is signed into the release.
- **Adobe Reader** is discovered from Adobe's enterprise download service, uses only the full `_en_US.exe` installer, and requires each tenant to accept the Adobe Acrobat Reader Distribution License Agreement before deployment.
- **VLC** may download from any HTTPS mirror, but only with the publisher SHA-256 pinned.
- **Packager compatibility.** Releases stay deployable across later shared packager releases unless one changes behavior their exact profile exercises.

## Known limits

- The QA VM's golden checkpoint could not update Defender signatures through Windows Update (`0x80070652`). The guest now falls back to Microsoft's offline definition package. If runs still fail at `defenderStatus`, refresh the checkpoint on the runner host; automation never touches the host.
- WinSCP downloads from SourceForge, which rate limits GitHub-hosted runners, so hosted packaging of WinSCP may fail even after it qualifies.

## Safety

- The physical QA host is the runner host. Never download, extract or execute vendor installers there, and never access `C:\actions-runner-intuneqa` directly.
- Never commit private signing keys, tenant credentials, raw host or guest logs, or synthetic unit-test evidence as approvals.
- The automation never interrupts ordinary QA and keeps at most two curated runs queued.
