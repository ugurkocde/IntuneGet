import { describe, expect, it } from 'vitest';
import { canUseCustomDetection, validateCustomDetectionRules } from './custom-detection';

describe('explicit custom detection contract', () => {
  it.each(['abc', '1.x', '1', '1.2', '1.2.3.4.5', '256.0.0', '0.256.0', '0.0.65536', '-1.2.3', '1.2.3 ', '1.2.3.x'])('rejects invalid MSI comparison version %s', productVersion => {
    expect(validateCustomDetectionRules([{ type: 'msi', productCode: '{11111111-2222-3333-4444-555555555555}', productVersionOperator: 'equal', productVersion }]).valid).toBe(false);
  });
  it.each(['0.0.0', '255.255.65535', '1.2.3.4', '1.2.3.999999999999999999999999'])('preserves valid MSI comparison version %s', productVersion => {
    const rule = { type: 'msi', productCode: '{11111111-2222-3333-4444-555555555555}', productVersionOperator: 'equal', productVersion };
    const before = JSON.stringify(rule);
    expect(validateCustomDetectionRules([rule])).toEqual({ valid: true, errors: [] });
    expect(JSON.stringify(rule)).toBe(before);
  });
  it.each(['string', 'dateModified', 'dateCreated'])('rejects unsupported file comparison %s', detectionType => {
    expect(validateCustomDetectionRules([{ type: 'file', path: 'C:\\Example', fileOrFolderName: 'app.exe', detectionType, operator: 'equal', detectionValue: '2026-10-09' }]).valid).toBe(false);
  });
  it.each([
    ['integer', '1.5'], ['integer', 'abc'], ['integer', ' 5'],
    ['sizeInMB', '-1'], ['sizeInMB', '1.5'], ['sizeInMB', 'ten'],
    ['version', '1'], ['version', '1.2.x'], ['version', 'v1.2'], ['version', '1.2.3.4.5'],
  ])('rejects invalid %s value %s', (detectionType, detectionValue) => {
    const rule = detectionType === 'sizeInMB'
      ? { type: 'file', path: 'C:\\Example', fileOrFolderName: 'app.exe', detectionType, detectionValue, operator: 'equal' }
      : { type: 'registry', keyPath: 'HKEY_LOCAL_MACHINE\\Software\\Example', detectionType, detectionValue, operator: 'equal' };
    expect(validateCustomDetectionRules([rule]).valid).toBe(false);
  });
  it.each([
    ['integer', '0'], ['integer', '-1'], ['sizeInMB', '10'], ['version', '1.2'], ['version', '1.2.3.4'], ['string', 'any text'],
  ])('accepts valid %s value %s without rewriting it', (detectionType, detectionValue) => {
    const rule = detectionType === 'sizeInMB'
      ? { type: 'file', path: 'C:\\Example', fileOrFolderName: 'app.exe', detectionType, detectionValue, operator: 'equal' }
      : { type: 'registry', keyPath: 'HKEY_LOCAL_MACHINE\\Software\\Example', detectionType, detectionValue, operator: 'equal' };
    const before = JSON.stringify(rule);
    expect(validateCustomDetectionRules([rule])).toEqual({ valid: true, errors: [] });
    expect(JSON.stringify(rule)).toBe(before);
  });
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
