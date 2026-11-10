import { describe, expect, it } from 'vitest';
import { unsupportedDependencyMessage, knownUnavailableDisposition, isExactPretestCandidate } from './unsupported-dependency';
import { resolveWingetPackageDependencies } from './winget-dependencies';
import type { NormalizedInstaller } from '@/types/winget';

const detail = (id: string) => `WinGet dependency ${id} is not in the reviewed redistribution allowlist.`;
describe('unsupported dependency customer wording', () => {
  it.each(['Microsoft.EdgeWebView2Runtime', 'Microsoft.WindowsAppRuntime.2', 'Microsoft.VCRedist.2015+.x64'])(
    'names a safe manifest identifier %s', id => {
      expect(unsupportedDependencyMessage({ code: 'unreviewed_dependency', detail: detail(id) }))
        .toBe(`This app requires ${id}, which is not supported yet. Automated deployment is blocked.`);
    });
  it.each(['one', 'Microsoft.Runtime\n', 'Microsoft.\u202ERuntime', 'Micros\u043eft.Runtime', 'https://private.invalid',
    'Microsoft.<Runtime>', 'Microsoft.`Runtime`', 'Microsoft.Runtime extra', '1.2.3.4.5.6.7.8.9',
    'A'.repeat(129), 'private prefix ' + detail('Microsoft.Runtime')])('never leaks invalid stored text %j', id => {
      expect(unsupportedDependencyMessage({ code: 'unreviewed_dependency', detail: detail(id) }))
        .toBe('This app requires a dependency that is not supported yet. Automated deployment is blocked.');
    });
  it('keeps every other compatibility block unchanged', () => {
    expect(unsupportedDependencyMessage({ code: 'unsupported_dependency_shape', detail: detail('Microsoft.Runtime') })).toBeNull();
    expect(unsupportedDependencyMessage(null)).toBeNull();
  });
  it.each(['\n', ' extra', '\u200B'])('rejects appended source text %j', suffix => {
    expect(unsupportedDependencyMessage({ code: 'unreviewed_dependency', detail: detail('Microsoft.Runtime') + suffix }))
      .toBe('This app requires a dependency that is not supported yet. Automated deployment is blocked.');
  });
  it('round trips the real resolver error without changing its policy or executing dependencies', async () => {
    const installer: NormalizedInstaller = { architecture: 'x64', url: 'https://example.test/setup.exe',
      sha256: 'A'.repeat(64), type: 'exe', silentArgs: '/S',
      packageDependencies: [{ packageIdentifier: 'Microsoft.EdgeWebView2Runtime' }] };
    let lookups = 0;
    try {
      await resolveWingetPackageDependencies({ wingetId: 'Example.App', version: '1.0', architecture: 'x64', installerSha256: 'A'.repeat(64) }, {
        getInstallers: async () => { lookups++; return [installer]; }, getVersions: async () => [],
      });
      throw new Error('Expected the unchanged resolver to refuse the dependency');
    } catch (error) {
      expect(error).toMatchObject({ blockCode: 'unreviewed_dependency' });
      const block = error as { blockCode: 'unreviewed_dependency'; message: string };
      expect(unsupportedDependencyMessage({ code: block.blockCode, detail: block.message })).toContain('requires Microsoft.EdgeWebView2Runtime');
      expect(lookups).toBe(1);
    }
  });
});

describe("pretest classification boundaries", () => {
 it("accepts only exact unavailable producer messages", () => {
 expect(knownUnavailableDisposition("This app version is not available for automated deployment.")?.code).toBe("VERSION_UNAVAILABLE");
 expect(knownUnavailableDisposition("This app is not available for automated deployment.")?.code).toBe("PACKAGE_UNAVAILABLE");
 for(const value of [null, "Failed QA", "This app version is not available for automated deployment. extra"]) expect(knownUnavailableDisposition(value)).toBeNull();
 });
 it("requires every exact identity field and pretest phase", () => {
 const c={id:"candidate", status:"error", phase:"scanning_installer",winget_id:"Example.App",version:"1",architecture:"x86",installer_sha256:"A".repeat(64),package_profile_sha256:"B".repeat(64)};
 const e={candidateId:"candidate",wingetId:"Example.App",version:"1",architecture:"x86",hash:"a".repeat(64),profile:"b".repeat(64)};
 expect(isExactPretestCandidate(c,e)).toBe(true);
 for(const patch of [{status:"failed"},{phase:"installing"},{winget_id:"Other.App"},{version:"2"},{architecture:"x64"},{installer_sha256:"C".repeat(64)},{package_profile_sha256:"C".repeat(64)}]) expect(isExactPretestCandidate({...c,...patch},e)).toBe(false);
 });
});
