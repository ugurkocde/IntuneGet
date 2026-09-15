# MTGA Launcher exact-release quarantine

Candidate `a6585ee0-5180-44dd-9954-91bf3de0c423`, version `1.0.124`, x64,
failed in [run 34919218964](https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/34919218964).
Fresh production and GitHub evidence confirmed auto-pause and zero active
lifecycles. The failed tuple is `0/1/60001/1`, under LocalSystem and PSADT 4.1.8.
Installer SHA: `96C64E5E0CD4D5758F3C9AE1AF7A2C6FFCF4782E273AEDE28FA92B8E63FFC368`.
Profile SHA: `034068E20C82461D7205C82B3BD703BB7465B203D7D7231D0157E9A74721914A`.
Shared pin: `ada1a8a5d1ad0ae9ad953306a6b528c71479a803`. VirusTotal: `0/0`.

The [official WinGet manifest](https://github.com/microsoft/winget-pkgs/blob/master/manifests/w/WizardsoftheCoast/MTGALauncher/1.0.124/WizardsoftheCoast.MTGALauncher.installer.yaml)
specifies `/quiet` and product `{BB91E8E1-8030-43C7-8461-1E54166F3AAB}`.
Bounded sanitized GitHub diagnostic tails instead show `MTG Arena`, publisher
`Wizards of the Coast`, version `0.1.14123`, MSI product
`{4FEB5AFD-9404-4F46-86D3-27057B012FC7}`, alongside Microsoft prerequisites.
Zero changed registrations matched the configured launcher identity. The
generated package threw during capture, wrote no successful detection marker,
and refused broad uninstall. Install exit 0 alone is not lifecycle success.

The [vendor troubleshooting guide](https://mtgarena-support.wizards.com/hc/en-us/articles/360038311692-Can-t-Install-or-Update-MTG-Arena-on-PC)
describes the game and interactive recovery; it does not establish a stable
mapping from this launcher version to the observed game MSI. A name-only
adapter or hardcoded game ProductCode would not establish the requested exact
launcher lifecycle. No installer was downloaded or executed on the host.
The local diagnostic file was inaccessible; GitHub published the bounded
sanitized evidence needed for containment.

Resolution: exact tuple `failed_managed_lifecycle` quarantine through existing
shared QA demand and customer packaging gates. Preserve the failed result and
all security evidence. Other releases remain eligible. Release this tuple only
after a reviewed product/version contract and a controlled strict retest.
No executable adapter, generator, profile, workflow or packager pin changes.
Tests cover normalized demand refusal and customer dispatch refusal even with
QA override. The migration supersedes only matching never-dispatched queue rows.

At diagnosis the immutable boundary was `2026-08-30T08:28:35Z`; the strict
current-pin count was 12, while the broader status-only count was 301. No
milestone record is warranted. Resume only after the protected migration is
applied, the exact block is verified, pins match with a fresh heartbeat, and
active lifecycle count remains zero.
