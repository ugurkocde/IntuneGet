"""Real PostgreSQL concurrency contracts using the existing historical fixtures.

Only the disposable Actions service is reachable. This does not prove that live
production callers have drained; that requires a separate deployment observation.
"""
import concurrent.futures
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import threading
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = Path(__file__).resolve().parent / "fixtures"
MIGRATIONS = ROOT / "supabase" / "migrations"
PREREQUISITES = ["20260714201549_installer_preflight_health",
                 "20261012153307_qa_installer_security_holds"]
LEDGER = ["20261016190552_qa_vt_coverage_holds_and_quota",
          "20261016201507_qa_vt_positive_hold_upgrade",
          "20261016210756_qa_vt_public_submission_bridge",
          "20261017005156_qa_vt_metadata_rechecks",
          "20261017032327_qa_vt_ledger_acl",
          "20261017142911_qa_vt_submission_dispatch_binding",
          "20261017162556_qa_vt_terminal_lookup_proof",
          "20261017162626_qa_vt_terminal_verdict_completion"]
SECRET = "local-fixture-only"
CID = "11111111-1111-4111-8111-111111111111"
MID = "22222222-2222-4222-8222-222222222222"
LEASE = "33333333-3333-4333-8333-333333333333"
HASH = "a" * 64
PROFILE = "B" * 64
CONTAINER = os.environ.get("PG_TEST_CONTAINER", "")
ENV = {k: os.environ[k] for k in ("PATH", "HOME", "LANG") if k in os.environ}
DB = "vt_contract_" + uuid.uuid4().hex


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def migration(name):
    return (MIGRATIONS / (name + ".sql")).read_text().replace("\r\n", "\n")


def command(database=DB, application="vt-contract"):
    return ["docker", "exec", "-i", "--env", "PGAPPNAME=" + application,
            CONTAINER, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1",
            "-U", "postgres", "-d", database]


def sql(text, role="fixture_owner", database=DB, check=True, application="vt-contract"):
    prefix = "set statement_timeout='10s';set lock_timeout='5s';"
    if role:
        if role not in ("fixture_owner", "service_role", "anon", "authenticated"):
            raise ValueError("Unexpected fixture role")
        prefix += "set role " + role + ";"
    result = subprocess.run(command(database, application), input=prefix + text,
                            text=True, capture_output=True, env=ENV, timeout=20)
    if check and result.returncode:
        raise AssertionError(result.stderr)
    return result


def value(query, role="fixture_owner"):
    row = json.loads(sql("select row_to_json(v) from (" + query + ") v", role).stdout.strip())
    assert len(row) == 1
    return next(iter(row.values()))


def denied(query, pattern, role="service_role"):
    result = sql(query, role, check=False)
    assert result.returncode and re.search(pattern, result.stderr), result.stderr


def fixture():
    # Reuse the JSON schema/functions and historical migrations from
    # installer-security-fixture.ts. No production schema or data is downloaded.
    statements = []
    for table in json.loads((FIXTURES / "diagnostic-retest-schema.json").read_text()):
        assert re.fullmatch(r"public\.[a-z_]+", table["name"])
        columns = []
        for column in table["columns"]:
            assert re.fullmatch(r"[a-z_][a-z0-9_]*", column["name"])
            kind = column["data_type"]
            if kind == "ARRAY":
                kind = column["format"][1:] + "[]"
            elif kind == "USER-DEFINED":
                kind = "text"
            columns.append('"' + column["name"] + '" ' + kind +
                           (" default gen_random_uuid()" if column["name"] == "id" and kind == "uuid" else ""))
        if any(c["name"] == "id" for c in table["columns"]):
            columns.append("primary key(id)")
        if table["name"] == "public.qa_repair_requests":
            columns.append("unique(candidate_id)")
        statements.append("create table " + table["name"] + " (" + ",".join(columns) + ");")
    statements.append("create table public.catalog_file_reputation(sha256 text primary key,status text,malicious integer,suspicious integer,total_engines integer,analyzed_at timestamptz,checked_at timestamptz,retry_after timestamptz,engine_count_version integer);")
    statements.append("grant usage on schema public,extensions to service_role;grant all on all tables in schema public to service_role;")
    # Match Supabase's inherited grants so migration revocations are exercised,
    # rather than mistaking a missing schema grant for table ACL protection.
    statements.append("grant usage on schema public to anon,authenticated;"
                      "alter default privileges in schema public grant all on tables to anon,authenticated,service_role;"
                      "alter default privileges in schema public grant all on functions to anon,authenticated,service_role;")
    baseline = json.loads((FIXTURES / "diagnostic-retest-functions.json").read_text())
    reporter, count = re.subn(r"expected_secret_hash constant text := '[a-f0-9]{64}'",
                             "expected_secret_hash constant text := '" + hashlib.sha256(SECRET.encode()).hexdigest() + "'",
                             baseline["reporter"].replace("\r\n", "\n"))
    assert count == 1
    # PGlite accepts each function at EOF without a terminator; psql needs a
    # separator when those same fixture definitions share one stdin stream.
    statements += [baseline["claimant"].rstrip() + ";\n", reporter.rstrip() + ";\n",
                   migration("20261011075101_qa_guarded_diagnostic_retests")]
    statements += [migration(name) for name in PREREQUISITES]
    sql("\n".join(statements))


def parallel(queries, role="service_role"):
    barrier = threading.Barrier(len(queries))
    def run(query):
        barrier.wait(timeout=10)
        return sql(query, role, check=False)
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(queries)) as pool:
        return list(pool.map(run, queries))


def reset():
    sql("truncate qa_vt_requests,qa_vt_metadata_rechecks,qa_vt_submission_intents;"
        "update qa_vt_request_budget set blocked_until=null;delete from qa_candidates;")


def candidate(candidate_id=CID, status="running", hash_value=HASH):
    sql("insert into qa_candidates(id,status,test_level,installer_sha256,package_profile_sha256,github_run_id,phase,finished_at) values(" +
        ",".join(map(literal, [candidate_id, status, "psadt-package", hash_value, PROFILE, "12345", "publishing"])) +
        "," + ("null" if status == "running" else "now()") + ")")
    sql("update qa_candidates set winget_id='Fixture.App',version='1',architecture='x64',"
        "installer_url='https://example.invalid/installer',attempts=1,dispatched_at=now(),enqueued_at=now() "
        "where id=" + literal(candidate_id))


def reserve():
    return "select reserve_qa_vt_request('" + HASH + "','hash_lookup')"


def wait_for(query):
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if value(query, role=None):
            return
        time.sleep(.05)
    raise AssertionError("Separate-session barrier timed out")


@contextmanager
def transaction(text, application, role="service_role"):
    session = subprocess.Popen(command(application=application), stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=ENV)
    try:
        session.stdin.write("set statement_timeout='10s';set lock_timeout='5s';set role " + role +
                            ";begin;" + text + ";\n")
        session.stdin.flush()
        wait_for("select exists(select 1 from pg_stat_activity where application_name=" +
                 literal(application) + " and state='idle in transaction')")
        yield session
    finally:
        if session.poll() is None:
            session.stdin.write("rollback;\n\\q\n")
            session.stdin.flush()
        try:
            session.communicate(timeout=15)
        except subprocess.TimeoutExpired:
            session.kill()
            session.communicate(timeout=5)


def contracts():
    assert 170000 <= value("select current_setting('server_version_num')::int") < 180000
    assert value("select not rolsuper from pg_roles where rolname='fixture_owner'")
    fixture()
    # A positive security hold must survive both rollback and commit.
    sql("insert into qa_installer_security_holds(sha256,malicious_verdicts) values(repeat('f',64),3)")
    sql("insert into qa_installer_security_holds(sha256,malicious_verdicts) select encode(extensions.digest('synthetic-hold-'||n,'sha256'),'hex'),1 from generate_series(1,1142) n")
    hold_query = "select row_to_json(h) from qa_installer_security_holds h order by sha256"
    hold = sql(hold_query).stdout
    ddl = "\n".join(migration(name) for name in LEDGER)
    for ending in ("rollback", "commit"):
        session = subprocess.Popen(command(application="vt-ddl"), stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=ENV)
        try:
            session.stdin.write("set statement_timeout='10s';set lock_timeout='5s';set role fixture_owner;begin;" + ddl + "\nselect 'DDL_READY';\n")
            session.stdin.flush()
            # The separate session proves uncommitted DDL is invisible.
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline:
                if value("select exists(select 1 from pg_stat_activity where application_name='vt-ddl' and state='idle in transaction')", role=None):
                    break
                if session.poll() is not None:
                    raise AssertionError(session.stderr.read())
                time.sleep(.05)
            else:
                raise AssertionError("DDL session did not reach its barrier")
            assert value("select to_regclass('public.qa_vt_requests') is null")
            session.stdin.write(ending + ";\n\\q\n")
            session.stdin.flush()
            output, error = session.communicate(timeout=15)
            assert session.returncode == 0 and "DDL_READY" in output, error
        finally:
            if session.poll() is None:
                session.kill()
                session.communicate(timeout=5)
        assert value("select (to_regclass('public.qa_vt_requests') is not null)") == (ending == "commit")
        assert sql(hold_query).stdout == hold
    print("PASS PG17 transactional migration visibility, rollback and positive hold preservation")
    # This is a synthetic tracked caller, not proof about unmetered production
    # requests. Its transaction must drain before a later reservation proceeds.
    with transaction("select pg_advisory_xact_lock(hashtextextended('intuneget-vt-request-budget',0));"
                     "insert into qa_vt_requests(sha256,operation) values(repeat('a',64),'hash_lookup')",
                     "vt-drain") as session:
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            waiting = pool.submit(sql, reserve(), "service_role", DB, True, "vt-reserve-wait")
            wait_for("select exists(select 1 from pg_stat_activity where application_name='vt-reserve-wait' and wait_event='advisory')")
            assert not waiting.done()
            session.stdin.write("commit;\n\\q\n")
            session.stdin.flush()
            assert json.loads(waiting.result(timeout=15).stdout)["reservationId"]
    assert value("select count(*) from qa_vt_requests") == 2
    reset()
    print("PASS real lock wait and synthetic tracked caller drain before admission")
    timeout = sql("begin;set local transaction_timeout='100ms';select pg_sleep(.5);commit", role=None, check=False)
    assert timeout.returncode and "transaction timeout" in timeout.stderr
    assert not value("select exists(select 1 from pg_stat_activity where datname=current_database() and state='idle in transaction')", role=None)
    print("PASS PostgreSQL17 transaction timeout terminates its backend")
    # Every path uses the same global cap, including direct invoker requests.
    rows = parallel([reserve()] * 8)
    assert all(r.returncode == 0 for r in rows), [r.stderr for r in rows]
    replies = [json.loads(r.stdout) for r in rows]
    assert sum(bool(r["reservationId"]) for r in replies) == 4
    deadline = value("select to_json(min(reserved_at)+interval '60 seconds') from qa_vt_requests")
    assert all(r["reservationId"] or r["retryAt"] == deadline for r in replies)
    assert value("select count(*) from qa_vt_requests") == 4
    print("PASS concurrent global four-per-minute admission with exact retry deadline")
    reset()
    sql("insert into qa_vt_requests(sha256,operation,reserved_at) select repeat('a',64),'hash_lookup',now()-interval '2 hours' from generate_series(1,450)")
    denied_reply = value(reserve(), "service_role")
    assert denied_reply["reservationId"] is None
    assert denied_reply["retryAt"] == value("select to_json(min(reserved_at)+interval '24 hours') from qa_vt_requests")
    assert value("select count(*) from qa_vt_requests") == 450
    sql("update qa_vt_requests set reserved_at=now()-interval '25 hours'")
    assert value(reserve(), "service_role")["reservationId"]
    print("PASS rolling daily cap and expiry without quota refunds")
    reset()
    candidate()
    request = "select reserve_qa_vt_candidate_request('local-fixture-only','" + CID + "','" + HASH + "','hash_lookup')"
    rows = parallel([request] * 3)
    assert sum(r.returncode == 0 for r in rows) == 2
    assert sum("lookup budget exhausted" in r.stderr for r in rows) == 1
    assert value("select count(*) from qa_vt_requests") == 2
    denied(request.replace(SECRET, "wrong"), "authentication")
    print("PASS concurrent candidate allowance and authentication")
    sql("insert into qa_vt_submission_intents(sha256,candidate_id,winget_id,version,architecture,manifest_installer_url,execution_installer_url,preflight_cache_key,verified_at) values('" + HASH + "','" + CID + "','Fixture.App','1','x64','https://example.invalid/installer','https://example.invalid/installer','synthetic',now())")
    sql("update qa_vt_submission_intents i set dispatch_started_at=c.dispatched_at,dispatch_attempt=c.attempts,"
        "profile_sha256=c.package_profile_sha256,github_run_id=c.github_run_id from qa_candidates c where c.id=i.candidate_id")
    sql("update qa_candidates set status='error',finished_at=now() where id=" + literal(CID))
    selected = value("select claim_qa_vt_metadata_recheck('local-fixture-only')", "service_role")
    assert selected["stop"] == "no_eligible_work" and selected["nextSubmission"]["candidateId"] == CID
    # The terminal phase has its own bounded allowance after the two in-run
    # requests. A caller must attest an actual provider404 for this exact slot.
    denied(request.replace("'hash_lookup'", "'upload_url'"), "provider404")
    proof_request = value(request, "service_role")["reservationId"]
    sql("select record_qa_vt_submission_analysis('local-fixture-only','" + CID + "','" + HASH + "','" + proof_request + "','not_found')", "service_role")
    denied("select record_qa_vt_submission_analysis('local-fixture-only','" + CID + "','" + HASH + "','" + proof_request + "','not_found')", "reservation")
    upload = request.replace("'hash_lookup'", "'upload_url'")
    rows = parallel([upload] * 2)
    assert sum(r.returncode == 0 for r in rows) == 1
    assert any("already reserved or stale" in r.stderr for r in rows)
    assert value("select count(*) from qa_vt_requests") == 4
    print("PASS concurrent upload URL reservation deduplication (synthetic intent only)")
    # Advance the synthetic request timestamps past the minute window without
    # refunding or deleting any reservation, so the fifth total slot can run.
    sql("update qa_vt_requests set reserved_at=reserved_at-interval '2 minutes'")
    assert value(upload.replace("'upload_url'", "'upload'"), "service_role")["reservationId"]
    sql("select record_qa_vt_submission_analysis('local-fixture-only','" + CID + "','" + HASH + "',null,'ambiguous')", "service_role")
    denied(upload, "admission rejected")
    assert value("select count(*) from qa_vt_requests") == 5
    print("PASS exact terminal dispatch selection and ambiguous submission without retry or refund")
    reset()
    candidate(status="error")
    sql("insert into qa_vt_submission_intents(sha256,candidate_id,winget_id,version,architecture,manifest_installer_url,execution_installer_url,preflight_cache_key,verified_at,dispatch_started_at,dispatch_attempt,profile_sha256,github_run_id) select lower(installer_sha256),id,winget_id,version,architecture,installer_url,installer_url,'synthetic',now(),dispatched_at,attempts,package_profile_sha256,github_run_id from qa_candidates where id=" + literal(CID))
    terminal_request = value(request, "service_role")["reservationId"]
    completion = "select complete_qa_vt_metadata_recheck('local-fixture-only','" + terminal_request + "',200,null,0,0,60,now())"
    rows = parallel([completion] * 2)
    assert sum(r.returncode == 0 for r in rows) == 1
    assert any("reservation rejected" in r.stderr for r in rows)
    assert value("select response_recorded_at is not null from qa_vt_requests")
    assert value("select status='found' and total_engines=60 and engine_count_version=2 from catalog_file_reputation where sha256=" + literal(HASH))
    assert value("select malicious_verdicts=3 and released_at is null from qa_installer_security_holds where sha256=repeat('f',64)")
    sql("delete from catalog_file_reputation where sha256=" + literal(HASH))
    print("PASS concurrent terminal completion is once-only and preserves security holds")
    # Daily hold lease and metadata claims use that same admission ledger.
    reset()
    candidate()
    sql("update qa_installer_security_holds set recheck_lease='" + LEASE + "',recheck_lease_expires_at=now()+interval '2 minutes' where sha256=repeat('f',64)")
    daily = "select reserve_qa_vt_candidate_request('local-fixture-only','" + CID + "',repeat('f',64),'hash_lookup','" + LEASE + "')"
    rows = parallel([daily] * 2)
    assert sum(r.returncode == 0 for r in rows) == 1
    assert any("recheck lease rejected" in r.stderr for r in rows)
    candidate(MID, "error", "c" * 64)
    sql("insert into qa_vt_metadata_rechecks(candidate_id,sha256,profile_sha256,run_id,first_queued_at,retry_at) values('" + MID + "',repeat('c',64),'" + PROFILE + "','12345',now(),now()-interval '1 second')")
    claim = "select claim_qa_vt_metadata_recheck('local-fixture-only')"
    rows = parallel([claim] * 2)
    assert all(r.returncode == 0 for r in rows)
    replies = [json.loads(r.stdout) for r in rows]
    leased = [r for r in replies if r.get("lease")]
    assert len(leased) == 1 and any(r.get("stop") == "no_eligible_work" for r in replies)
    assert value("select count(*) from qa_vt_requests") == 2
    assert all(r.returncode == 0 for r in parallel([request] * 2))
    assert value("select count(*) from qa_vt_requests") == 4
    assert value(reserve(), "service_role")["reservationId"] is None
    sql("update qa_vt_metadata_rechecks set lease_expires_at=now()-interval '1 second'")
    lease = leased[0]["lease"]
    denied("select complete_qa_vt_metadata_recheck('local-fixture-only','" + lease + "',200,null,0,0,60,now())", "lease")
    sql("select complete_qa_vt_metadata_recheck('local-fixture-only','" + lease + "',429,now()+interval '9 days')", "service_role")
    assert value("select blocked_until>now()+interval '8 days' from qa_vt_request_budget")
    assert value("select retry_at>now()+interval '8 days' from qa_vt_metadata_rechecks")
    assert sql("select row_to_json(h) from qa_installer_security_holds h").stdout != ""
    assert value("select malicious_verdicts=3 and released_at is null from qa_installer_security_holds where sha256=repeat('f',64)")
    print("PASS daily lease dedupe, concurrent metadata claim and late429 deferral without security release")
    for role in ("anon", "authenticated"):
        denied("select * from qa_vt_requests", "permission denied for table", role)
    for statement in ("blocked_until=null", "blocked_until=now()", "metering_started_at=now()", "id=false"):
        denied("update qa_vt_request_budget set " + statement, "may only be extended")
    for statement in ("delete from qa_vt_requests", "truncate qa_vt_requests", "update qa_vt_requests set reserved_at=now()"):
        denied(statement, "permission denied for table")
    stats = value("select qa_vt_request_stats('local-fixture-only')", "service_role")
    assert stats["meteredReservationsOnly"] is True
    assert stats["untrackedBefore"] == value("select to_json(metering_started_at) from qa_vt_request_budget")
    print("PASS nonowner ACL, monotonic hold and honest metering boundary")
    print("LIMIT: CI cannot observe unmetered production callers; fresh live S3 caller-drain proof remains required.")


def main():
    if not re.fullmatch(r"[a-f0-9]{12,64}", CONTAINER):
        raise ValueError("Only the Actions PostgreSQL service container ID is accepted")
    # No published ports, production endpoint, repository credential or host PG.
    inspect = subprocess.run(["docker", "inspect", "--format", "{{json .HostConfig.PortBindings}}", CONTAINER],
                             capture_output=True, text=True, check=True, env=ENV, timeout=10)
    assert json.loads(inspect.stdout) in (None, {})
    sql("create role fixture_owner nosuperuser nocreatedb nocreaterole noinherit;create role anon;create role authenticated;create role service_role bypassrls;create database " + DB + " owner fixture_owner", role=None, database="postgres")
    try:
        sql("create schema extensions authorization fixture_owner;create extension pgcrypto with schema extensions", role=None)
        contracts()
    finally:
        sql("select pg_terminate_backend(pid) from pg_stat_activity where datname=" + literal(DB) + " and pid<>pg_backend_pid();drop database " + DB + " with (force)", role=None, database="postgres")


if __name__ == "__main__":
    main()
