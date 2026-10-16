import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { JobProcessor } from '../src/job-processor.js';
import type { PackagerConfig } from '../src/config.js';

vi.mock('../src/logger.js', () => ({ createLogger: () => ({info:vi.fn(),debug:vi.fn(),warn:vi.fn(),error:vi.fn(),progress:vi.fn()}) }));
const dirs: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(dirs.splice(0).map(p => rm(p, {recursive:true,force:true}))); });
async function fixture() {
  const tools = await mkdtemp(join(tmpdir(), 'intuneget-tool-test-')); dirs.push(tools);
  const fetch = vi.fn(async () => new Response('synthetic untrusted tool'));
  const config = {packagerId:'fixture',mode:'api',api:{url:'http://127.0.0.1:1',key:'synthetic-key'},supabase:{url:'',serviceRoleKey:''},azure:{clientId:'00000000-0000-0000-0000-000000000001',clientSecret:'synthetic-secret',useManagedIdentity:false},polling:{interval:5000,staleJobTimeout:300000},paths:{work:tools,tools},proxy:{fetch}} as unknown as PackagerConfig;
  return {tools,fetch,processor:new JobProcessor(config,null)};
}
describe('local packaging tool integrity', () => {
  it('refuses a modified cached executable even when the toolkit layout exists', async () => {
    const {tools,processor} = await fixture();
    await writeFile(join(tools,'IntuneWinAppUtil.exe'),'synthetic modified tool');
    await mkdir(join(tools,'PSAppDeployToolkit','PSAppDeployToolkit'),{recursive:true});
    await writeFile(join(tools,'PSAppDeployToolkit','Invoke-AppDeployToolkit.exe'),'synthetic launcher');
    const powershell = vi.fn(async () => '');
    Reflect.set(processor,'runPowerShell',powershell);
    await expect(processor.ensureToolsAvailable()).rejects.toThrow(/hash|integrity/i);
    expect(powershell).not.toHaveBeenCalled();
  });
  it('does not write a downloaded buffer that fails the expected hash', async () => {
    const {tools,processor} = await fixture();
    const dest = join(tools,'tool.fixture');
    const expected = createHash('sha256').update('different synthetic bytes').digest('hex');
    await expect(Reflect.get(processor,'downloadFile').call(processor,'https://example.invalid/tool.fixture',dest,expected)).rejects.toThrow(/hash|integrity/i);
    await expect(readFile(dest)).rejects.toMatchObject({code:'ENOENT'});
  });
  it('publishes only matching downloaded bytes at the requested file name', async () => {
    const {tools,processor} = await fixture();
    const dest = join(tools,'tool.fixture');
    const expected = createHash('sha256').update('synthetic untrusted tool').digest('hex');
    await Reflect.get(processor,'downloadFile').call(processor,'https://example.invalid/tool.fixture',dest,expected);
    expect(await readFile(dest,'utf8')).toBe('synthetic untrusted tool');
  });
  it('keeps both pins and URLs identical to the existing workflow reference', async () => {
    const manifest = JSON.parse(await readFile(join(process.cwd(),'packager/scripts/tool-manifest.json'),'utf8'));
    const workflow = await readFile(join(process.cwd(),'.github/workflows-reference/package-intunewin.yml'),'utf8');
    expect(workflow).toContain('INTUNEWINAPPUTIL_SHA256: '+manifest.intuneWinAppUtil.sha256);
    expect(workflow).toContain('PSADT_TEMPLATE_SHA256: '+manifest.psadtTemplate.sha256);
    expect(workflow).toContain('INTUNEWINAPPUTIL_URL: '+manifest.intuneWinAppUtil.url);
    expect(workflow).toContain('PSADT_TEMPLATE_URL: '+manifest.psadtTemplate.url);
  });

  it('refuses a modified tool copy immediately before launching the packaging process', async () => {
    const {tools,processor} = await fixture();
    await writeFile(join(tools,'IntuneWinAppUtil.exe'),'synthetic modified tool');
    const packageDir=join(tools,'package'); await mkdir(packageDir);
    await writeFile(join(packageDir,'Invoke-AppDeployToolkit.exe'),'synthetic launcher');
    const run=vi.fn(async () => ''); Reflect.set(processor,'runProcess',run);
    await expect(Reflect.get(processor,'createIntunewinPackage').call(processor,packageDir,tools)).rejects.toThrow(/hash|integrity/i);
    expect(run).not.toHaveBeenCalled();
  });

});
