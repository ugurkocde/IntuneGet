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

  it('keeps MSI properties after removing the install action target', () => {
    expect(extractSilentSwitches(
      'msiexec.exe /i "agent.msi" /qn REBOOT=ReallySuppress ALLUSERS=1',
      'msi'
    )).toBe('/qn REBOOT=ReallySuppress ALLUSERS=1');
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
