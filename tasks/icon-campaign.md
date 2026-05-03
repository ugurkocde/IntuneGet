# Icon-Quality Campaign — Autonomous Drive Log

## Goal

Get >90% of curated apps to have an `icon-256.png` so the Intune Company
Portal renders a crisp logo on high-DPI displays. The upload step in
`package-intunewin.yml` walks `[256, 128]` and uses the first present.

## Code prerequisites that already shipped

- `b1478963` feat: extract icons from installer payload for EXE wrappers
  (7-Zip unpack-first, fall back to wrapper PE icon)
- `69afdd09` fix: count committed icons by directory, not by size filename
  (unblocks top-up commits that only write 256)
- `f78d9bd6` ci: bump web-icon job timeout to 60m
- `6c8011e3` ci: tolerate platform-specific lock drift in icon fetch step
- `f980f808` chore: regenerate package-lock.json
- `8cca2864` feat: add missing-sizes-only mode to icon extraction
- `be1ecdc2` feat: produce 256px app icons and prefer them on upload
- `f3dbe228` fix: load app icon from public/icons path

## Cumulative results so far

| Run                                            | Mode          | Tier          | Icons added |
|------------------------------------------------|---------------|---------------|-------------|
| `fab36837` (2k batch)                          | top-up        | web only      | 1752        |
| `1df59ea9` (scheduled mid-run)                 | default       | both          | ~17         |
| `f3da7489` (10k batch)                         | top-up        | web only      | 3792        |

Web tier is essentially exhausted (~5.5k apps now have 256). Remaining
~1k web-iconed apps don't have an upstream source we can pull from.

## Active campaign — binary tier

Targets ~4k apps with `icon_source LIKE 'binary_%'` that are missing
`icon-256.png`. The new payload extractor (b1478963) unpacks installer
EXEs with 7-Zip and finds the real app icon instead of the wrapper's
generic launcher icon.

### Iterations

- **Iter 0** — validation batch, 100 apps, run [`25276726479`](https://github.com/ugurkocde/IntuneGet/actions/runs/25276726479)
  - Mode: `missing_sizes_only=true`, `skip_binary=false`, `max_apps=100`
  - Started: 2026-05-03 10:30 UTC
  - Result: FAILED at npm ci (lockfile drift, same root cause as the web job had earlier — fix only applied to web step previously). Web step ran fine (no-op iteration). Binary step never started icon work.
  - Fix: commit `60c772d3` swaps the binary job's `npm ci` for `npm install --no-audit --no-fund` (same approach that already works for the web job).
- **Iter 0b** — retrigger after lockfile fix, 100 apps, run [`25276915188`](https://github.com/ugurkocde/IntuneGet/actions/runs/25276915188)
  - Mode: `missing_sizes_only=true`, `skip_binary=false`, `max_apps=100`
  - Started: 2026-05-03 10:39 UTC
  - Result: extraction succeeded (97 of 100 produced icons), commit succeeded locally (`b7fe0523` on the runner) but ALL 3 push retries failed with "cannot pull with rebase: You have unstaged changes". The 97 freshly-generated icon-256.png files were lost. Two underlying bugs: (a) commit-step rebase didn't autostash transient unstaged changes (CRLF normalization on apps-to-process.json + husky pre-commit artifacts); (b) extract-icon.ps1 left icon-original.* intermediate files behind when Convert-ToMultipleSizes returned 0 generated files (which happens on every top-up app whose source is already covered by existing sizes), so those orphans got staged and the script falsely exited 1.
  - Fix: commit `fa698b54` adds `--autostash` to pull-rebase, always cleans up icon-original.* intermediate, treats top-up "0 generated" as success, and prunes 34 pre-existing orphan icon-original.* files from the repo.
- **Iter 1** — retrigger after autostash + cleanup fix, 100 apps, run [`25277293744`](https://github.com/ugurkocde/IntuneGet/actions/runs/25277293744)
  - Mode: `missing_sizes_only=true`, `skip_binary=false`, `max_apps=100`
  - Started: 2026-05-03 10:58 UTC
  - Result: SUCCESS. Bot commit `e3855c10` added 56 `icon-256.png` files, zero modifications, zero orphans. Workflow reported 96 extracted / 4 failed; the gap (96 - 56 = 40) is apps whose source icon was <= 128 px (skipped to avoid upscaling). Both fixes from `fa698b54` worked: autostash kept the push alive, and no `icon-original.*` orphans leaked.
  - Yield rate: ~56% of processed apps get a new 256. Full binary tier (~4k apps) will likely plateau at ~2200 256s, not 3600+. Realistic ceiling for the >90% goal is unreachable via payload extraction alone -- the remaining apps simply don't have a high-res source in their installer payload.

## Revised stop strategy

Original stop condition was "cumulative binary icons >= 3600". Adjust to:
"keep running until the workflow returns 0 eligible apps to process,
indicating the binary tier is exhausted". When that fires, write a final
summary documenting the realistic ceiling and recommend follow-up
avenues (Microsoft Store API, og:image scraping, manual curation) for
the apps that don't have an upstream high-res source.

- **Iter 2** — bump batch size to 500, run [`25277634001`](https://github.com/ugurkocde/IntuneGet/actions/runs/25277634001)
  - Mode: `missing_sizes_only=true`, `skip_binary=false`, `max_apps=500`
  - Started: 2026-05-03 11:14 UTC, finished extraction 12:07 UTC (~52 min for 444 processed = ~7s/app)
  - Result: SUCCESS. Bot commit `244744b1` added 229 `icon-256.png`, all additions, zero orphans. Workflow reported 429 extracted / 15 failed (the 56-app gap to 500 max is apps filtered out by `icon_extraction_attempts >= 3` from prior failures).
  - Yield: 229/444 = ~52% (consistent with Iter 1's 56%)
- **Iter 3** — same params, run [`25278759709`](https://github.com/ugurkocde/IntuneGet/actions/runs/25278759709)
  - Mode: `missing_sizes_only=true`, `skip_binary=false`, `max_apps=500`
  - Started: 2026-05-03 12:08 UTC (queued by concurrency group; will run after Iter 2 fully exits)

## Cumulative binary 256s after each iter

- Iter 1: 56
- Iter 2: +229 = 285 cumulative
- Iter 3: +0 = 285 cumulative (see diagnosis below)

## Iter 3 diagnosis (run 25278759709) and pagination fix

Iter 3 reported 200 "extracted" but produced 0 new icon-256.png. Root
cause: the supabase query for missing_sizes_only had no ORDER BY and used
.limit(maxApps), so Postgres returned the same heap-order rows on every
call. Iter 2's 229 successes graduated out of the eligible set via the
disk filter, but the remaining 215 apps in that fixed window have source
icons < 256 px and can never produce an icon-256.png. They keep getting
re-queried every iteration.

Fix: commit `a87da7b1` adds ORDER BY winget_id and switches the query to
.range(start_offset, start_offset + max_apps - 1). New `start_offset`
workflow input lets the autonomous loop walk through the binary tier
batch by batch.

## Pagination tracking (post-fix)

| Offset start | max_apps | Iter   |
|--------------|----------|--------|
| 0            | 500      | Iter 4 |
| 500          | 500      | Iter 5 |
| 1000         | 500      | Iter 6 |
| ...          | ...      | ...    |

After each iteration the autonomous loop bumps offset by max_apps. When
"Get apps to process" returns 0, the binary tier walk is done. Total
binary apps estimated at ~4000 = ~8 batches.

- **Iter 4** — first paginated run, offset=0, run [`25279588610`](https://github.com/ugurkocde/IntuneGet/actions/runs/25279588610)
  - Mode: `missing_sizes_only=true`, `skip_binary=false`, `max_apps=500`, `start_offset=0`
  - Started: 2026-05-03 12:47 UTC, finished 13:40 UTC (~52 min)
  - Result: SUCCESS. Bot commit `e1552ea3` added 145 `icon-256.png`, all additions. Workflow reported 356 extracted + 19 failed = 375 processed. Yield: 145/375 ≈ 39%.
  - Cumulative: 285 + 145 = 430.
  - Note: alphabetical ORDER BY winget_id covered different apps than the heap order; ~210 had low-res sources that couldn't produce 256.
- **Iter 5** — offset=500, run [`25280792555`](https://github.com/ugurkocde/IntuneGet/actions/runs/25280792555)
  - Mode: `missing_sizes_only=true`, `skip_binary=false`, `max_apps=500`, `start_offset=500`
  - Started: 2026-05-03 13:43 UTC, finished 14:21 UTC (~38 min)
  - Result: SUCCESS. Bot commit `9703876f` added 185 `icon-256.png`. Processed 431, yield 185/431 ≈ 43%.
  - Cumulative: 430 + 185 = 615.
- **Iter 6** — offset=1000, run [`25281712946`](https://github.com/ugurkocde/IntuneGet/actions/runs/25281712946)
  - Mode: `missing_sizes_only=true`, `skip_binary=false`, `max_apps=500`, `start_offset=1000`
  - Started: 2026-05-03 14:24 UTC, finished ~15:49 UTC
  - Result: SUCCESS. Bot commit `db6cb33d` added 222 `icon-256.png`. Processed 439, yield 222/439 ≈ 51%.
  - Cumulative: 615 + 222 = 837.
- **Iter 7** — offset=1500, run [`25283641142`](https://github.com/ugurkocde/IntuneGet/actions/runs/25283641142)
  - Mode: `missing_sizes_only=true`, `skip_binary=false`, `max_apps=500`, `start_offset=1500`
  - Started: 2026-05-03 15:49 UTC, finished ~16:28 UTC
  - Result: SUCCESS. Bot commit `a4b5d3f2` added 47 `icon-256.png`. **Processed only 95 apps** (vs 439 last batch) — sharp drop signals nearing end of binary tier. Yield 47/95 ≈ 49%.
  - Cumulative: 837 + 47 = 884.
  - Revised binary tier estimate: ~1700 apps total (not the original ~4000).
- **Iter 8** — offset=2000, run [`25284562235`](https://github.com/ugurkocde/IntuneGet/actions/runs/25284562235)
  - Mode: `missing_sizes_only=true`, `skip_binary=false`, `max_apps=500`, `start_offset=2000`
  - Started: 2026-05-03 16:29 UTC, finished 16:31 UTC (~2 min)
  - Result: "Processing 0 apps for binary icon extraction". Stop condition fired -- binary tier walk is complete.

## Campaign final summary

Stopped: 2026-05-03 16:31 UTC after Iter 8 returned 0 eligible apps.

### Coverage at final state

- Total curated app icon directories on disk: **11,996**
- Apps with `icon-256.png` (the size the Intune upload step prefers): **10,433**
- **Coverage: 87.0%** -- short of the 90% target, but close, and bounded by source-quality reality (many apps just don't have a >= 256 px source anywhere accessible).

### Per-iteration tally

| Iter | Offset | Processed | New 256s | Yield | Cumulative |
|------|--------|-----------|----------|-------|------------|
| 1    | --     | (heap)    |  56      | --    |  56        |
| 2    | --     | 444       | 229      | 52%   | 285        |
| 3    | --     | 215       |   0      |  0%   | 285        |
| 4    | 0      | 375       | 145      | 39%   | 430        |
| 5    | 500    | 431       | 185      | 43%   | 615        |
| 6    | 1000   | 439       | 222      | 51%   | 837        |
| 7    | 1500   |  95       |  47      | 49%   | 884        |
| 8    | 2000   |   0       |   0      | --    | 884        |

(Iter 1 used the original heap-order query before pagination was added; Iter 0b's
97 extracted icons were lost to the autostash bug and not recovered.)

Plus the web tier from before/during this campaign: 1749 + 17 + 3792 = 5558 web 256s
(some of those overlapped with subsequent web runs).

Net new icon-256.png additions across the whole effort (web + binary):
~6442 newly added since campaign start, taking total coverage from ~36% (pre-256 era)
to 87%.

### What's left (the ~1563 apps without 256)

These split into three buckets:
1. **Binary apps with low-res sources.** EXE installers whose payload icon
   tops out at 16/32/48/128 px. Convert-ToMultipleSizes correctly skips
   upscaling, leaving the existing 32/64/128 in place. The Intune upload
   step falls back to icon-128.png for these -- visible in the portal but
   slightly soft on high-DPI displays.
2. **Web apps where the upstream source 404s today.** Publishers whose
   GitHub account is gone, or favicon URLs that broke. The fetch-web-icons
   script logged ~1000 of these as `no_web_icon_available` across the
   campaign. They have no icon at all.
3. **Apps the binary job marked `icon_extraction_attempts >= 3`** from
   prior failures. The default-mode query filters them out; the
   missing-sizes-only query does too (only matches `has_icon=true`).

### Recommendations for closing the remaining ~13% gap

These need user authorization -- the autonomous loop did NOT touch them:

1. **`force_refresh=true` on the binary tier.** Re-extracts every binary
   app's icon from scratch using the new payload-extractor. Could improve
   visual quality even where size stays the same (better source than the
   old wrapper-PE icon). Cost: ~2-3 hours of Windows-runner CI per 500
   apps, multiplied across the binary tier.
2. **Microsoft Store API for store-published apps.** Returns CDN-hosted
   icons at multiple sizes. Could be a new tier in `fetch-web-icons.mjs`.
3. **Homepage `og:image` / `twitter:image` scraping.** Many apps' homepages
   ship a proper logo at 512+ as their social-card image.
4. **Wikipedia / Wikidata.** Popular apps usually have a high-res logo
   there.
5. **Manual curation** for the top-N most-deployed apps -- highest
   leverage per hour.

### Code changes shipped during the campaign

- `f3dbe228` fix: load app icon from public/icons path
- `be1ecdc2` feat: produce 256px app icons and prefer them on upload
- `8cca2864` feat: add missing-sizes-only mode to icon extraction
- `f980f808` chore: regenerate package-lock.json
- `6c8011e3` ci: tolerate platform-specific lock drift in icon fetch step (web)
- `b1478963` feat: extract icons from installer payload for EXE wrappers
- `60c772d3` ci: tolerate platform-specific lock drift in binary icon job
- `fa698b54` fix: stop losing icon commits to autostash conflicts and orphan files
- `a87da7b1` ci: add deterministic ordering + offset pagination to top-up query

Plus the corresponding edits in `IntuneGet-Workflows` (the active workflow repo).
