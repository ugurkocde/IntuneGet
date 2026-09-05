# Product changelog

IntuneGet uses the central Ugurlabs changelog configured in `.ugurlabs/changelog.json`.
Use the global `publish-changelog` skill when onboarding or completing an authorized public product update. If the skill is unavailable, report that limitation instead of inventing an API or publishing process.

`publishMode: "on-completion"` guides agent work. This repository additionally runs `.github/workflows/publish-changelog.yml` after all push CI jobs succeed on `main`. It registers the product if needed and publishes reviewed JSON files in `.ugurlabs/entries/`. PR checks only validate entries and never publish them.

For a public product change, add a uniquely named entry JSON file with `title`, `summary`, `type` (`new`, `improved`, `fixed`, or `maintenance`), and optionally a public `sourceUrl`. Describe the practical user impact. Keep published files and their names immutable; add a new file for a later announcement or correction. The publisher derives a stable product-scoped key, source commit, and date from each file's introducing commit. Reruns do not duplicate entries. A PR without an entry file creates no new announcement.

Run `node scripts/publish-changelog.mjs --validate` before committing. Verify the **Publish changelog** workflow and public feed after merging. If the service is temporarily unavailable, rerun the failed workflow with the same files and keys. The repository Actions secret `CHANGELOG_PUBLISH_TOKEN` must match the central service's publisher credential. Do not publish pending PR changes manually through the global skill.

The navigation bell reads the public API without credentials. Keep publisher tokens out of this repository and browser bundles. Preserve full-screen mobile behavior, keyboard access, the current design system, and entry titles without change-type labels.
