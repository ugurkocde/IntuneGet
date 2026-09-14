# WireSock CLI identity repair

Failed candidate: `8a466569-da87-47fb-b9f5-cfd7208eb340`,
`NTKERNEL.WireSockVPNClientCLI` 3.6.1 x64, run `34838391079`.
Production auto-paused with zero active lifecycles, confirmed 2026-09-14 11:41 UTC.

The exact manifest installer SHA is
`BDB676263FFFA4E36EC6B51155A8AFE2AC6D5680DC6D22008DE9C75C8F533ECC`.
The failed QA/customer packager pin was
`9e51c9ab6cc3a28346f13266e566c9896fa4101b`.
VirusTotal was 0 malicious / 0 suspicious. The vendor installer returned 0;
PSADT then refused to capture an identity because the catalog calls the product
WireSock Secure Connect CLI while the visible registration is WireSock Secure
Connect SDK. Hidden SDK and kernel-driver MSI registrations and an unrelated
Edge update were also observed. The failure tuple was 60001/1/60001/1.

Official sources:
- https://github.com/microsoft/winget-pkgs/blob/master/manifests/n/NTKERNEL/WireSockVPNClientCLI/3.6.1/NTKERNEL.WireSockVPNClientCLI.installer.yaml
- https://www.wiresock.net/documentation/wiresock-secure-connect/sdk-overview.html

The shared application adapter binds the exact SDK display identity and enables
the existing single-visible-registration selection rule. It retains the exact
captured vendor uninstall command and all hash, reputation, removal, and
ambiguity checks. No installer is downloaded or executed on the host.

Validation covers adapter isolation, catalog normalization, canonical QA
profile, customer workflow payload, and executable generated-PowerShell
selection of the observed delta with ambiguous/unrelated negative cases.
Local full suite: 1,894 passed; the unrelated Unix-shell translation mock timed
out on Windows. Lint: zero errors, one existing SCCM navigation warning.
Protected CI and production activation are required before retry.

Recovery sequence: merge repair; activate its full SHA in website and QA/customer
workflows; add only WireSock to targeted retries while preserving existing
targets; deploy; update guarded required pin with zero active lifecycles;
supersede only undispatched old-pin rows; enqueue; verify fresh equal pins;
prioritize exact WireSock retry; guarded resume and dispatch one lifecycle.
General queue must wait for strict retry evidence or a deterministic shared block.

Cohort boundary remains `2026-08-30T08:28:35Z`. The status script reports 283
candidate-status passes; an evidence join using exact current pin, hashes,
0/0/0/1, LocalSystem, clean VirusTotal, and conservative exclusion of prior
passes yielded 26. Do not report 500 or create the milestone on that evidence.
