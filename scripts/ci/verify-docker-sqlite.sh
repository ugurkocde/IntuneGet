#!/usr/bin/env bash
# Run only against disposable CI volumes, never an operator's existing data.
set -euo pipefail
image=${1:?Usage: verify-docker-sqlite.sh IMAGE [BASELINE_IMAGE]}
baseline=${2:-}
volume="intuneget-ci-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}-${RANDOM}-${RANDOM}"
container_id=''
volume_created=false
cleanup() {
  if [[ -n "$container_id" ]]; then
    docker logs "$container_id" || true
    docker rm --force "$container_id" >/dev/null 2>&1 || true
  fi
  if [[ "$volume_created" == true ]]; then
    docker volume rm "$volume" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT
if docker volume inspect "$volume" >/dev/null 2>&1; then
  echo 'Refusing to reuse an existing verification volume' >&2
  exit 1
fi
docker volume create "$volume" >/dev/null
volume_created=true
start_container() {
  container_id=$(docker run --detach --publish 127.0.0.1:3001:3000 \
    --env DATABASE_MODE=sqlite --env DATABASE_PATH=/data/intuneget.db \
    --env PACKAGER_MODE=local --mount "type=volume,source=$volume,target=/data" "$1")
  for _ in {1..30}; do
    if health=$(curl --silent --show-error --max-time 5 http://127.0.0.1:3001/api/health) \
      && jq --exit-status '.databaseMode == "sqlite" and .services.database == true' <<< "$health" >/dev/null; then
      return 0
    fi
    sleep 2
  done
  echo 'SQLite database did not become available on the test volume' >&2
  return 1
}
stop_container() {
  docker rm --force "$container_id" >/dev/null
  container_id=''
}
if [[ -n "$baseline" ]]; then
  # The old image needs this workaround only on our newly created fixture.
  docker run --rm --user 0 --entrypoint sh \
    --mount "type=volume,source=$volume,target=/data" "$baseline" -c 'chown 1001:1001 /data'
  start_container "$baseline"
else
  start_container "$image"
fi
test "$(docker exec "$container_id" id -u)" = 1001
test "$(docker exec "$container_id" stat -c '%u:%g' /data)" = '1001:1001'
docker exec "$container_id" node -e '
  const Database = require("better-sqlite3");
  const db = new Database(process.env.DATABASE_PATH);
  db.exec("CREATE TABLE intuneget_ci_volume_probe (value TEXT NOT NULL)");
  db.prepare("INSERT INTO intuneget_ci_volume_probe VALUES (?)").run("persisted");
  if (process.argv[1] === "upgrade") {
    db.prepare(`INSERT INTO packaging_jobs
      (id,user_id,winget_id,version,display_name,installer_type,installer_url,status)
      VALUES (?,?,?,?,?,?,?,?)`).run("ci-release-fixture", "ci-fixture", "Fixture.App",
        "1.0", "CI fixture", "exe", "https://example.invalid/fixture.exe", "completed");
  }
  db.close();
' "${baseline:+upgrade}"
stop_container
start_container "$image"
docker exec "$container_id" node -e '
  const Database = require("better-sqlite3");
  const db = new Database(process.env.DATABASE_PATH);
  const row = db.prepare("SELECT value FROM intuneget_ci_volume_probe").get();
  if (row?.value !== "persisted") throw new Error("SQLite data did not survive container recreation");
  if (process.argv[1] === "upgrade") {
    const job = db.prepare("SELECT status FROM packaging_jobs WHERE id = ?").get("ci-release-fixture");
    if (job?.status !== "completed" || db.pragma("user_version", {simple:true}) !== 4)
      throw new Error("SQLite upgrade did not preserve the fixture or complete migrations");
  }
  db.close();
' "${baseline:+upgrade}"
echo 'SQLite image verification passed'
