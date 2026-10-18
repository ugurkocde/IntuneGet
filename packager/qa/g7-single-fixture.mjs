#!/usr/bin/env node
// Human-operated Linux proof for PR1609. Never start the service or its poller.
import fs from 'node:fs/promises';
import { openSync, writeFileSync, fsyncSync, closeSync, constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function fixtureJob(tenantId, marker) {
  const detection = [{ type: 'registry',
    keyPath: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\IntuneGet\\Apps\\IntuneGet_Curated_NotepadPlusPlus',
    valueName: 'Version', check32BitOn64System: false, detectionType: 'version',
    operator: 'greaterThanOrEqual', detectionValue: '8.9.8.1' }];
  const job = {
    id: marker, tenant_id: tenantId, user_id: 'g7-local-proof', user_email: '',
    winget_id: 'IntuneGet.Curated.NotepadPlusPlus', display_name: 'Notepad++',
    publisher: 'Notepad++', version: '8.9.8.1', architecture: 'x64',
    installer_type: 'nullsoft', install_scope: 'machine',
    installer_url: 'https://github.com/notepad-plus-plus/notepad-plus-plus/releases/download/v8.9.8.1/npp.8.9.8.1.Installer.x64.exe',
    installer_sha256: '26f3bcced788fadbac4e7e577b430ea2ce6060cf3bcad993ef4612ecd7d743da',
    install_command: '"npp.8.9.8.1.Installer.x64.exe" /S',
    uninstall_command: 'REGISTRY_UNINSTALL_KEY:Notepad++:Notepad++',
    detection_rules: detection, status: 'packaging', progress_percent: 0,
    created_at: new Date().toISOString(),
    package_config: { description: marker, psadtConfig: {
      processesToClose: [], showClosePrompt: false, closeCountdown: 60,
      blockExecution: false, promptToSave: false, persistPrompt: false,
      minimizeWindows: false, windowLocation: 'Default', allowDefer: false,
      deferTimes: 3, checkDiskSpace: false, restartBehavior: 'Suppress',
      deployMode: 'Silent', removeExistingInstall: false,
      progressDialog: { enabled: false }, customPrompts: [],
      restartPrompt: { enabled: false, countdownSeconds: 600, countdownNoHideSeconds: 60 },
      balloonTips: [], detectionRules: detection,
      reviewedInstallArguments: [], reviewedUninstallArguments: [],
      postInstallCommands: [], postUninstallCommands: [],
    } },
  };
  // Match the API's cart-item to job mapping without accepting an editable job.
  Object.assign(job.package_config, {
    appSource: 'win32', sourceType: 'curated', curatedSettingsMode: 'tested-defaults',
    curatedReleaseId: 'notepad-plus-plus:f8844a541ea6a174d0c375e8',
    wingetId: job.winget_id, displayName: job.display_name, publisher: job.publisher,
    version: job.version, architecture: job.architecture, installScope: job.install_scope,
    installerType: job.installer_type, installerUrl: job.installer_url,
    installerSha256: job.installer_sha256, installCommand: job.install_command,
    uninstallCommand: job.uninstall_command, detectionRules: job.detection_rules,
  });
  return job;
}

async function productModules() {
  const config = await import('../dist/config.js');
  const { JobProcessor } = await import('../dist/job-processor.js');
  const { GraphClient } = await import('../dist/graph-client.js');
  return { ...config, JobProcessor, GraphClient };
}

export async function runSingleFixture(proofDirectory, expectedDevTenant, loadProduct = productModules) {
  if (process.platform !== 'linux' || Number(process.versions.node.split('.')[0]) < 22) {
    throw new Error('LINUX_NODE22_REQUIRED');
  }
  if (typeof proofDirectory !== 'string' || !path.isAbsolute(proofDirectory)) {
    throw new Error('ABSOLUTE_PROOF_DIRECTORY_REQUIRED');
  }
  if (!guid.test(expectedDevTenant ?? '')) throw new Error('EXPECTED_DEV_TENANT_REQUIRED');
  for (const file of ['.env', '.env.local']) {
    if (await fs.stat(path.resolve(file)).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; })) {
      throw new Error('EMPTY_WORKING_DIRECTORY_REQUIRED');
    }
  }
  // No credentials are read here: the normal product loader uses the operator's
  // existing environment, including Node's --env-file argument from the runbook.
  const savedConsole = Object.fromEntries(['log','info','warn','error','debug'].map(key => [key, console[key]]));
  for (const key of Object.keys(savedConsole)) console[key] = () => {};
  let GraphClient, originalPost, ledgerFd;
  try {
    const { loadConfig, validateConfig, JobProcessor, GraphClient: ProductGraphClient } = await loadProduct();
    GraphClient = ProductGraphClient;
    originalPost = GraphClient.prototype.post;
    const config = loadConfig();
    if (validateConfig(config).length || config.azure.tenantId?.toLowerCase() !== expectedDevTenant.toLowerCase()) throw new Error('DEV_CONFIGURATION_MISMATCH');
    // Existing directory refuses a second run, including a previously failed one.
    await fs.mkdir(proofDirectory, { mode: 0o700 });
    const marker = 'IntuneGet-G7-Linux-160-' + randomUUID();
    const ledger = path.join(proofDirectory, 'receipt.jsonl');
    ledgerFd = openSync(ledger, 'wx', 0o600);
    const record = data => {
      writeFileSync(ledgerFd, JSON.stringify({ at: new Date().toISOString(), marker, ...data }) + '\n');
      fsyncSync(ledgerFd);
    };
    const print = data => process.stdout.write(JSON.stringify({ marker, ...data }) + '\n');
    await record({ stage: 'started', platform: process.platform, node: process.versions.node });
    print({ stage: 'started' });
    const localConfig = { ...config, paths: { work: path.join(proofDirectory, 'work'), tools: path.join(proofDirectory, 'tools') } };
    let attempted = false, createdId, deployed = false, packageSha256;
    // Observe only the product's app creation result. Content/upload/auth calls
    // remain unchanged. An ambiguous response is reconciled by Lokka, never retried.
    GraphClient.prototype.post = async function (endpoint, body) {
      if (endpoint !== '/deviceAppManagement/mobileApps') return originalPost.call(this, endpoint, body);
      if (attempted || body.description?.split('\n')[0] !== marker) throw new Error('UNEXPECTED_APP_CREATE');
      attempted = true;
      await record({ stage: 'create_attempted' });
      const result = await originalPost.call(this, endpoint, body);
      if (!guid.test(result?.id ?? '')) throw new Error('AMBIGUOUS_APP_CREATE');
      createdId = result.id;
      await record({ stage: 'created', appId: createdId });
      print({ stage: 'created', appId: createdId });
      return result;
    };
    // JobProcessor needs two status callbacks, not a real JobPoller. No queue,
    // ApiClient or Supabase client is constructed or called by this script.
    const sink = {
      async updateJobProgress() {},
      async updateJobStatus(_id, status, data) {
        if (status === 'uploading') {
          const jobs = await fs.readdir(localConfig.paths.work);
          if (jobs.length !== 1 || !jobs[0].startsWith(marker + '-')) throw new Error('UNEXPECTED_PACKAGE_TREE');
          const output = path.join(localConfig.paths.work, jobs[0], 'Output');
          const packages = await fs.readdir(output);
          if (packages.length !== 1 || !packages[0].startsWith('intunewin-')) throw new Error('PACKAGE_NOT_UNIQUE');
          const container = path.join(output, packages[0], 'Invoke-AppDeployToolkit.intunewin');
          const retained = path.join(proofDirectory, 'fixture.intunewin');
          await fs.copyFile(container, retained, constants.COPYFILE_EXCL);
          packageSha256 = createHash('sha256').update(await fs.readFile(retained)).digest('hex');
          await record({ stage: 'packaged', packageSha256 });
          print({ stage: 'packaged', packageSha256 });
        } else if (status === 'deployed') {
          deployed = Boolean(createdId && data?.intune_app_id === createdId);
        } else if (status === 'duplicate_skipped' && !attempted) {
          await record({ stage: 'no_create_duplicate' });
          print({ stage: 'no_create_duplicate' });
        } else {
          deployed = false;
        }
      },
    };
    try {
      await new JobProcessor(localConfig, sink).processJob(fixtureJob(expectedDevTenant, marker));
      if (!deployed || !packageSha256) throw new Error('UPLOAD_NOT_CONFIRMED');
      await record({ stage: 'upload_complete', appId: createdId, packageSha256 });
      print({ stage: 'upload_complete', appId: createdId, packageSha256 });
    } catch {
      const stage = attempted ? 'ambiguous_lokka_required' : 'no_create_stopped';
      await record({ stage, ...(createdId ? { appId: createdId } : {}) });
      print({ stage, ...(createdId ? { appId: createdId } : {}) });
      throw new Error('STOP_RECONCILE_DO_NOT_RERUN');
    }
  } finally {
    if (originalPost) GraphClient.prototype.post = originalPost;
    if (ledgerFd !== undefined) closeSync(ledgerFd);
    Object.assign(console, savedConsole);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const stop = () => {
    process.stderr.write('G7 stopped. Keep the proof directory and report sanitized output. Do not rerun.\n');
    process.exit(1);
  };
  process.on('uncaughtException', stop);
  process.on('unhandledRejection', stop);
  if (process.argv.length !== 4) {
    process.stderr.write('Usage: node --env-file=/existing/dev.env qa/g7-single-fixture.mjs /absolute/new/proof-directory expected-dev-tenant-guid\n');
    process.exit(1);
  } else {
    runSingleFixture(process.argv[2], process.argv[3]).then(() => process.exit(0), stop);
  }
}
