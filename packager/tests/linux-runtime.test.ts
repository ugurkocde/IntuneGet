import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { JobProcessor } from '../src/job-processor.js';
import type { PackagerConfig } from '../src/config.js';
import type { PackagingJob, JobPoller } from '../src/job-poller.js';

vi.mock('../src/logger.js', () => ({ createLogger: () => ({info:vi.fn(),debug:vi.fn(),warn:vi.fn(),error:vi.fn()}) }));
vi.mock('../src/intune-uploader.js', () => ({ IntuneUploader: class {}, DuplicateAppError: class extends Error {} }));
const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(p => fs.rm(p,{recursive:true,force:true}))); });
async function fixture(host = 'linux') {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'linux-runtime-')); roots.push(root);
  const config = {paths:{work:path.join(root,'work'),tools:path.join(root,'tools')}} as PackagerConfig;
  const poller = {updateJobProgress:vi.fn(),updateJobStatus:vi.fn()} as unknown as JobPoller;
  const p = new JobProcessor(config,poller);
  Reflect.set(p,'hostPlatform',() => host);
  const tools=vi.fn(async () => {}), download=vi.fn(async (_job:PackagingJob,_dir:string):Promise<string> => { throw new Error('test download stop'); });
  Reflect.set(p,'ensureToolsAvailable',tools);Reflect.set(p,'downloadInstaller',download);
  const job = {id:'fixture-job',installer_type:'exe',installer_url:'https://example.invalid/fixture.exe',installer_sha256:'a'.repeat(64),package_config:{}} as PackagingJob;
  return {root,config,poller,p,job,tools,download};
}

describe('Linux runtime routing', () => {
  it.each(['zip','msix','appx','unknown',''])('refuses unsupported %s before side effects',async type => {
    const f=await fixture();f.job.installer_type=type;
    await expect(f.p.processJob(f.job)).rejects.toThrow(/Linux|Windows/i);
    expect(f.tools).not.toHaveBeenCalled();expect(f.download).not.toHaveBeenCalled();expect(f.poller.updateJobProgress).not.toHaveBeenCalled();
    await expect(fs.stat(f.config.paths.work)).rejects.toMatchObject({code:'ENOENT'});
  });
  it.each([{nestedInstallerType:'portable'},{nestedInstallerPath:'app.exe'},{nestedInstallerType:''},{nestedInstallerPath:null}])('refuses any nested descriptor %j',async config => {
    const f=await fixture();f.job.package_config=config;
    await expect(f.p.processJob(f.job)).rejects.toThrow(/Linux|nested|Windows/i);
    expect(f.tools).not.toHaveBeenCalled();expect(f.poller.updateJobProgress).not.toHaveBeenCalled();
  });
  it.each(['../escape','..','a/b','a\\b','C:job','bad\0job'])('refuses unsafe job id %j without deleting preexisting work',async id => {
    const f=await fixture();f.job.id=id;
    await fs.mkdir(f.config.paths.work,{recursive:true});await fs.writeFile(path.join(f.config.paths.work,'keep'),'unchanged');
    await expect(f.p.processJob(f.job)).rejects.toThrow(/job|path|Linux/i);
    expect(f.tools).not.toHaveBeenCalled();expect(await fs.readFile(path.join(f.config.paths.work,'keep'),'utf8')).toBe('unchanged');
  });
  it.each(['CON.exe','bad%3F.exe','bad%00.exe','trailing.%20exe.'])('refuses filename %s before callback or download',async name => {
    const f=await fixture();f.job.installer_url='https://example.invalid/'+name;
    await expect(f.p.processJob(f.job)).rejects.toThrow(/path|Windows/i);
    expect(f.poller.updateJobProgress).not.toHaveBeenCalled();expect(f.download).not.toHaveBeenCalled();
  });
  it('creates a fresh job directory, never reuses or removes a leftover',async () => {
    const f=await fixture();const old=path.join(f.config.paths.work,f.job.id);
    await fs.mkdir(old,{recursive:true});await fs.writeFile(path.join(old,'keep'),'old');
    let created='';f.download.mockImplementation(async (_job?:unknown,dir?:string) => { created=dir!;expect(path.dirname(created)).toBe(await fs.realpath(f.config.paths.work));expect(created).not.toBe(old);if(process.platform!=='win32')expect((await fs.stat(created)).mode&0o777).toBe(0o700);throw new Error('test download stop'); });
    await expect(f.p.processJob(f.job)).rejects.toThrow('test download stop');
    expect(await fs.readFile(path.join(old,'keep'),'utf8')).toBe('old');await expect(fs.stat(created)).rejects.toMatchObject({code:'ENOENT'});
  });
  it.each(['MSI','wix','exe','inno','nullsoft','burn','portable'])('admits only direct family %s',async type => {
    const f=await fixture();f.job.installer_type=type;
    await expect(f.p.processJob(f.job)).rejects.toThrow('test download stop');expect(f.download).toHaveBeenCalledOnce();
  });
  it('refuses other hosts before progress or filesystem access',async () => {
    const f=await fixture('darwin');await expect(f.p.processJob(f.job)).rejects.toThrow(/unsupported|Linux|Windows/i);expect(f.poller.updateJobProgress).not.toHaveBeenCalled();
  });
  it('keeps Windows fixed job directory behavior',async () => {
    const f=await fixture('win32');await expect(f.p.processJob(f.job)).rejects.toThrow('test download stop');expect(f.download.mock.calls[0][1]).toBe(path.join(f.config.paths.work,f.job.id));
  });
  it('uses native writer on Linux without launching or extracting a process',async () => {
    const f=await fixture();const packageDir=path.join(f.root,'Package');await fs.mkdir(packageDir);await fs.writeFile(path.join(packageDir,'Invoke-AppDeployToolkit.exe'),'synthetic never executed');
    const run=vi.fn(),ps=vi.fn(),extract=vi.fn();Reflect.set(f.p,'runProcess',run);Reflect.set(f.p,'runPowerShell',ps);Reflect.set(f.p,'extractPackageContents',extract);
    const result=await Reflect.get(f.p,'createIntunewinPackage').call(f.p,packageDir,f.root);
    expect((await fs.stat(result.intunewinPath)).size).toBeGreaterThan(0);expect((await fs.stat(result.encryptedContentPath)).size).toBe(result.encryptedContentSize);
    expect(run).not.toHaveBeenCalled();expect(ps).not.toHaveBeenCalled();expect(extract).not.toHaveBeenCalled();
  });
  it('Linux tool setup rejects corrupt pinned archive without PowerShell or Windows executable',async () => {
    const f=await fixture();const real = JobProcessor.prototype.ensureToolsAvailable.bind(f.p);
    const manifest=Reflect.get(f.p,'toolManifest').call(f.p);await fs.mkdir(f.config.paths.tools,{recursive:true});await fs.writeFile(path.join(f.config.paths.tools,manifest.psadtTemplate.archiveName),'corrupt pinned archive');
    const run=vi.fn(),download=vi.fn();Reflect.set(f.p,'runPowerShell',run);Reflect.set(f.p,'downloadFile',download);
    await expect(real()).rejects.toThrow(/hash|pin|integrity/i);expect(run).not.toHaveBeenCalled();expect(download).not.toHaveBeenCalled();
    await expect(fs.stat(path.join(f.config.paths.tools,'IntuneWinAppUtil.exe'))).rejects.toMatchObject({code:'ENOENT'});
  });
  it('Windows setup retains existing verifier without reading Node toolkit archive',async () => {
    const f=await fixture('win32');const ps=vi.fn(async () => '');Reflect.set(f.p,'runPowerShell',ps);Reflect.set(f.p,'verifyToolFile',vi.fn(async()=>{}));
    await JobProcessor.prototype.ensureToolsAvailable.call(f.p);expect(ps).toHaveBeenCalledOnce();
  });
  it.each(['darwin','freebsd'])('tool setup refuses %s without creating a tools directory',async host => {
    const f=await fixture(host);await expect(JobProcessor.prototype.ensureToolsAvailable.call(f.p)).rejects.toThrow(/Unsupported/);
    await expect(fs.stat(f.config.paths.tools)).rejects.toMatchObject({code:'ENOENT'});
  });
  it('bounds cached archive size before opening or allocating its contents',async () => {
    const f=await fixture();const archive=path.join(f.root,'oversize.zip');const file=await fs.open(archive,'wx');
    await file.truncate(128*1024*1024+1);await file.close();const open=vi.spyOn(fs,'open');
    await expect(Reflect.get(f.p,'loadToolkitArchive').call(f.p,archive)).rejects.toThrow(/bounded/);expect(open).not.toHaveBeenCalled();
  });
  it('refuses a directory as cached archive',async () => {
    const f=await fixture();await expect(Reflect.get(f.p,'loadToolkitArchive').call(f.p,f.root)).rejects.toThrow(/regular/);
  });
  it('reads only the stable regular archive bytes',async () => {
    const f=await fixture();const archive=path.join(f.root,'snapshot.zip');await fs.writeFile(archive,'synthetic archive bytes');
    expect(await Reflect.get(f.p,'loadToolkitArchive').call(f.p,archive)).toEqual(Buffer.from('synthetic archive bytes'));
  });
  it('rejects a cached archive that grows after its open snapshot',async () => {
    const f=await fixture();const archive=path.join(f.root,'growing.zip');await fs.writeFile(archive,'synthetic archive bytes');
    const open=fs.open.bind(fs);vi.spyOn(fs,'open').mockImplementation(async (...args:Parameters<typeof fs.open>) => {
      const file=await open(...args);const read=file.read.bind(file);
      Reflect.set(file,'read',async (...readArgs:unknown[]) => {await fs.appendFile(archive,'changed');return Reflect.apply(read,file,readArgs);});return file;
    });
    await expect(Reflect.get(f.p,'loadToolkitArchive').call(f.p,archive)).rejects.toThrow(/grew|changed/);
  });
});
