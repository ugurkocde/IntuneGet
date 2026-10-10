import { describe, expect, it } from 'vitest';
import { JobProcessor } from '../src/job-processor';
import type { PackagingJob } from '../src/job-poller';
import { char, pwshAvailable, summarizePowerShell } from '../../lib/__tests__/powershell-ast-helper';

// Security hardening of generated PowerShell: every value the local packager
// embeds into Invoke-AppDeployToolkit.ps1 must parse back to exactly the
// configured value, and must never add AST nodes compared with a plain value.

const generator = JobProcessor.prototype as unknown as {
  generateDeployScript(job: PackagingJob, fileName: string): string;
};

const quotes = [0x27, 0x2018, 0x2019, 0x201a, 0x201b, 0x22, 0x201c, 0x201d, 0x201e].map(char).join('');
const LINE = `q${quotes} tick\`t\`$ $(Get-Date) \${env:TEMP} $HOME <# c #>`;
const MULTILINE = `${LINE}\n'@\n"@\nend`;
const fileSafe = (text: string) => text.replace(/[\x00-\x1F\x7F\\/:*?"<>|]/g, '');

type Value = (field: string, adversarial: string) => string;
const valueFor = (adversarial: boolean): Value => (field, text) => (adversarial ? `${field} ${text}` : `${field} plain`);

function job(overrides: Partial<PackagingJob>): PackagingJob {
  return {
    id: 'encoding-fixture', user_id: 'user', user_email: 'qa@example.com', tenant_id: 'tenant',
    winget_id: 'Contoso.App', version: '1.0.0', display_name: 'Contoso App', publisher: 'Contoso',
    architecture: 'x64', installer_type: 'exe', installer_url: 'https://example.com/setup.exe',
    installer_sha256: 'A'.repeat(64), install_command: '"setup.exe" /S',
    uninstall_command: 'REGISTRY_UNINSTALL:Contoso App', install_scope: 'machine', detection_rules: [],
    package_config: {}, status: 'queued', progress_percent: 0, created_at: '2026-10-10T00:00:00Z',
    ...overrides,
  };
}

/**
 * Generates the script with plain values and with adversarial values and
 * checks that the adversarial script parses, keeps the AST shape and comment
 * count, and contains every expected string value exactly.
 */
function expectExactEmbedding(
  build: (v: Value) => { job: PackagingJob; fileName: string },
  expected: (v: Value) => string[]
): void {
  const scripts = [false, true].map((adversarial) => {
    const { job: fixture, fileName } = build(valueFor(adversarial));
    return generator.generateDeployScript(fixture, fileName);
  });
  const [benign, adversarial] = summarizePowerShell(scripts);
  expect(benign.errors).toEqual([]);
  expect(adversarial.errors).toEqual([]);
  expect(adversarial.shape).toEqual(benign.shape);
  expect(adversarial.comments.length).toBe(benign.comments.length);
  for (const text of expected(valueFor(false))) expect(benign.strings, JSON.stringify(text)).toContain(text);
  for (const text of expected(valueFor(true))) expect(adversarial.strings, JSON.stringify(text)).toContain(text);
}

describe.runIf(pwshAvailable)('local PSADT generator string encoding', () => {
  it('embeds identity, switches, the uninstall command and customer settings exactly', () => {
    expectExactEmbedding(
      (v) => ({
        fileName: 'setup.exe',
        job: job({
          display_name: v('Name', MULTILINE),
          publisher: v('Vendor', MULTILINE),
          version: v('1.0', MULTILINE),
          architecture: v('x64', LINE),
          winget_id: v('Contoso.App', LINE).replace(/ /g, ''),
          install_command: `"setup.exe" ${v('/S', MULTILINE)}`,
          uninstall_command: v('"C:\\Program Files\\Contoso\\uninstall.exe" /S', MULTILINE),
          package_config: {
            psadtConfig: {
              verifyInstall: true,
              removeExistingInstall: true,
              registryMarkerPath: v('SOFTWARE\\Contoso', LINE),
              processesToClose: [{ name: v('proc', fileSafe(LINE)), description: v('Proc', LINE) }],
              postInstallCommands: [v('echo post-install', MULTILINE)],
              postUninstallCommands: [v('echo post-uninstall', MULTILINE)],
            },
          },
        }),
      }),
      (v) => {
        const marker = v('SOFTWARE\\Contoso', LINE).replace(/[*?"'<>|]/g, '');
        const sanitizedId = v('Contoso.App', LINE).replace(/ /g, '').replace(/[.-]/g, '_');
        return [
          v('Name', MULTILINE),
          v('Vendor', MULTILINE),
          v('1.0', MULTILINE),
          v('x64', LINE),
          v('Contoso.App', LINE).replace(/ /g, ''),
          `HKLM\\${marker}\\${sanitizedId}`,
          `Registry::HKEY_LOCAL_MACHINE\\${marker}\\${sanitizedId}`,
          v('/S', MULTILINE),
          '/c ' + v('"C:\\Program Files\\Contoso\\uninstall.exe" /S', MULTILINE),
          v('proc', fileSafe(LINE)),
          v('Proc', LINE),
          `/c ${v('echo post-install', MULTILINE).replace(/[\r\n]+/g, ' ')}`,
          `/c ${v('echo post-uninstall', MULTILINE).replace(/[\r\n]+/g, ' ')}`,
          `Post-install verification failed: '${v('Name', MULTILINE)}' was not found in the installed applications list. The installer exited without error but the application does not appear to be installed.`,
        ];
      }
    );
  }, 60_000);

  it('embeds the registry uninstall identity, publisher and file name exactly', () => {
    expectExactEmbedding(
      (v) => ({
        fileName: `${v('setup', MULTILINE)}.exe`,
        job: job({
          publisher: v('Vendor', MULTILINE),
          install_command: `"setup.exe" ${v('/S', LINE)}`,
          uninstall_command: `REGISTRY_UNINSTALL:${v('Contoso', LINE)}`,
          package_config: { psadtConfig: { reviewedUninstallArguments: [v('/quiet', LINE)] } },
        }),
      }),
      (v) => [
        v('Contoso', LINE),
        v('Vendor', MULTILINE),
        v('/quiet', LINE),
        `$($adtSession.DirFiles)\\${v('setup', MULTILINE)}.exe`,
      ]
    );
  }, 60_000);

  it('embeds MSI properties, the MSI file name and overrides exactly', () => {
    expectExactEmbedding(
      (v) => ({
        fileName: `${v('setup', MULTILINE)}.msi`,
        job: job({
          installer_type: 'msi',
          install_command: `"setup.msi" /qn ${v('PROPERTY=1', LINE)}`,
          uninstall_command: 'REGISTRY_UNINSTALL_PRODUCT:{12345678-1234-1234-1234-123456789ABC}:Contoso App',
          package_config: { psadtConfig: { uninstallCommand: v('msiexec /x', MULTILINE) } },
        }),
      }),
      (v) => [
        `${v('setup', MULTILINE)}.msi`,
        v('PROPERTY=1', LINE).split(/\s+/).join(' '),
        `/c ${v('msiexec /x', MULTILINE).trim()}`,
      ]
    );
    expectExactEmbedding(
      (v) => ({
        fileName: 'setup.exe',
        job: job({ package_config: { psadtConfig: { installCommand: v('cmd-fixture', MULTILINE) } } }),
      }),
      (v) => [`/s /c "${v('cmd-fixture', MULTILINE).replace(/[\r\n]+/g, ' ').trim()}"`]
    );
  }, 60_000);

  it('embeds Inno Setup switches and a native override exactly', () => {
    expectExactEmbedding(
      (v) => ({
        fileName: 'setup.exe',
        job: job({ installer_type: 'inno', install_command: `"setup.exe" ${v('/VERYSILENT', LINE)}` }),
      }),
      (v) => [`${v('/VERYSILENT', LINE)} /SP-`]
    );
    // A native override cannot contain typographic quotes (they keep it on the
    // cmd.exe path), so it uses the remaining adversarial characters.
    const nativeSafe = LINE.replace(/[\u2018-\u201B&|<>^]/g, '');
    expectExactEmbedding(
      (v) => ({
        fileName: 'setup.exe',
        job: job({ package_config: { psadtConfig: { installCommand: `"setup.exe" ${v('/S', nativeSafe)}` } } }),
      }),
      (v) => [v('/S', nativeSafe)]
    );
  }, 60_000);

  it('embeds ZIP nested paths and portable names exactly', () => {
    const nested = (v: Value) => `Payload\\${v('setup', LINE).replace(/[:*?"<>|]/g, '')}.exe`;
    expectExactEmbedding(
      (v) => ({
        fileName: `${v('archive', MULTILINE)}.zip`,
        job: job({
          installer_type: 'zip',
          install_command: `"setup.exe" ${v('/S', LINE)}`,
          package_config: { nestedInstallerType: 'exe', nestedInstallerPath: nested(v) },
        }),
      }),
      (v) => [
        nested(v),
        `Nested installer not found in archive: ${nested(v)}`,
        `$($adtSession.DirFiles)\\${v('archive', MULTILINE)}.zip`,
      ]
    );
    expectExactEmbedding(
      (v) => ({
        fileName: `${v('archive', MULTILINE)}.zip`,
        job: job({
          installer_type: 'zip',
          display_name: v('Portable', LINE),
          install_command: '',
          uninstall_command: '',
          package_config: { nestedInstallerType: 'portable', nestedInstallerPath: nested(v) },
        }),
      }),
      (v) => [
        `${v('archive', MULTILINE)}.zip`,
        nested(v),
        `Nested installer not found in archive: ${nested(v)}`,
        v('Portable', LINE).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_'),
      ]
    );
  }, 60_000);

  it('embeds MSIX file names and versions exactly', () => {
    expectExactEmbedding(
      (v) => ({
        fileName: `${v('app', MULTILINE)}.msix`,
        job: job({
          installer_type: 'msix',
          version: v('1.0', MULTILINE),
          install_command: '',
          uninstall_command: 'MSIX_UNINSTALL:Contoso.App',
        }),
      }),
      (v) => [`${v('app', MULTILINE)}.msix`, v('1.0', MULTILINE), 'Contoso.App']
    );
  }, 60_000);
});

describe('local PSADT script file encoding', () => {
  it('starts the written deployment script with a UTF-8 byte order mark', async () => {
    // Windows PowerShell 5.1 reads a script without a byte order mark in the
    // ANSI code page, where U+0451 encodes to bytes D1 91 and 0x91 is U+2018.
    expect(Buffer.from(char(0x451), 'utf8')).toEqual(Buffer.from([0xd1, 0x91]));
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../src/job-processor.ts', import.meta.url), 'utf8'));
    expect(source).toContain('`${UTF8_BOM}${deployScript}`');
  });
});
