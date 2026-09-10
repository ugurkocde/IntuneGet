# PostgreSQL 16 removal repair

Production auto-paused on candidate `42c342f8-7013-4fdd-942b-a5f4d3afd2a5`, run `34465115340`, PostgreSQL.PostgreSQL.16 16.15-3 x64. Initial fresh state: zero active, 193 queued; required and scheduler pin `a27749fb895eaa142da413bb6b4b9ebaa5477ad4`.

The exact installer SHA is `5AE62E39571AAD71256AC20F769C01B6415E5DBB69A76B44EC643A42037FE45D`. Install/detect/uninstall/removal was `0/0/60001/0`, under LocalSystem, VT 0/0. The registered uninstaller was invoked with the existing unattended arguments. The five-minute completion deadline expired while exact registration `PostgreSQL 16` remained. The service and many installed files were removed by the vendor. Previous 16.15-1 passed in run 34412334941 with an uninstall duration near 280 seconds.

Hypothesis: the generic five-minute deadline is too short for the vendor's bundled component removal. Give the existing versioned PostgreSQL adapter fifteen minutes, keeping exact registration verification and fail-closed marker handling. A retry of the exact failing tuple is required; this change alone does not establish a pass.

Primary references: https://www.enterprisedb.com/docs/supported-open-source/postgresql/uninstalling/ and https://releases.installbuilder.com/installbuilder/docs/installbuilder-userguide/_uninstaller.html . No host installer execution or protected runner directory access was performed. The optional local diagnostic was inaccessible; bounded sanitized GitHub PSADT evidence supplied the exception and invocation.

The legacy status helper reports 186/500 for boundary 2026-08-30T08:28:35Z but does not independently enforce all strict-result predicates. Do not certify that number without the strict evidence audit. Keep production paused until protected promotion, aligned fresh pins, and an isolated exact-tuple retry are ready.
