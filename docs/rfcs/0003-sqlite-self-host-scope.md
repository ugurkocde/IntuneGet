# RFC 0003: Scope and future of SQLite self-hosting

Status: Proposed
Date: 2026-09-18

## Problem

A Reddit commenter who self-hosted reported that SQLite "is extremely basic and lacking a lot of
features", that setup "took AI at least an hour to fix up to a usable state", and that it
"brought a new set of headaches".

The code confirms the shape of the problem. SQLite is a partial backend:

- Only two tables exist: `packaging_jobs` and `upload_history` (`lib/db/sqlite.ts`).
- No token persistence: `lib/auth.ts` skips `storeUserProfile` and `getStoredTokens` when
  Supabase is absent, so `user_profiles` does not exist in SQLite.
- These surfaces return empty or no-op in SQLite mode: notifications, update policies, update
  history and triggers, app mappings, user settings, community ratings and suggestions, usage
  limits and stats, MSP, SCCM history, and all cron jobs.
- The catalog is a read-only snapshot downloaded from a GitHub release, not a live store.
- There is no SQLite migration story; the schema is created inline and extended with a
  hand-maintained `compatibleColumns` map.

Docker Compose also defaults to `DATABASE_MODE=supabase`, so `docker-compose up -d` fails to be
useful until the operator edits env. That mismatch is the likely source of the "took an hour"
experience. The docs now state what SQLite covers before setup (see the Docker page), which
addresses the expectation part but not the capability part.

## Options

### A. Invest in SQLite parity

Add the missing tables and adapter methods so SQLite is a first-class backend for single-tenant
self-hosting: `user_profiles` (token persistence), update policies and history, notifications,
and a real migration runner.

Pros: true zero-dependency self-hosting, best fit for the "my data stays here" crowd.
Cons: large, ongoing surface; every Supabase-backed feature becomes a two-backend exercise.

### B. Scope SQLite to packaging-only and recommend Supabase

Keep SQLite as the low-dependency packaging backend. Make Supabase the recommended path for
anything beyond packaging. Improve setup and messaging (started in the Docker docs).

Pros: honest, small, stops the surprise.
Cons: does not satisfy operators who want a fully local install.

### C. Middle path: token persistence plus one or two high-value surfaces

Implement `user_profiles` and update policies/history in SQLite, leave MSP and community surfaces
Supabase-only, and document the line.

Pros: removes the most jarring gaps for a single operator.
Cons: still a two-backend maintenance cost, just smaller.

## Recommendation

Short term, B: make the boundary explicit in the UI and docs (hide or label unavailable
surfaces rather than showing empty states), and stop presenting SQLite as a general backend.
Medium term, C if self-host demand justifies it: add token persistence first, since its absence
breaks the sign-in experience, then update policies. Revisit A only with clear demand.

Supporting decisions:

- Make `docker-compose.yml` fail fast with a clear message when the selected mode is not
  configured, instead of starting in a broken state.
- Surface the active mode and unavailable features in the dashboard.

## Why not commit to A now

Every Supabase-backed route would need an SQLite path and tests, and the schema has no versioned
migration history. That cost is hard to justify without evidence that self-hosters want the full
feature set locally rather than a packaging tool plus a hosted database.

## Acceptance criteria (for B)

- Docker start fails fast with a clear error when the configured database mode is incomplete.
- The UI identifies SQLite mode and which surfaces are unavailable, instead of showing empty
  states.
- Docs state the boundary in one place and link from the setup pages.

## Open questions

- Do we have usage data for `DATABASE_MODE=sqlite` to size the demand?
- Is token persistence in SQLite a security change we are comfortable owning?
