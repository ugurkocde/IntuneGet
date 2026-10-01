# Bandizip 7.46 unattended removal repair

Production candidate `576e2e12-c574-4b05-b4ae-9effe4041b2e`, run
`36865335245`, tested x64 payload SHA-256
`D6D6489113C013ED7F44C0DCA24B1A882494ACE246E14D10533C4969A0F41CFE`.
LocalSystem PSADT returned `0/0/60001/0`. Logs show the exact registered
`C:\Program Files\Bandizip\Uninstall.exe` was executed without arguments;
registration `Bandizip` remained through the bounded deadline.

Bandisoft documents `Uninstall.exe /S` for unattended removal:
https://en.bandisoft.com/bandizip/help/uninstall/
Its installer has been vendor-specific since v6:
https://www.bandisoft.com/bandizip/help/setup_parameter/

The exact-ID shared adapter supplies `/S` through the existing reviewed
uninstall argument contract. QA normalization and customer GitHub Actions use
the same adapter. Exact registration, hash, security, and removal verification
remain authoritative. No host installer execution or vendor cleanup is needed.

Release requires protected CI, deployment, fresh aligned scheduler pins, and
a controlled retry of this exact payload. The failure never counts toward the
500-app cohort (boundary `2026-08-30T08:28:35Z`).
