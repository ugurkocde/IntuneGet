# Product changelog

IntuneGet uses the central Ugurlabs changelog configured in `.ugurlabs/changelog.json`.
Use the global `publish-changelog` skill when onboarding or completing an authorized public product update. If the skill is unavailable, report that limitation instead of inventing an API or publishing process.

`publishMode: "on-completion"` guides agent work. This repository additionally runs `.github/workflows/publish-changelog.yml` after all push CI jobs succeed on `main`. It registers the product if needed and publishes reviewed JSON files in `.ugurlabs/entries/`. PR checks only validate entries and never publish them.

## What belongs in the changelog

The changelog announces IntuneGet itself: features, workflow, UI, QA platform behavior, performance, and reliability changes that every user experiences. Most PRs do not qualify and must not add an entry file.

Never add an entry for work that concerns a single catalog application, even when the fix is important for that application. This includes packaging adapters, detection or uninstall identity, silent or unattended removal arguments, QA quarantines, version holds, deployment availability, icons, and catalog metadata. Those changes are routine catalog maintenance, and a PR title that names an application or a version is the signal that no entry belongs in it. A fix to shared packaging logic that changes behavior for a whole class of installers may qualify; name the class, not an application, in the title.

Validation rejects entries whose title or summary reads like a single-application fix. Do not reword an application-specific entry to get past validation; remove it.

For a qualifying product change, add a uniquely named entry JSON file with `title`, `summary`, `type` (`new`, `improved`, `fixed`, or `maintenance`), and optionally a public `sourceUrl`. Describe the practical user impact. Never edit or rename a published file; add a new file for a later announcement or correction. The publisher derives a stable product-scoped key, source commit, and date from each file's introducing commit. Reruns do not duplicate entries. A PR without an entry file creates no new announcement.

Run `node scripts/publish-changelog.mjs --validate` before committing. Verify the **Publish changelog** workflow and public feed after merging. If the service is temporarily unavailable, rerun the failed workflow with the same files and keys. The repository Actions secret `CHANGELOG_PUBLISH_TOKEN` must match the central service's publisher credential. Do not publish pending PR changes manually through the global skill.

The navigation bell reads the public API without credentials. Keep publisher tokens out of this repository and browser bundles. Preserve full-screen mobile behavior, keyboard access, the current design system, and entry titles without change-type labels.
