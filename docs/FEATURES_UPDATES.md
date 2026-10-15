# Updates and Policy Guide

This guide covers available updates, trigger flow, policy behavior, and history tracking.

## Overview

The updates system combines:

1. Available update detection.
2. Per-app/per-tenant update policies.
3. Manual triggers (single and bulk).
4. Auto-update history and safeguards.

UI page: `/dashboard/updates`

## Policy Types

| Policy | Behavior |
|---|---|
| `auto_update` | Auto-apply using stored deployment configuration |
| `notify` | Surface update but do not auto-apply |
| `ignore` | Ignore update (used to skip in bulk trigger) |
| `pin_version` | Keep app pinned to a target version |

## Main Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/updates/available` | List updates with policy overlays |
| `PATCH` | `/api/updates/available` | Dismiss/restore updates |
| `POST` | `/api/updates/trigger` | Trigger update(s), max 10 per request |
| `GET` | `/api/updates/history` | Retrieve auto-update history |
| `GET` | `/api/update-policies` | List policies |
| `POST` | `/api/update-policies` | Upsert policy |
| `GET` | `/api/update-policies/[id]` | Get policy |
| `PATCH` | `/api/update-policies/[id]` | Update policy |
| `DELETE` | `/api/update-policies/[id]` | Delete policy |

All endpoints require `Authorization: Bearer <microsoft-access-token>`.

## Manual Trigger Flow

`POST /api/updates/trigger` runs this high-level flow per requested app:

1. Validate request and user context.
2. Find matching `update_check_results` row.
3. Ensure policy exists:
   - If missing, attempt to clone deployment config from prior successful deployment.
4. Temporarily force policy to `auto_update` + `is_enabled=true` for manual run.
5. Resolve installer metadata from curated app/version data.
6. Create auto-update history + packaging job.
7. Restore original policy state after trigger.

## Safety and Limits

The update trigger logic applies safeguards such as:

- Consecutive failure threshold
- Hourly update caps
- Cooldown windows
- Consent verification
- Optional requirement for prior deployment config

If a policy accumulates failures past threshold, it can be auto-disabled.

## Query Parameters

### `/api/updates/available`

- `tenant_id` (optional)
- `include_dismissed=true|false` (optional)
- `critical_only=true|false` (optional)

### `/api/updates/history`

- `tenant_id` (optional)
- `winget_id` (optional)
- `status` (`pending|packaging|deploying|completed|failed|cancelled`)
- `limit` (max 100)
- `offset`

## Common Validation Rules

- Policy `pin_version` requires `pinned_version`.
- Policy `auto_update` requires `deployment_config`.
- Bulk trigger payloads are limited to 10 update items.

## UI Notes

The updates page provides:

- Available updates tab with quick actions
- Auto-update history tab with pagination
- "Update all" handling that skips ignored/pinned-mismatch entries

## Related Docs

- `docs/API_REFERENCE.md`
- `docs/ENV_REFERENCE.md`

## Automatic update scope

On the Updates page, choose an app's Auto update policy, then select All updates, Minor and major, or Major only. The same selector is available in the auto update apps list. Existing policies default to All updates on both hosted and SQLite installations.

Restricted scopes compare numeric versions with up to four components and an optional leading v. Unparseable versions and nonforward changes are held with a visible explanation. The update remains available for manual deployment and notifications continue. Major only can delay security fixes shipped in minor or patch releases. Version scope does not indicate security severity.
