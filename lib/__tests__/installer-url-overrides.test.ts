import { describe, it, expect } from 'vitest';
import {
  INSTALLER_URL_OVERRIDES,
  applyInstallerUrlOverride,
} from '../installer-url-overrides';

describe('applyInstallerUrlOverride', () => {
  it('returns the original URL when the winget ID has no override', () => {
    const url = applyInstallerUrlOverride(
      'Google.Chrome',
      '124.0.6367.91',
      'x64',
      'https://dl.google.com/chrome/installer.exe',
    );

    expect(url).toBe('https://dl.google.com/chrome/installer.exe');
  });

  it('routes Freeplane to GitHub Releases instead of SourceForge', () => {
    const url = applyInstallerUrlOverride(
      'Freeplane.Freeplane',
      '1.12.8',
      'x64',
      'https://sourceforge.net/projects/freeplane/files/freeplane%20stable/Freeplane-Setup-1.12.8.exe/download',
    );

    expect(url).toBe(
      'https://github.com/freeplane/freeplane/releases/download/release-1.12.8/Freeplane-Setup-1.12.8.exe',
    );
  });

  it('routes Blender 4.2 LTS x64 to Blender official mirror service', () => {
    const url = applyInstallerUrlOverride(
      'BlenderFoundation.Blender.LTS.4.2',
      '4.2.16',
      'x64',
      'https://download.blender.org/release/Blender4.2/blender-4.2.16-windows-x64.msi',
    );

    expect(url).toBe(
      'https://mirror.blender.org/release/Blender4.2/blender-4.2.16-windows-x64.msi',
    );
  });

  it('does not guess a Blender mirror payload for another architecture', () => {
    const original = 'https://download.blender.org/release/Blender4.2/setup-arm64.msi';
    expect(applyInstallerUrlOverride(
      'BlenderFoundation.Blender.LTS.4.2',
      '4.2.16',
      'arm64',
      original,
    )).toBe(original);
  });

  it('interpolates the version into the Freeplane GitHub Releases URL', () => {
    const url = applyInstallerUrlOverride(
      'Freeplane.Freeplane',
      '1.13.3-pre05',
      'x64',
      'https://sourceforge.net/projects/freeplane/files/whatever',
    );

    expect(url).toBe(
      'https://github.com/freeplane/freeplane/releases/download/release-1.13.3-pre05/Freeplane-Setup-1.13.3-pre05.exe',
    );
  });

  it('ignores architecture for Freeplane (single installer)', () => {
    const x64 = applyInstallerUrlOverride(
      'Freeplane.Freeplane',
      '1.12.8',
      'x64',
      'https://sourceforge.net/...',
    );
    const arm64 = applyInstallerUrlOverride(
      'Freeplane.Freeplane',
      '1.12.8',
      'arm64',
      'https://sourceforge.net/...',
    );

    expect(x64).toBe(arm64);
  });
});

describe('INSTALLER_URL_OVERRIDES', () => {
  it('contains the Freeplane entry', () => {
    expect(INSTALLER_URL_OVERRIDES['Freeplane.Freeplane']).toBeDefined();
  });

  it('contains the Blender 4.2 LTS entry', () => {
    expect(INSTALLER_URL_OVERRIDES['BlenderFoundation.Blender.LTS.4.2']).toBeDefined();
  });
});
