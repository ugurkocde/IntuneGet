-- The approved Adobe Defender pilot must never upload these bytes to VT.
-- This is only a refusal: it neither admits a scan nor changes any hold.
do $migration$
declare
  target regprocedure := 'public.reserve_qa_vt_candidate_request(text,uuid,text,text,uuid)'::regprocedure;
  source text := pg_get_functiondef(target);
  needle text := $anchor$  elsif p_operation='hash_lookup' then$anchor$;
  guard text := $guard$  elsif p_operation in ('upload_url','upload')
    and p_sha256='7bec66953457f6bc78bce9f0a1dcdde1c4cf2a8f8ac26f73fcecf5738f42f307' then
    return jsonb_build_object('stop','defender_pilot_no_upload');
$guard$;
  before_properties jsonb;
  after_properties jsonb;
begin
  if encode(extensions.digest(source,'sha256'),'hex') <>
    'cd14fa085865af02c1b5f3b0ac1401352f2297ff26a6204d3e92d3f74b236602' then
    raise exception 'Defender upload refusal source pin mismatch';
  end if;
  if (length(source)-length(replace(source,needle,'')))/length(needle) <> 1 then
    raise exception 'Defender upload refusal anchor mismatch';
  end if;
  select jsonb_build_array(proowner,proacl::text,prosecdef,proconfig,provolatile)
    into before_properties from pg_proc where oid=target;
  execute replace(source,needle,guard||needle);
  select jsonb_build_array(proowner,proacl::text,prosecdef,proconfig,provolatile)
    into after_properties from pg_proc where oid=target;
  if after_properties is distinct from before_properties
    or replace(pg_get_functiondef(target),guard,'') is distinct from source then
    raise exception 'Defender upload refusal changed unrelated function properties';
  end if;
end;
$migration$;
