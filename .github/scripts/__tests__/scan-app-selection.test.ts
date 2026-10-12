import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error Workflow helper is executed directly by Node.
import { isScannerEligible, SCANNER_ID_PATTERN, SCANNER_VERSION_PATTERN, selectScanApps } from '../scan-app-selection.mjs';

describe('catalog scanner selection', () => {
  it('excludes the Store ID before applying the matrix limit', () => {
    const candidates = [
      { winget_id: '9WZDNCRFJ3PZ', latest_version: '1.0', popularity_rank: 1 },
      ...Array.from({ length: 20 }, (_, i) => ({ winget_id: `Vendor.App${i}`, latest_version: '2.0', popularity_rank: i + 2 })),
    ];
    const apps = selectScanApps(candidates.filter(isScannerEligible), new Map(), 20);
    expect(apps).toHaveLength(20);
    expect(apps.some((app: { winget_id: string }) => app.winget_id === '9WZDNCRFJ3PZ')).toBe(false);
  });

  it.each(['Microsoft.VisualStudioCode', '7zip.7zip', 'Python.Python.3', 'Vendor.App+'])('accepts scanner-compatible ID %s', id => {
    expect(isScannerEligible({ winget_id: id, latest_version: '1.2.3-rc+4' })).toBe(true);
  });

  it.each(['9WZDNCRFJ3PZ', 'a;b.c', '.Foo.Bar', 'Foo', 'Foo/Bar.Baz', 'Foo.Bar ', 'Notepad++.Notepad++'])('rejects scanner-incompatible ID %s', id => {
    expect(isScannerEligible({ winget_id: id, latest_version: '1.0' })).toBe(false);
  });

  it.each([null, 12, {}, '', '1 2', '<version>'])('rejects invalid version %j without coercion', version => {
    expect(isScannerEligible({ winget_id: 'Vendor.App', latest_version: version })).toBe(false);
  });

  it.each([null, 12, {}, undefined])('rejects non-string ID %j', id => {
    expect(isScannerEligible({ winget_id: id, latest_version: '1.0' })).toBe(false);
  });

  it('keeps never-scanned priority, chronological order, popularity ties and the cap', () => {
    const candidates = [
      { winget_id: 'Vendor.Newer', latest_version: '3', popularity_rank: 1 },
      { winget_id: 'Vendor.Null', latest_version: '4', popularity_rank: null },
      { winget_id: 'Vendor.Older', latest_version: '2', popularity_rank: 2 },
      { winget_id: 'Vendor.Never', latest_version: '1', popularity_rank: 3 },
    ];
    const dates = new Map([['Vendor.Older', '2026-09-01T00:00:00Z'], ['Vendor.Newer', '2026-10-01T00:00:00Z']]);
    expect(selectScanApps(candidates, dates, 3)).toEqual([
      { winget_id: 'Vendor.Never', expected_version: '1' },
      { winget_id: 'Vendor.Null', expected_version: '4' },
      { winget_id: 'Vendor.Older', expected_version: '2' },
    ]);
    expect(candidates[0].winget_id).toBe('Vendor.Newer');
  });

  it.each(['run-app-scan.ps1', 'scan-app.ps1'])('matches the actual %s parameter contracts', filename => {
    const script = readFileSync(new URL(`../${filename}`, import.meta.url), 'utf8');
    const patterns = [...script.matchAll(/ValidatePattern\('([^']+)'\)/g)].map(match => match[1]);
    expect(patterns.slice(0, 2)).toEqual([SCANNER_ID_PATTERN.source, SCANNER_VERSION_PATTERN.source]);
  });

  it('filters only automatic selection and preserves strict artifact ingestion', () => {
    const workflow = readFileSync(new URL('../../workflows/scan-apps.yml', import.meta.url), 'utf8');
    expect(workflow).toContain('const candidates = specific ? data : data.filter(isScannerEligible)');
    expect(workflow).toContain("if (!candidates.length) throw new Error('No scanner-eligible apps were found')");
    expect(workflow).toContain('if (results.length !== expected) throw new Error');
    expect(workflow).toContain('if-no-files-found: error');
  });
});
