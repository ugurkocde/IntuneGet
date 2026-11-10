import { describe, expect, it } from 'vitest';
import { extractSilentSwitches } from './silent-switches';

describe('extractSilentSwitches', () => {
  it.each(['bootstrap_x64.exe', 'bootstrap_x86.exe'])(
    'preserves the nested MSI command passed to %s',
    (launcher) => {
      const tail = '/Q /C:"msiexec /i ""vcredist.msi"" /quiet /norestart"';
      expect(extractSilentSwitches(`"${launcher}" ${tail}`, 'exe')).toBe(tail);
    }
  );

  it.each(['exe', 'inno', 'nullsoft', 'burn'])(
    'preserves vendor action switches for a %s installer',
    (type) => {
      const tail = '/i "payload.msi" /x {PRODUCT-CODE} /p "C:\\config\\settings.ini" /quiet';
      expect(extractSilentSwitches(`"setup.exe" ${tail}`, type)).toBe(tail);
    }
  );

  it('preserves a nested EXE vendor command in a ZIP package', () => {
    const tail = '/Q /C:"msiexec /i ""payload.msi"" /quiet"';
    expect(extractSilentSwitches(`"setup.exe" ${tail}`, 'zip', 'exe')).toBe(tail);
  });

  it.each([
    ['msiexec /i "payload.msi" /qn', 'exe', undefined, '/qn'],
    ['"msiexec.exe" /i "payload.msi" /qn', 'exe', undefined, '/qn'],
    ['"C:\\Windows\\System32\\msiexec.exe" /i "payload.msi" /qn', 'exe', undefined, '/qn'],
    ['C:\\Windows\\System32\\msiexec.exe /i "payload.msi" /qn', 'exe', undefined, '/qn'],
    ['msiexec.exe /i "inner.msi" /qn', 'zip', 'msi', '/qn'],
    ['/i payload.msi /qn', 'msi', undefined, '/qn'],
    ['/x {PRODUCT-CODE} /qn', 'wix', undefined, '/qn'],
    ['/p "patch.msp" /qn', 'msi', undefined, '/qn'],
  ])('keeps outer MSI extraction for %s', (command, type, nestedType, expected) => {
    expect(extractSilentSwitches(command, type, nestedType)).toBe(expected);
  });

  it('does not mistake PowerShell archive parameters for vendor switches', () => {
    expect(extractSilentSwitches(
      'Expand-Archive -Path "app.zip" -DestinationPath "%ProgramFiles%\\App" -Force',
      'zip',
      'inno'
    )).toBe('/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-');
  });

  it('does not mistake wrapped PowerShell archive parameters for vendor switches', () => {
    expect(extractSilentSwitches(
      'powershell.exe -Command Expand-Archive -Path app.zip -DestinationPath app',
      'zip',
      'inno'
    )).toBe('/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-');
  });

  it('keeps explicit nested installer switches', () => {
    expect(extractSilentSwitches(
      '"setup.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-',
      'zip',
      'inno'
    )).toBe('/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-');
  });

  it('keeps positional operands required by vendor switches', () => {
    expect(extractSilentSwitches(
      '"setup.exe" /configure https://aka.ms/fhlwingetconfig',
      'exe'
    )).toBe('/configure https://aka.ms/fhlwingetconfig');
  });

  it('does not guess a universal switch for a plain EXE command', () => {
    expect(extractSilentSwitches('"setup.exe"', 'exe')).toBe('');
  });

  it('keeps MSI properties after removing the install action target', () => {
    expect(extractSilentSwitches(
      'msiexec.exe /i "agent.msi" /qn REBOOT=ReallySuppress ALLUSERS=1',
      'msi'
    )).toBe('/qn REBOOT=ReallySuppress ALLUSERS=1');
  });

  it('keeps architecture-specific vendor MSI properties for packaging', () => {
    expect(extractSilentSwitches(
      'msiexec /i "Macabacus-9.9.2.msi" /qn /norestart OFFICE2016X64FOUND=1 EULA=1 ALLUSERS=1',
      'wix'
    )).toBe('/qn /norestart OFFICE2016X64FOUND=1 EULA=1 ALLUSERS=1');
  });

  it('keeps MSI properties that appear before the quiet switch', () => {
    expect(extractSilentSwitches(
      'msiexec /i "Macabacus-9.9.2.msi" EULA=1 /qn',
      'wix'
    )).toBe('EULA=1 /qn');
  });

  it('keeps an empty MSI property value before later switches', () => {
    expect(extractSilentSwitches(
      'msiexec.exe /i "dual-purpose.msi" MSIINSTALLPERUSER="" ALLUSERS=2 /qn',
      'msi'
    )).toBe('MSIINSTALLPERUSER="" ALLUSERS=2 /qn');
  });

  it('fails closed for an archive with no nested installer type', () => {
    expect(extractSilentSwitches(
      'Expand-Archive -Path "app.zip" -DestinationPath "%ProgramFiles%\\App" -Force',
      'zip'
    )).toBe('');
  });

  it('does not return archive parameters for a portable package', () => {
    expect(extractSilentSwitches(
      'Expand-Archive -Path "app.zip" -DestinationPath "%ProgramFiles%\\App" -Force',
      'portable'
    )).toBe('');
  });

  it('keeps a bounded EXE verb followed by explicit silent switches', () => {
    expect(extractSilentSwitches('"sample-setup.exe" install --quiet --accept-license', 'exe'))
      .toBe('install --quiet --accept-license');
    expect(extractSilentSwitches('sample.exe deploy /quiet --mode=unattended', 'exe'))
      .toBe('deploy /quiet --mode=unattended');
    expect(extractSilentSwitches('sample.exe install --quiet', 'zip', 'exe'))
      .toBe('install --quiet');
  });

  it.each([
    'install', 'install extra --quiet', 'install --quiet && other',
    'install --quiet;other', 'install --quiet|other', 'install --quiet > output',
    'install --quiet $(other)', 'install --quiet `other`',
    'install --path=C:\\temp', 'install --url=https://example.invalid',
    'C:\\setup install --quiet', 'https://example.invalid --quiet',
    'install ./payload --quiet', 'install --quiet\n--accept-license',
    'install -DeploymentType', 'install --quiet --output=../payload',
    `${'a'.repeat(33)} --quiet`, `install --${'a'.repeat(1024)}`,
  ])('rejects unsupported or unsafe bare-verb tail %s', (tail) => {
    expect(extractSilentSwitches(`"sample.exe" ${tail}`, 'exe')).toBe('');
  });

  it('keeps framework defaults and wrapper exclusions for bare verbs', () => {
    expect(extractSilentSwitches('sample.exe install --quiet', 'inno'))
      .toBe('/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-');
    expect(extractSilentSwitches('sample.exe -DeploymentType', 'exe')).toBe('');
  });

});
