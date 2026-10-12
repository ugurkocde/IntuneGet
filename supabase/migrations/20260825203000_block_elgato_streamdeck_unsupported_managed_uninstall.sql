-- Elgato Stream Deck 7.5.1 installs silently and is detected correctly, but
-- its exact MSI product-code removal repeatedly stalls in the vendor
-- CloseApplication custom action under LocalSystem. Five isolated PSADT runs
-- reproduced the same installed-after-uninstall result. Two reviewed,
-- command-line-scoped process guards also failed to unblock the MSI, including
-- a bounded five-minute creation lookback. Elgato documents closing Stream
-- Deck before uninstall, but does not publish a reliable unattended removal
-- contract for this lifecycle. Do not ship an Intune package that cannot be
-- removed deterministically.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'Elgato.StreamDeck',
  'unsupported_managed_uninstall',
  'Stream Deck installs and detects successfully, but its exact MSI removal stalled in the vendor CloseApplication custom action in five isolated LocalSystem lifecycle runs. Two reviewed process guards, including an exact bounded five-minute lookback, did not unblock removal, and the application remained detected after every attempt.',
  'https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/32882785478'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'Elgato.StreamDeck';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Elgato.StreamDeck'
  and status in ('queued', 'failed', 'error');
