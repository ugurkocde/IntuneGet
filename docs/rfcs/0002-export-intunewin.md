# RFC 0002: Export the built .intunewin

Status: Proposed
Date: 2026-09-18

## Problem

The most concrete request in the r/Intune thread was: just give me the `.intunewin` and let me
upload it myself instead of using a connector.

Today the hosted pipeline builds the package on an ephemeral runner, uploads it to the caller's
tenant, and discards it (`package-intunewin.yml`, cleanup at roughly lines 1407-1411 and
3002-3008). `packaging_jobs.intunewin_url` and `intunewin_size_bytes` exist in the schema but
are never written. There is no download route.

This is a trust feature more than a convenience feature: handing over the artifact removes the
need to trust the upload path.

## Options

### A. Persist the artifact and serve a signed download

- Store the `.intunewin` in object storage (for example Azure Blob or S3) with a per-job key.
- Send the storage reference in the callback and write `intunewin_url` / `intunewin_size_bytes`.
- Add an authenticated download route scoped to the owning tenant and user.
- Retention: delete after N days, default 7, configurable per organization.
- Encryption: rely on the platform's (Microsoft already encrypts `.intunewin` content; the
  file itself is a normal zip-like container). Storage must be encrypted at rest.

Pros: real artifact export, matches the ask exactly.
Cons: new storage dependency, retention and billing, larger blast radius if misconfigured.

### B. Export a self-serve repack bundle

- Persist only the inputs (already available: installer URL, SHA-256, package config, detection
  rules, PSADT pin) and let the caller rebuild locally with the published scripts.
- Add a "download build recipe" button that emits a JSON plus a one-command local build.

Pros: no artifact storage, reuses the existing self-host packager.
Cons: does not give the literal `.intunewin`; still requires a Windows machine.

### C. Rely on self-hosting

- Document that full control is available by self-hosting (already true).

Pros: zero new surface.
Cons: does not answer the hosted-user request.

## Recommendation

Ship A behind a feature flag for organizations that opt in, with a default retention of 7 days,
tenant-scoped access, and signed, short-lived URLs. Offer B as a lighter alternative that needs
no storage and can ship first if A is deferred. Keep C as the documented fallback.

## Security and data handling

- The artifact contains the vendor installer. It is not secret, but it is tenant-linked.
- Store only as long as needed; expose a delete action.
- Access checks must reuse the existing tenant and role model.
- Log every download to the audit log.

## API sketch

- `GET /api/package/jobs/{id}/intunewin` returns a short-lived signed URL or 404 when expired.
- `POST /api/package/jobs/{id}/intunewin/delete` removes the artifact on demand.

## Workflow change (private repo)

- After the `.intunewin` is built, upload it to storage and include the reference and size in the
  success callback instead of discarding it.
- Respect a per-job `retain_artifact` flag from the dispatch payload so organizations that do
  not want storage can keep discarding it.

## Acceptance criteria

- With the flag on, a completed job exposes a working, tenant-scoped download that produces a
  `.intunewin` uploadable to Intune.
- With the flag off, behavior is unchanged and nothing is stored.
- Artifacts are deleted after the retention window and the download returns a clear error.
- Downloads are recorded in the audit log.

## Open questions

- Storage backend choice and region (must match existing data residency commitments).
- Whether export is free for everyone or an org-level setting.
- Maximum artifact size and per-tenant storage quota.
