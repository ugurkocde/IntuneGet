import { describe, it, expect } from 'vitest';
import {
  DEFAULT_REGISTRY_MARKER_PATH,
  normalizeMarkerPath,
  rewriteMarkerKeyPath,
} from '../registry-marker';

describe('normalizeMarkerPath', () => {
  it('should return the default for undefined input', () => {
    expect(normalizeMarkerPath(undefined)).toBe('SOFTWARE\\IntuneGet\\Apps');
    expect(normalizeMarkerPath(undefined)).toBe(DEFAULT_REGISTRY_MARKER_PATH);
  });

  it('should return the default for null input', () => {
    expect(normalizeMarkerPath(null)).toBe(DEFAULT_REGISTRY_MARKER_PATH);
  });

  it('should return the default for empty or whitespace input', () => {
    expect(normalizeMarkerPath('')).toBe(DEFAULT_REGISTRY_MARKER_PATH);
    expect(normalizeMarkerPath('   ')).toBe(DEFAULT_REGISTRY_MARKER_PATH);
  });

  it('should pass through a clean custom path', () => {
    expect(normalizeMarkerPath('SOFTWARE\\Contoso\\Apps')).toBe('SOFTWARE\\Contoso\\Apps');
  });

  it('should trim surrounding whitespace', () => {
    expect(normalizeMarkerPath('  SOFTWARE\\Contoso\\Apps  ')).toBe('SOFTWARE\\Contoso\\Apps');
  });

  it('should strip leading and trailing backslashes', () => {
    expect(normalizeMarkerPath('\\SOFTWARE\\Contoso\\Apps\\')).toBe('SOFTWARE\\Contoso\\Apps');
  });

  it('should strip an accidental HKLM prefix', () => {
    expect(normalizeMarkerPath('HKLM\\SOFTWARE\\Contoso\\Apps')).toBe('SOFTWARE\\Contoso\\Apps');
  });

  it('should strip an accidental HKCU prefix case-insensitively', () => {
    expect(normalizeMarkerPath('hkcu\\Software\\Contoso')).toBe('Software\\Contoso');
  });

  it('should strip long hive prefixes with optional colon', () => {
    expect(normalizeMarkerPath('HKEY_LOCAL_MACHINE\\SOFTWARE\\Contoso')).toBe('SOFTWARE\\Contoso');
    expect(normalizeMarkerPath('HKEY_CURRENT_USER\\SOFTWARE\\Contoso')).toBe('SOFTWARE\\Contoso');
    expect(normalizeMarkerPath('HKLM:\\SOFTWARE\\Contoso')).toBe('SOFTWARE\\Contoso');
  });

  it('should return the default when only a hive prefix is provided', () => {
    expect(normalizeMarkerPath('HKLM\\')).toBe(DEFAULT_REGISTRY_MARKER_PATH);
    expect(normalizeMarkerPath('HKLM')).toBe(DEFAULT_REGISTRY_MARKER_PATH);
  });

  it('should collapse repeated backslashes', () => {
    expect(normalizeMarkerPath('SOFTWARE\\\\Contoso\\\\\\Apps')).toBe('SOFTWARE\\Contoso\\Apps');
  });

  it('should convert forward slashes to backslashes', () => {
    expect(normalizeMarkerPath('SOFTWARE/Contoso/Apps')).toBe('SOFTWARE\\Contoso\\Apps');
  });

  it('should remove characters invalid in registry key names', () => {
    expect(normalizeMarkerPath('SOFTWARE\\Con<to>so?\\Ap*ps|')).toBe('SOFTWARE\\Contoso\\Apps');
  });

  it('should remove quotes to keep generated PowerShell safe', () => {
    expect(normalizeMarkerPath("SOFTWARE\\Con'toso\\\"Apps\"")).toBe('SOFTWARE\\Contoso\\Apps');
  });

  it('should drop empty segments created by sanitization', () => {
    expect(normalizeMarkerPath('SOFTWARE\\   \\Contoso')).toBe('SOFTWARE\\Contoso');
  });

  it('should normalize garbage hive prefix plus trailing slash', () => {
    expect(normalizeMarkerPath('HKLM\\SOFTWARE\\Contoso\\')).toBe('SOFTWARE\\Contoso');
  });
});

describe('rewriteMarkerKeyPath', () => {
  it('should rewrite a default marker keyPath to a custom root', () => {
    expect(
      rewriteMarkerKeyPath(
        'HKEY_LOCAL_MACHINE\\SOFTWARE\\IntuneGet\\Apps\\Google_Chrome',
        'Google_Chrome',
        'SOFTWARE\\Contoso\\Apps'
      )
    ).toBe('HKEY_LOCAL_MACHINE\\SOFTWARE\\Contoso\\Apps\\Google_Chrome');
  });

  it('should preserve the HKCU hive', () => {
    expect(
      rewriteMarkerKeyPath(
        'HKEY_CURRENT_USER\\SOFTWARE\\IntuneGet\\Apps\\Publisher_App',
        'Publisher_App',
        'SOFTWARE\\Contoso\\Apps'
      )
    ).toBe('HKEY_CURRENT_USER\\SOFTWARE\\Contoso\\Apps\\Publisher_App');
  });

  it('should rewrite a previously customized root back to the default', () => {
    expect(
      rewriteMarkerKeyPath(
        'HKEY_LOCAL_MACHINE\\SOFTWARE\\Contoso\\Apps\\Publisher_App',
        'Publisher_App',
        '',
        'SOFTWARE\\Contoso\\Apps'
      )
    ).toBe(`HKEY_LOCAL_MACHINE\\${DEFAULT_REGISTRY_MARKER_PATH}\\Publisher_App`);
  });

  it('should return null when the keyPath does not match the previous marker root', () => {
    // A rule under a custom root must not be rewritten when the previous
    // root was the default (e.g. a manually authored rule elsewhere)
    expect(
      rewriteMarkerKeyPath(
        'HKEY_LOCAL_MACHINE\\SOFTWARE\\Contoso\\Apps\\Publisher_App',
        'Publisher_App',
        'SOFTWARE\\Fabrikam\\Apps'
      )
    ).toBeNull();
  });

  it('should not rewrite an unrelated key that ends with the sanitized id', () => {
    expect(
      rewriteMarkerKeyPath(
        'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Google_Chrome',
        'Google_Chrome',
        'SOFTWARE\\Contoso\\Apps'
      )
    ).toBeNull();
  });

  it('should normalize the marker path before rewriting', () => {
    expect(
      rewriteMarkerKeyPath(
        'HKEY_LOCAL_MACHINE\\SOFTWARE\\IntuneGet\\Apps\\Publisher_App',
        'Publisher_App',
        'HKLM\\SOFTWARE\\Contoso\\'
      )
    ).toBe('HKEY_LOCAL_MACHINE\\SOFTWARE\\Contoso\\Publisher_App');
  });

  it('should return null for a keyPath without a known hive', () => {
    expect(
      rewriteMarkerKeyPath('SOFTWARE\\IntuneGet\\Apps\\Publisher_App', 'Publisher_App', 'X')
    ).toBeNull();
  });

  it('should return null when the keyPath does not end with the sanitized id', () => {
    expect(
      rewriteMarkerKeyPath(
        'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\App',
        'Publisher_App',
        'SOFTWARE\\Contoso\\Apps'
      )
    ).toBeNull();
  });

  it('should return null when the keyPath is only hive plus id (no root)', () => {
    expect(
      rewriteMarkerKeyPath('HKEY_LOCAL_MACHINE\\Publisher_App', 'Publisher_App', 'X')
    ).toBeNull();
  });
});
