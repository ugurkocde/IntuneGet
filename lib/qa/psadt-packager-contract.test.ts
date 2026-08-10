import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const packager = readFileSync(
  resolve(process.cwd(), '.github/scripts/Create-PSADTPackage.ps1'),
  'utf8'
);

describe('PSADT Inno packaging contract', () => {
  it('does not inject diagnostic switches into the vendor command line', () => {
    const innoBlock = packager.slice(
      packager.indexOf("if ($installerTypeLower -eq 'inno')"),
      packager.indexOf('switch ($installerTypeLower)')
    );

    expect(innoBlock).not.toContain('/LOG=');
    expect(innoBlock).not.toContain('IntuneGet-Inno-Install.log');
    expect(innoBlock).toContain("$installerArgumentList = \"'$innoSwitchesEscaped'\"");
  });

  it('keeps the startup-prompt suppression idempotent without format-string expansion', () => {
    const innoBlock = packager.slice(
      packager.indexOf("if ($installerTypeLower -eq 'inno')"),
      packager.indexOf('switch ($installerTypeLower)')
    );

    expect(innoBlock).toContain("$innoSwitches -notmatch '(?i)(^|\\s)/SP-(\\s|$)'");
    expect(innoBlock).not.toMatch(/\s-f\s/);
    expect(innoBlock).not.toContain("-replace '`', '``'");
    expect(innoBlock).not.toContain("-replace '\\$', '`$'");
  });
});

describe('PSADT vendor argument contract', () => {
  it('does not rewrite dollar signs or backticks in generic silent switches', () => {
    expect(packager).toContain('$silentSwitchesEscaped = $SilentSwitches -replace "\'", "\'\'"');
    const assignment = packager.match(/^\$silentSwitchesEscaped\s*=.*$/m)?.[0] ?? '';
    expect(assignment).not.toContain("-replace '`'");
    expect(assignment).not.toContain("-replace '\\$'");
  });
});

describe('PSADT registry uninstall identity contract', () => {
  it('parses and persists a manifest product code for multi-entry installers', () => {
    expect(packager).toContain(
      "^REGISTRY_UNINSTALL_PRODUCT:(\\{[A-Fa-f0-9-]{36}\\}):(.+)$"
    );
    expect(packager).toContain(
      "[string]$_.PSChildName -eq $configuredUninstallProductCode"
    );
    expect(packager).toContain(
      "Set-ADTRegistryKey -LiteralPath $regPath -Name ''UninstallRegistryKey''"
    );
  });

  it('never sends an ambiguous display-name result set to PSADT uninstall', () => {
    expect(packager).toContain("Get-ADTApplication -Name $appName -NameMatch ''Exact''");
    expect(packager).toContain('if ($installedApps.Count -ne 1)');
    expect(packager).toContain(
      '$registeredApplication = $installedApps[0]'
    );
    expect(packager).toContain(
      'Uninstall-ADTApplication -InstalledApplication $registeredApplication'
    );
    expect(packager).not.toContain(
      'Uninstall-ADTApplication -InstalledApplication $installedApp -SuccessExitCodes'
    );
  });

  it('uses the packaged Burn bundle when the registered vendor cache is disposable', () => {
    expect(packager).toContain("if ($originalInstallerType -eq 'burn')");
    expect(packager).toContain(
      '[string[]]$registeredUninstallArguments = @($registeredApplication."$($registeredUninstallProperty)ArgumentList")'
    );
    expect(packager).toContain(
      "`$bundledUninstaller = Join-Path `$adtSession.DirFiles '$installerFileNameSingleQuoteEscaped'"
    );
    expect(packager).toContain(
      'Start-ADTProcess -FilePath $bundledUninstaller -ArgumentList $registeredUninstallArguments -WorkingDirectory $adtSession.DirFiles'
    );
  });

  it('executes the exact vendor-documented command for Vivaldi silent removal', () => {
    expect(packager).toContain(
      "$registeredArgumentText -match ''(?i)(^|\\s)--vivaldi(\\s|$)''"
    );
    expect(packager).toContain('$isVivaldiUninstall = $true');
    expect(packager).toContain(
      "[string[]]$vivaldiUninstallArguments = @(''--uninstall'', ''--vivaldi'', ''--force-uninstall'')"
    );
    expect(packager).toContain(
      'Start-ADTProcess -FilePath $vivaldiUninstaller -ArgumentList $vivaldiUninstallArguments -WorkingDirectory (Split-Path -Parent $vivaldiUninstaller)'
    );
  });

  it('adds verified silent arguments when other vendors only register an interactive uninstall', () => {
    expect(packager).toContain("$registeredInstallerType -eq ''inno''");
    expect(packager).toContain("$registeredInstallerType -eq ''nullsoft''");
    expect(packager).toContain(
      'Uninstall-ADTApplication -InstalledApplication $registeredApplication -AdditionalArgumentList $additionalUninstallArguments'
    );
  });
});
