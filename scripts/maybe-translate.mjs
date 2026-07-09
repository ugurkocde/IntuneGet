// Run the General Translation CLI (`gt translate`) only when a GT API key is
// configured. The translated locale files in public/_gt are committed to the
// repo, so the app builds and runs with them out of the box. Self-hosters
// without a General Translation account can run `npm run build` directly: this
// wrapper skips translation instead of failing with "No API key found", which
// would otherwise abort the build (issue #116). Maintainers (and the hosted
// build) set GT_API_KEY, so translations are regenerated as before.
import { spawnSync } from 'node:child_process';

if (!process.env.GT_API_KEY) {
  console.log(
    '[build] GT_API_KEY not set - skipping translation. Using the committed ' +
      'translations in public/_gt (no General Translation account required).'
  );
  process.exit(0);
}

// gt is no longer a declared dependency (it pulled in a heavy native module,
// tree-sitter-python, that broke arm64 Docker builds). It is fetched on demand
// here via npx, pinned to the v2 major, and only runs when GT_API_KEY is set.
const result = spawnSync('npx -y gt@^2 translate --ignore-errors', {
  stdio: 'inherit',
  shell: true,
});

// Translation refreshes are best-effort during application builds. The CLI's
// --ignore-errors flag does not cover every provider failure (for example,
// account spend limits), so do not let an external translation outage block a
// deployment. Maintainers can still run `npm run translate` when they need a
// strict, standalone translation refresh. Committed translations remain the
// build fallback in every case.
if (result.error || result.status !== 0) {
  const reason = result.error
    ? result.error.message
    : result.signal
      ? `terminated by signal ${result.signal}`
      : `exited with code ${result.status ?? 'unknown'}`;
  console.warn(
    `[build] Translation refresh ${reason}; continuing with committed translations.`
  );
}

process.exit(0);
