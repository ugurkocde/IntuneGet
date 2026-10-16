-- An unknown hold is an observation time, not the date of a clean verdict.
-- Covered positive evidence may strengthen it even with an older analysis.
-- Keep its existing release floor so stale clean evidence cannot release it.
do $migration$
declare original text; definition text; anchor text;
begin
  original := replace(pg_get_functiondef('public.hold_flagged_qa_reputation()'::regprocedure),E'\r\n',E'\n');
  anchor := 'verdict_at = excluded.verdict_at';
  if length(original)-length(replace(original,anchor,'')) <> length(anchor) then
    raise exception 'QA positive hold verdict anchor changed';
  end if;
  definition := replace(original,anchor,'verdict_at = greatest(qa_installer_security_holds.verdict_at,excluded.verdict_at)');
  anchor := 'where excluded.verdict_at >= qa_installer_security_holds.verdict_at';
  if length(definition)-length(replace(definition,anchor,'')) <> length(anchor) then
    raise exception 'QA positive hold ordering anchor changed';
  end if;
  definition := replace(definition,anchor,$guard$where (excluded.verdict_at >= qa_installer_security_holds.verdict_at
    or (qa_installer_security_holds.malicious_verdicts = 0
      and qa_installer_security_holds.released_at is null
      and new.malicious between 1 and 9999 and new.suspicious between 0 and 9999
      and new.total_engines between 1 and 9999
      and new.malicious::bigint+new.suspicious::bigint <= new.total_engines))$guard$);
  execute definition;

  original := replace(pg_get_functiondef('public.complete_qa_installer_security_recheck(text,text,uuid,integer,integer,integer,timestamp with time zone)'::regprocedure),E'\r\n',E'\n');
  anchor := 'if p_analyzed_at <= held.verdict_at then return false; end if;';
  if length(original)-length(replace(original,anchor,'')) <> length(anchor) then
    raise exception 'QA daily positive verdict anchor changed';
  end if;
  definition := replace(original,anchor,$guard$if held.malicious_verdicts = 0 and p_malicious > 0 then
    update public.qa_installer_security_holds set malicious_verdicts=p_malicious,
      verdict_at=greatest(verdict_at,p_analyzed_at) where sha256=p_sha256;
    update public.qa_candidates set next_retry_at=next_retry_at
      where lower(installer_sha256)=p_sha256 and status in ('queued','error');
  elsif p_analyzed_at <= held.verdict_at then return false;
  end if;$guard$);
  anchor := 'if not found then return false; end if;';
  if length(definition)-length(replace(definition,anchor,'')) <> length(anchor) then
    raise exception 'QA daily cache ordering anchor changed';
  end if;
  -- An older positive can strengthen the hold while a newer cache record is
  -- preserved. All existing authentication, lease and input checks precede it.
  definition := replace(definition,anchor,'if not found and not (held.malicious_verdicts = 0 and p_malicious > 0) then return false; end if;');
  execute definition;
end;
$migration$;
