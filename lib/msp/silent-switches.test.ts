import { describe, expect, it } from 'vitest';
import { extractSilentSwitches } from './silent-switches';

describe('extractSilentSwitches', () => {
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
});
