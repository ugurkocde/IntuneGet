-- Canonical QA reconciliation rewrites the mirrored catalog metadata and
-- enriches every exact package result in one atomic RPC. The payload has grown
-- beyond the anon role's three-second statement timeout (927 catalog rows and
-- 1,526 exact package rows at diagnosis), causing three consecutive 57014
-- failures after otherwise successful lifecycle runs.
--
-- Keep the broader anon role limit unchanged. This bounded override applies
-- only while the credential-validated, security-definer sync RPC executes and
-- automatically restores the caller setting when the function returns.

alter function public.sync_qa_results_v2(text, jsonb, jsonb, boolean)
  set statement_timeout = '30s';
