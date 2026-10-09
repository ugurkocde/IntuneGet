// Match the parameter validation in run-app-scan.ps1 and scan-app.ps1.
export const SCANNER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.[A-Za-z0-9][A-Za-z0-9._+-]*$/;
export const SCANNER_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+\-]*$/;

export function isScannerEligible(app) {
  return typeof app?.winget_id === 'string'
    && typeof app?.latest_version === 'string'
    && SCANNER_ID_PATTERN.test(app.winget_id)
    && SCANNER_VERSION_PATTERN.test(app.latest_version);
}

export function selectScanApps(candidates, lastScanned, maxApps) {
  return [...candidates].sort((a, b) => {
    const aTime = lastScanned.has(a.winget_id) ? Date.parse(lastScanned.get(a.winget_id)) : 0;
    const bTime = lastScanned.has(b.winget_id) ? Date.parse(lastScanned.get(b.winget_id)) : 0;
    return aTime - bTime || (a.popularity_rank ?? Number.MAX_SAFE_INTEGER) - (b.popularity_rank ?? Number.MAX_SAFE_INTEGER);
  }).slice(0, maxApps).map(app => ({
    winget_id: app.winget_id,
    expected_version: app.latest_version,
  }));
}
