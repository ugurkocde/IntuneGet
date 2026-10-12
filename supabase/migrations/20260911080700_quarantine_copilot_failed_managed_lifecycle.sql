-- Exact-payload containment for candidate 4a5328ee-dd82-4605-ab96-abcb7d30af8b.
-- Run 34576597565: user-context PSADT 4.1.8, packager
-- 0ff16a2420976f28a232ad1c015c8023f805fbb3, tuple -2002583501/1/60001/1.
-- The vendor process failed and no exact uninstall registration was found.
-- Microsoft documents elevated device provisioning for --quiet --start -p:
-- https://learn.microsoft.com/en-us/microsoft-365/copilot/deploy-microsoft-365-copilot-app
-- The precise vendor exit cause remains unverified. Do not guess a scope-only
-- repair without a verified package identity and managed removal contract.
-- This is a compatibility quarantine, not a security finding (VT 0/0).
-- Shared QA demand and customer packaging both enforce this immutable tuple.
-- New versions/hashes remain eligible. Release only after controlled retest.
insert into public.qa_package_blocks (
  winget_id, version, architecture, installer_sha256, block_code, detail
) values (
  'Microsoft.365Copilot', '19.2609.33020.0', 'x64',
  '7B2A6D88E87F068E8775D1DE267EE932914F430BFA054A2012DEC43FA279E61A',
  'failed_managed_lifecycle',
  'Reviewed compatibility quarantine: isolated PSADT run 34576597565 returned -2002583501/1/60001/1 in user context. Device-provisioning switches were invoked without elevation; vendor exit cause remains unverified and no exact uninstall registration was found. Requires reviewed install scope, exact package identity, managed removal and controlled retest before release. VirusTotal was clean (0/0).'
)
on conflict (winget_id, version, architecture, installer_sha256) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    updated_at = now();
