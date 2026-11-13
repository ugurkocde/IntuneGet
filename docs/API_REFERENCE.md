# API Reference

This document summarizes the main IntuneGet API endpoints, grouped by feature area.

## Authentication

Most endpoints require:

```http
Authorization: Bearer <microsoft-access-token>
```

The token is the Microsoft Graph access token the portal obtains at sign-in, issued to this deployment's app registration. A Graph token issued to another application (Graph Explorer, the Azure CLI, your own app registration) is rejected with `401`. To let a script of your own call the API, list the client id of its app registration in `ALLOWED_TOKEN_CLIENT_IDS` (comma separated) on your deployment.

Some endpoints support optional auth (public reads), and callback endpoints use HMAC signatures.

## Rate Limiting

Community endpoints use in-memory rate limiting:

- Public reads: `30 requests/minute` per IP
- Authenticated community writes: `10 requests/minute` per user

## Package and Upload Pipeline

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/package` | Bearer | Queue packaging jobs (`github` or `local` mode) |
| `GET` | `/api/package?userId=...` | none | List recent jobs for a user |
| `GET` | `/api/package?jobId=...` | none | Get one job |
| `POST` | `/api/package/cancel` | Bearer | Cancel active or dismiss completed/failed jobs |
| `POST` | `/api/package/callback` | HMAC (`X-Signature`) | Pipeline callback for job status updates |
| `GET` | `/api/package/callback` | none | Callback endpoint health |
| `GET` | `/api/packager/jobs` | Packager key | List queued jobs for local packager |
| `POST` | `/api/packager/jobs` | Packager key | Claim a queued job |
| `PATCH` | `/api/packager/jobs` | Packager key | Heartbeat/progress/status update |
| `DELETE` | `/api/packager/jobs` | Packager key | Release claimed job |
| `GET` | `/api/packager/health` | none | Local packager health and stale-job recovery |

Notes:
- `POST /api/package` limits batches to 10 items.
- In `PACKAGER_MODE=github`, GitHub workflow settings must be configured.
- In `PACKAGER_MODE=local`, jobs stay queued for the local packager.

## Inventory (Intune)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/intune/apps` | Bearer | List Win32 apps from Intune |
| `GET` | `/api/intune/apps/[id]` | Bearer | Get app details and assignments |
| `GET` | `/api/intune/groups` | Bearer | Resolve Intune assignment groups |

Notes:
- Supports MSP tenant override via `X-MSP-Tenant-Id` where applicable.
- Tenant consent is verified before Graph operations.

## Reports and Analytics

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/analytics?days=N` | Bearer | Deployment summary, trends, top apps, failures |
| `GET` | `/api/analytics/export?days=N` | Bearer | Export deployment data as CSV |
| `GET` | `/api/analytics/stats` | none | Public/landing analytics snapshot |
| `POST` | `/api/analytics` | none | Track analytics events |

Notes:
- `days` is clamped to `1..365`.

## Updates and Policies

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/updates/available` | Bearer | List available updates with policy overlays |
| `PATCH` | `/api/updates/available` | Bearer | Dismiss/restore update entries |
| `POST` | `/api/updates/trigger` | Bearer | Trigger single or bulk updates (max 10) |
| `GET` | `/api/updates/history` | Bearer | Auto-update history with pagination |
| `GET` | `/api/update-policies` | Bearer | List update policies |
| `POST` | `/api/update-policies` | Bearer | Create/update (upsert) policy |
| `GET` | `/api/update-policies/[id]` | Bearer | Get one policy |
| `PATCH` | `/api/update-policies/[id]` | Bearer | Modify one policy |
| `DELETE` | `/api/update-policies/[id]` | Bearer | Remove one policy |

Policy types:
- `auto_update`
- `notify`
- `ignore`
- `pin_version`

## SCCM Migration

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/sccm/import` | Bearer | Import SCCM app export (CSV/JSON) |
| `GET` | `/api/sccm/migrations` | Bearer | List migrations, fetch one migration, or stats |
| `POST` | `/api/sccm/migrations` | Bearer | Create migration record |
| `PATCH` | `/api/sccm/migrations` | Bearer | Update migration metadata/status |
| `DELETE` | `/api/sccm/migrations?id=...` | Bearer | Delete migration |
| `GET` | `/api/sccm/match` | Bearer | List imported SCCM apps and match state |
| `POST` | `/api/sccm/match` | Bearer | Run automatic matching |
| `PATCH` | `/api/sccm/match` | Bearer | Manual match/exclude updates |
| `POST` | `/api/sccm/migrate?action=preview` | Bearer | Migration preview |
| `POST` | `/api/sccm/migrate?action=execute` | Bearer | Execute migration to cart/upload pipeline |
| `PATCH` | `/api/sccm/migrate` | Bearer | Update per-app migration settings |

## Community and App Requests

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/community/suggestions` | optional | List app suggestions with filters/pagination |
| `POST` | `/api/community/suggestions` | Bearer | Create app suggestion (auto-upvotes submitter) |
| `POST` | `/api/community/suggestions/[id]/vote` | Bearer | Add vote |
| `DELETE` | `/api/community/suggestions/[id]/vote` | Bearer | Remove vote |
| `GET` | `/api/apps/[id]/rate` | optional | Get app rating stats and recent ratings |
| `POST` | `/api/apps/[id]/rate` | Bearer | Create/update current user rating |
| `GET` | `/api/community/detection-feedback` | Bearer | Get user detection feedback for an app |
| `POST` | `/api/community/detection-feedback` | Bearer | Submit detection-rule feedback |

## MSP APIs

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET/POST` | `/api/msp/organization` | Bearer | Organization bootstrap/read |
| `GET/POST` | `/api/msp/tenants` | Bearer | Tenant management |
| `POST` | `/api/msp/tenants/[id]/consent-url` | Bearer (Owner or Admin) | Build admin consent URL |
| `GET` | `/api/msp/tenants/consent-callback` | none | Receives the Microsoft consent redirect and forwards to the approval page. Never links a tenant |
| `GET/POST` | `/api/msp/tenants/consent-approval` | Bearer (administrator of the customer tenant) | Describe and approve an MSP link request |
| `GET/POST` | `/api/msp/members` | Bearer | Team member management |
| `PATCH/DELETE` | `/api/msp/members/[id]` | Bearer | Role changes/remove member |
| `GET/POST` | `/api/msp/batch-deployments` | Bearer | Batch deployment orchestration |
| `GET/PATCH` | `/api/msp/batch-deployments/[id]` | Bearer | Batch deployment state |
| `GET` | `/api/msp/jobs` | Bearer | Cross-tenant job list |
| `GET` | `/api/msp/audit-logs` | Bearer | Audit trail |
| `GET` | `/api/msp/reports/analytics` | Bearer | Cross-tenant report dataset |
| `GET` | `/api/msp/reports/export` | Bearer | Cross-tenant report export |
| `GET/POST` | `/api/msp/webhooks` | Bearer | MSP webhook config |
| `GET/PATCH/DELETE` | `/api/msp/webhooks/[id]` | Bearer | MSP webhook management |
| `POST` | `/api/msp/webhooks/[id]/test` | Bearer | Send test webhook |
| `GET` | `/api/msp/webhooks/[id]/deliveries` | Bearer | Delivery logs |

## Notifications and Webhooks

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/notifications` | Bearer | List notifications |
| `POST` | `/api/notifications/mark-read` | Bearer | Mark one notification read |
| `POST` | `/api/notifications/mark-all-read` | Bearer | Mark all notifications read |
| `GET` | `/api/notifications/unread-count` | Bearer | Unread count |
| `GET/PATCH` | `/api/notifications/preferences` | Bearer | Notification preferences |
| `GET/POST` | `/api/webhooks` | Bearer | User webhook config |
| `GET/PATCH/DELETE` | `/api/webhooks/[id]` | Bearer | User webhook management |
| `POST` | `/api/webhooks/[id]/test` | Bearer | Test delivery |

## Misc and Ops

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/health` | none | App-level health |
| `GET` | `/api/winget/search` | none | Search packages |
| `GET` | `/api/winget/package` | none | Package details |
| `GET` | `/api/winget/manifest` | none | Manifest data |
| `GET` | `/api/winget/changelog` | none | Changelog data |
| `GET` | `/api/winget/categories` | none | Categories |
| `GET` | `/api/winget/popular` | none | Popular packages |
| `GET` | `/api/mappings` | none | App mapping data |

## Error Conventions

Common patterns:

- `401`: missing/invalid bearer token
- `403`: consent/permission failures
- `404`: resource not found
- `409`: conflict (duplicate vote/suggestion/feedback)
- `500`: internal/server integration failures

Error bodies are JSON and usually include `error` and/or `message`.
