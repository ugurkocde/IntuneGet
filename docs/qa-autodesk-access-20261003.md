# Autodesk Access exact-payload compatibility hold

- Candidate: b913e63b-2a44-4b8e-bdd3-3fc4fd040aac; failed run: https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/37143458620.
- Exact tuple: Autodesk.AutodeskAccess 2.24.0.519 x64, SHA256 21DC225CD486CB56DBCDE7FB52B70D466C8E16C76FA08E1590CA0E2017FBCB33.
- Packager: 60395492a3d51b2ff6f14b50ed7cd0c7f558be70; profile SHA256: 18DDC8DAEC0ACF4E3BF6352D0099BB043DD28B5EB6DD5900F0F1DB0470CB58A5.
- LocalSystem PSADT tuple: 0/-1/0/1. Post-install detection stalled for 271.805 seconds. This is failed evidence, never strict coverage.
- Bounded job logs show successful installation, exact ODIS identity `{A3158B3E-5F28-358A-BF1A-9532D8EBC811}` capture, reviewed `-q` uninstall, registration disappearance, and marker removal. The evidence does not establish an installer-switch or uninstall defect. Detection timeout root cause remains unresolved.
- Compact VirusTotal verdict was `not_found`; do not describe it as clean or malicious. Strict coverage still requires 0/0.
- Official ODIS reference supports the adapter's existing silent switch: https://www.autodesk.com/support/technical/article/caas/sfdcarticles/sfdcarticles/Which-silent-command-line-should-be-used-with-the-2022-Autodesk-versions.html.
- The existing shared compatibility gate denies only the exact tuple to customer package requests and QA demand/enqueue/dispatch. Other hashes and versions remain independent. Preserve the failed row; supersede only undispatched queued duplicates.
- Release requires reviewed remediation or a verified transient infrastructure remedy followed by a controlled exact-version/architecture/hash strict retest, including clean VirusTotal evidence. No speculative switch, detection, timeout, or packager-pin change.
