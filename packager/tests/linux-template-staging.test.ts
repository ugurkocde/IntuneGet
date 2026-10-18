import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { JobProcessor } from '../src/job-processor.js';
import type { PackagerConfig } from '../src/config.js';

vi.mock('../src/logger.js',()=>({createLogger:()=>({info:vi.fn(),debug:vi.fn(),warn:vi.fn(),error:vi.fn()})}));
vi.mock('../src/intune-uploader.js',()=>({IntuneUploader:class {},DuplicateAppError:class extends Error {}}));
// Reader integrity is tested against the actual pin and Windows verifier separately.
// This isolated mock exercises only which verified template paths assembly consumes.
const mocks=vi.hoisted(()=>({initialize:vi.fn()}));
vi.mock('../src/toolkit-archive.js',()=>({TOOLKIT_LIMITS:{archiveBytes:128*1024*1024},initializePinnedToolkit:mocks.initialize}));
const dirs:string[]=[];
afterEach(async()=>{vi.restoreAllMocks();mocks.initialize.mockReset();await Promise.all(dirs.splice(0).map(p=>fs.rm(p,{recursive:true,force:true})));});
async function template(root:string,label:string) {
  for(const dir of ['PSAppDeployToolkit','Config','Strings','Assets']){await fs.mkdir(path.join(root,dir),{recursive:true});await fs.writeFile(path.join(root,dir,'fixture.txt'),label);}
  await fs.writeFile(path.join(root,'Invoke-AppDeployToolkit.exe'),label);
  await fs.writeFile(path.join(root,'not-part-of-package.txt'),'do not copy');
}
it.each(['linux','win32'])('assembles the same subset from the correct private or legacy source on %s',async host=>{
  const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'template-routing-'));dirs.push(root);
  const tools=path.join(root,'tools'),work=path.join(root,'fresh-job');await fs.mkdir(work,{mode:0o700});await fs.mkdir(tools);
  await template(path.join(tools,'PSAppDeployToolkit'),'legacy shared template');
  await fs.writeFile(path.join(tools,'PSAppDeployToolkit_Template_v4.zip'),'synthetic archive snapshot');
  mocks.initialize.mockImplementation(async(bytes:Buffer,destination:string)=>{expect(bytes.toString()).toBe('synthetic archive snapshot');expect(destination).toBe(path.join(work,'toolkit'));await expect(fs.stat(destination)).rejects.toMatchObject({code:'ENOENT'});const verified=path.join(destination,'PSAppDeployToolkit');await template(verified,'verified private template');return verified;});
  const p=new JobProcessor({paths:{tools,work:root}} as PackagerConfig,null);Reflect.set(p,'hostPlatform',()=>host);
  const generate=vi.fn(()=> '# synthetic generator output');Reflect.set(p,'generateDeployScript',generate);
  const installer=path.join(work,'fixture.exe');await fs.writeFile(installer,'synthetic installer, never executed');
  const packageDir=await Reflect.get(p,'createPsadtPackage').call(p,{},installer,work);
  const expected=host==='linux'?'verified private template':'legacy shared template';
  for(const dir of ['PSAppDeployToolkit','Config','Strings','Assets'])expect(await fs.readFile(path.join(packageDir,dir,'fixture.txt'),'utf8')).toBe(expected);
  expect(await fs.readFile(path.join(packageDir,'Invoke-AppDeployToolkit.exe'),'utf8')).toBe(expected);
  expect(await fs.readFile(path.join(packageDir,'Files','fixture.exe'),'utf8')).toBe('synthetic installer, never executed');
  expect(await fs.readFile(path.join(packageDir,'Invoke-AppDeployToolkit.ps1'),'utf8')).toBe('\uFEFF# synthetic generator output');
  await expect(fs.stat(path.join(packageDir,'not-part-of-package.txt'))).rejects.toMatchObject({code:'ENOENT'});
  expect(generate).toHaveBeenCalledOnce();expect(mocks.initialize).toHaveBeenCalledTimes(host==='linux'?1:0);
});
