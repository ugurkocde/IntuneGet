import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

for (const host of ['powershell.exe','pwsh']) {
  const available = spawnSync(host,['-NoProfile','-Command','exit 0'],{windowsHide:true,stdio:'ignore'}).status === 0;
  describe.skipIf(!available)(`${host} synthetic toolkit verification`, () => {
    it('checks pristine and tampered trees, downloads and unsafe archive paths without executing payloads', () => {
      const run = spawnSync(host,['-NoProfile','-ExecutionPolicy','Bypass','-File',resolve('packager/tests/tool-integrity.fixture.ps1'),'-Verifier',resolve('packager/scripts/tool-integrity.ps1')],{encoding:'utf8',windowsHide:true,timeout:60000});
      expect(run.stdout + run.stderr).toContain('PASS:');
      expect(run.status,run.stdout + run.stderr).toBe(0);
    },65000);
  });
}
