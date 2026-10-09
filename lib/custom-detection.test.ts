import { describe, expect, it } from 'vitest';
import { canUseCustomDetection, validateCustomDetectionRules } from './custom-detection';

describe('explicit custom detection contract', () => {
  it.each([
    { type: 'registry', keyPath: 'HKEY_LOCAL_MACHINE\\Software\\Vendor', valueName: 'Version', detectionType: 'version', operator: 'greaterThanOrEqual', detectionValue: '1.2.3' },
    { type: 'file', path: '%ProgramFiles%\\Vendor', fileOrFolderName: 'app.exe', detectionType: 'exists' },
    { type: 'msi', productCode: '{11111111-2222-3333-4444-555555555555}' },
  ])('accepts declarative rules without changing their values', rule => {
    const before = JSON.stringify(rule);
    expect(validateCustomDetectionRules([rule])).toEqual({ valid: true, errors: [] });
    expect(JSON.stringify(rule)).toBe(before);
  });
  it.each([null, [], [null], [{type:'script',scriptContent:'exit 0'}], [{type:'unknown'}], [{type:'registry',keyPath:'',detectionType:'exists'}], [{type:'file',path:'C:\\',fileOrFolderName:'app',detectionType:'version'}], [{type:'msi',productCode:'placeholder'}]])('rejects malformed or unsupported rules: %j', rules => {
    expect(validateCustomDetectionRules(rules).valid).toBe(false);
  });
  it.each([{sourceType:'custom'}, {sourceType:'curated'}, {installerType:'msix'}, {installerType:'appx'}, {installerType:'zip',nestedInstallerType:'msix'}])('rejects unsupported packaging sources: %j', input => {
    expect(canUseCustomDetection({wingetId:'Vendor.App', ...input})).toBe(false);
  });
  it('supports ordinary catalog Win32 installers', () => expect(canUseCustomDetection({wingetId:'Vendor.App',installerType:'exe'})).toBe(true));
});
