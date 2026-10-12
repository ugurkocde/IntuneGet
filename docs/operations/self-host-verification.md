# Self-host verification runbook

Use this to verify a self-hosted deployment end to end. It covers the Docker path and the
SQLite mode, and records what was confirmed and what still needs a Docker daemon.

## Checks

### 1. Compose configuration renders

No Docker daemon required.

```bash
docker compose config
```

Expected: a single `web` service with the env from `docker-compose.yml`.

Known gap: the default is `DATABASE_MODE=supabase` with empty Supabase keys. An unedited
`docker compose up -d` therefore starts a container that cannot serve requests. This is the
friction reported by a self-hoster and is tracked in RFC 0003.

### 2. Image builds

Requires a Docker daemon.

```bash
docker build -t intuneget:test .
```

CI performs the same build, attempts a CRITICAL scan with Trivy, and runs a container smoke test
on pushes to `main` (`.github/workflows/ci.yml`, `docker` job).

### 3. Startup smoke test

`docker compose up -d` returns before the app is ready, so poll until the health endpoint reports
a healthy status instead of trusting a single request:

```bash
healthy=0
for i in $(seq 1 30); do
  body=$(curl -fsS http://localhost:3000/api/health 2>/dev/null) && \
    printf '%s' "$body" | grep -q '"status":"healthy"' && healthy=1 && break
  sleep 2
done
if [ "$healthy" -ne 1 ]; then
  echo "Health check did not report status: healthy" >&2
  exit 1
fi
printf '%s\n' "$body"
```

Expected: a JSON body with `status: healthy`. A `200` response with `status: degraded` means a
required service is down even though HTTP succeeded, so check the flags under `services` as well.
A healthy result requires all three services configured: database, auth, and pipeline. With the
default `DATABASE_MODE=supabase`, set the Supabase URL, anon key, and service role key first.
SQLite mode (step 4) also needs an Azure client id and secret (or managed identity) and a working
pipeline mode, so `PACKAGER_API_KEY` alone is not enough. The Compose healthcheck already calls
this endpoint.

### 4. SQLite mode

Run the app with SQLite as the database:

```bash
DATABASE_MODE=sqlite \
DATABASE_PATH=/tmp/intuneget/intuneget.db \
PACKAGER_API_KEY=placeholder \
NEXT_PUBLIC_AZURE_AD_CLIENT_ID=placeholder \
AZURE_AD_CLIENT_SECRET=placeholder \
npm run dev
```

Then request `/api/health`. Expected: `databaseMode: sqlite` and `services.database: true`.

Confirmed 2026-09-18 on the development server: `/api/health` returned `200` with
`databaseMode: sqlite` and `services.database: true` in about one second.

### 5. Catalog snapshot

In SQLite mode with Supabase unconfigured, the app catalog is served from a downloaded snapshot.
If Supabase credentials are present, the Supabase catalog source is used even when
`DATABASE_MODE=sqlite`. With the snapshot, the first catalog request downloads `catalog.sqlite.gz`,
verifies its SHA-256 against the published manifest, opens it read-only, and re-checks daily. Requirements: `better-sqlite3` installed, a writable data
directory, and outbound HTTPS to `github.com`, or set `CATALOG_SNAPSHOT_FILE` for a fully
offline install.

## Known gaps

- SQLite is a partial backend. See RFC 0003 for the gap matrix and options.
- The Compose defaults do not fail fast when the selected database mode is unconfigured.
- Docker build and container smoke tests were not run in this verification because no Docker
  daemon was available; they are covered by CI on `main`.

## Acceptance criteria for a full pass

- `docker compose config` renders without a daemon.
- Image builds and passes the Trivy CRITICAL scan.
- Container starts and `/api/health` returns `healthy`.
- SQLite mode reports `services.database: true`.
- A catalog page loads from the snapshot in SQLite mode.
