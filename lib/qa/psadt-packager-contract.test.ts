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
