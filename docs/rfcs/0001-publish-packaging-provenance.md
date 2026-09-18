# RFC 0001: Publish packaging-job provenance

Status: Proposed
Date: 2026-09-18

## Problem

The r/Intune thread on intuneget.com raised the same question repeatedly: what exactly is in
the package, and can I verify it? The QA path now publishes provenance (installer source,
installer SHA-256, PSADT version, packaging commit, package profile) on the app page, but the
hosted packaging path does not.

Today the packaging workflow knows and prints these values, but they never leave the runner:

- the pinned IntuneGet scripts commit
- the PSADT template SHA-256
- the Win32 Content Prep Tool SHA-256
- the package size
- the PSADT version

They appear only in the GitHub Actions job summary
(`IntuneGet-Workflows/.github/workflows/package-intunewin.yml`, roughly lines 2973-3000). The
success callback body does not include them, and `packaging_jobs` has no columns for them.

## Proposal

Persist the values the workflow already knows and surface them where a package is reviewed.

### 1. Callback contract

Extend the success payload of `POST /api/package/callback` with optional fields:

```
psadt_version?: string
psadt_template_sha256?: string
intunewinapputil_sha256?: string
package_size_bytes?: number
intuneget_ref?: string
```

All optional and backward compatible. Unknown fields are ignored.

### 2. Schema

Add nullable columns to `packaging_jobs`:

| Column | Type | Notes |
|---|---|---|
| `psadt_version` | text | e.g. `4.1.8` |
| `psadt_template_sha256` | text | uppercase hex |
| `intunewinapputil_sha256` | text | uppercase hex |
| `package_size_bytes` | bigint | output `.intunewin` size |
| `intuneget_ref` | text | pinned commit of the public scripts |

Add the columns to `types/database.ts` (`packaging_jobs` Row/Insert/Update), `lib/db/types.ts`
(`PackagingJob`), and the SQLite `compatibleColumns` map in `lib/db/sqlite.ts`.

### 3. Workflow change (private repo)

In `package-intunewin.yml`, add the values already computed for the job summary to the success
callback body. No new computation, just persistence. This is a separate change in
`IntuneGet-Workflows`.

### 4. UI

- Show the provenance on the packaging job view in the dashboard.
- Optionally mirror it on the app page provenance panel next to the QA provenance.

## Why not just docs

A written description of the pipeline (see `/docs/packaging`) answers the process question. A
per-build record answers the "prove it for this build" question, which is the one the thread
kept asking. The data already exists; only persistence is missing.

## Risks

- Schema churn on `packaging_jobs`; keep the columns nullable and additive.
- Cross-repo coordination: the columns stay empty until the private workflow sends them. Ship
  the public side and the workflow change together.
- No PII or tenant data is involved in these values.

## Acceptance criteria

- A successful packaging job stores PSADT version, PSADT template SHA-256, Win32 Content Prep
  Tool SHA-256, package size, and the pinned scripts commit.
- The values are visible on the job view.
- Jobs that predate the change render without the block.
- Callback requests without the new fields continue to succeed.

## Open questions

- Should the pinned scripts commit also be exposed as a link to the public commit? Recommended:
  yes.
- Do we want to enforce that catalog builds always send these fields? Recommended: warn first,
  enforce later.
