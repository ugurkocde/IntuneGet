# Docker release completion

A Docker release is complete only when its reviewed source, tag, verified image and published GitHub Release all match. A tag or image alone does not notify people who follow GitHub Releases.

## Required checklist

1. Merge the version and release notes through the normal source review, CI, CLA and coordination gates. Record the exact merge commit and wait for its required main CI to succeed.
2. Use the existing authorized App release path to create the version tag at that exact commit. Never move or recreate a published tag.
3. Verify the release workflow on that tag. Require both native image builds, SQLite initialization, persistence and upgrade checks, the vulnerability scan, exact digest signing, stable image promotion and final artifact gates to succeed. Record the image digest and workflow run link.
4. Publish the GitHub Release through the existing UgurLabs Agent App path on the existing tag. The release workflow builds and verifies the image; it does not create the GitHub Release object. Use the reviewed release notes from the tagged commit and include the image tag, verified digest and workflow run link. Follow the existing server release convention for the title, prerelease flag and Latest designation. Do not create another tag or rerun the image workflow to publish the release object.
5. Read the GitHub Release back by its exact tag. Confirm it exists, is not a draft, has the expected title and body, has the intended prerelease and Latest settings, and targets the same commit as the tag and verified image. Record its URL and publication time. If this readback fails, keep publication incomplete even when the image is available.
6. Only after all four artifacts agree, mark the release complete, provide customer upgrade instructions and close issues whose complete fixes are waiting only for that release. Backups and existing data volumes must be preserved. Publication does not establish customer deployment or device installation success.

For a stable server release such as `v0.8.6`, the convention is the title `IntuneGet v0.8.6`, `prerelease=false` and Latest. Packager releases have their own process.

## Interrupted publication

If the tag and verified image exist but the GitHub Release is missing, resume only the App publication step on that tag. Reuse the recorded source, notes, image digest and successful run. If a draft already exists, reconcile that draft instead of creating a duplicate. If a public release already exists, verify it before any retry. Preserve the existing credential permissions and every source and image gate.
