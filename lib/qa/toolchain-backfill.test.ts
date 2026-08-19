import { describe, expect, it } from 'vitest';
import { QA_PSADT_TOOLCHAIN } from './package-profile';
import {
  shouldRetryTerminalToolchainCandidate,
  terminalToolchainRetryTargets,
} from './toolchain-backfill';

describe('QA toolchain targeted retries', () => {
  it('does not carry blocked Bria into the PotPlayer release', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'bria.bria', status: 'failed' }
    )).toBe(false);
    expect(shouldRetryTerminalToolchainCandidate(
      '16a626f329d93d1e499c1db30a243d9dc18a2aa6',
      { wingetId: 'Bria.Bria', status: 'failed' }
    )).toBe(true);
  });

  it('retries PotPlayer only on its reviewed all-users release', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'daum.potplayer', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      '16a626f329d93d1e499c1db30a243d9dc18a2aa6',
      { wingetId: 'Daum.PotPlayer', status: 'failed' }
    )).toBe(false);
  });

  it('retries Autodesk Licensing Service only on its dedicated lifecycle release', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'autodesk.licensingservice', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      '12831539c9dc30678c6f16367faab76820502d2a',
      { wingetId: 'Autodesk.LicensingService', status: 'failed' }
    )).toBe(false);
  });

  it('retries CutePDF once with its vendor-specific silent removal adapter', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'acrosoftware.cutepdfwriter', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      '6af0cfac18f3c4653a69a01f41bc1170c1237807',
      { wingetId: 'AcroSoftware.CutePDFWriter', status: 'failed' }
    )).toBe(false);
  });

  it('retries Ubuntu on the Appx provisioning heartbeat release', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'canonical.ubuntu.2404', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      '77735e28d450c6b1c4f14a9a667bc5336eeeb3ea',
      { wingetId: 'Canonical.Ubuntu.2404', status: 'failed' }
    )).toBe(false);
  });

  it('exposes a defensive copy of current terminal retry targets', () => {
    const targets = terminalToolchainRetryTargets(QA_PSADT_TOOLCHAIN.packagerCommit);
    expect(targets).toEqual(expect.arrayContaining([
      'PDFsam.PDFsam',
      'Mega.MEGASync',
      'AOMEI.PartitionAssistant',
      'Ringler.SnapformViewer',
      'Cisco.Jabber',
      'IPEVO.Visualizer',
      'IPEVO.VisualizerLTSE',
      'Sonos.Controller',
      'karakun.OpenWebStart',
      'MSYS2.MSYS2',
      'Insta360.Link.Controller',
      'Logitech.SetPoint',
      'Timely.Memory',
      'Blizzard.BattleNet',
      'DATEV.SicherheitspaketCompact',
      'Autodesk.LicensingService',
      'Daum.PotPlayer',
    ]));
    expect(targets).not.toContain('Acronis.CyberProtectHomeOffice');

    targets.length = 0;

    expect(terminalToolchainRetryTargets(QA_PSADT_TOOLCHAIN.packagerCommit)).toEqual(
      expect.arrayContaining([
        'PDFsam.PDFsam',
        'Mega.MEGASync',
        'AOMEI.PartitionAssistant',
        'Ringler.SnapformViewer',
        'Cisco.Jabber',
        'IPEVO.Visualizer',
        'IPEVO.VisualizerLTSE',
        'Sonos.Controller',
        'karakun.OpenWebStart',
        'MSYS2.MSYS2',
        'Insta360.Link.Controller',
        'Logitech.SetPoint',
        'Timely.Memory',
        'Blizzard.BattleNet',
        'DATEV.SicherheitspaketCompact',
        'Autodesk.LicensingService',
        'Daum.PotPlayer',
      ])
    );
    expect(
      terminalToolchainRetryTargets(QA_PSADT_TOOLCHAIN.packagerCommit)
    ).not.toContain('Acronis.CyberProtectHomeOffice');
  });

  it('does not repeat the consumed .NET Framework retry in the Sonos releases', () => {
    expect(terminalToolchainRetryTargets(
      '5569c16d136f464cbc014f40c70645414c601751'
    )).toContain('Microsoft.DotNet.Framework.Runtime');
    expect(terminalToolchainRetryTargets(
      QA_PSADT_TOOLCHAIN.packagerCommit
    )).not.toContain('Microsoft.DotNet.Framework.Runtime');
  });

  it('carries Sonos into the administrative-image retry after failed extraction', () => {
    expect(terminalToolchainRetryTargets(
      'e6dfe920d82e0b62c5d5e420fb603f61acdb5a42'
    )).toContain('Sonos.Controller');
    expect(terminalToolchainRetryTargets(
      QA_PSADT_TOOLCHAIN.packagerCommit
    )).toContain('Sonos.Controller');
  });

  it('retries PDFsam once with its documented managed MSI command', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      '404c9718a2c977722850bc9d70a02772a9bd1c7a',
      { wingetId: 'pdfsam.pdfsam', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'pdfsam.pdfsam', status: 'failed' }
    )).toBe(true);
  });

  it('retries MEGAsync once with its reviewed all-users command', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'mega.megasync', status: 'failed' }
    )).toBe(true);
  });

  it('retries PTC Creo View Express with the corrected MSI-forwarding command', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'ptc.creoview.express', status: 'failed' }
    )).toBe(true);
  });

  it('retries Battle.net with its required WinGet install location', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'blizzard.battlenet', status: 'failed' }
    )).toBe(true);
  });

  it('keeps the Office Deployment Tool managed lifecycle retry scoped to its release', () => {
    const wingetId = 'Microsoft.OfficeDeploymentTool';
    expect(shouldRetryTerminalToolchainCandidate(
      '2e68a941d3410e4eb7c6ed1e73fbc0eff290c807',
      { wingetId, status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId, status: 'failed' }
    )).toBe(false);
  });

  it.each([
    'Microsoft.SQLServerManagementStudio.21',
    'Microsoft.SQLServerManagementStudio.22',
    'Microsoft.SQLServerManagementStudio.22.Preview',
  ])('keeps the SSMS retry scoped to its historical toolchain release for %s', (wingetId) => {
    expect(shouldRetryTerminalToolchainCandidate(
      '072dc26c5c25369bf01f265af5af17c47c0e50e5',
      { wingetId, status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId, status: 'failed' }
    )).toBe(false);
  });

  it('does not replay the already-resolved xTool failure on the current pin', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      'b3b2729bab6959a554c0e6d41af0a841d6177386',
      { wingetId: 'Makeblock.xToolStudio', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      '93321ef6f7abd287f0fd6f37e37c5f4c199f3c4e',
      { wingetId: 'Makeblock.xToolStudio', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      '7d389dbd6e55b719e3d71772717cda0c8f724469',
      { wingetId: 'Makeblock.xToolStudio', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'Makeblock.xToolStudio', status: 'failed' }
    )).toBe(false);
  });

  it('does not replay the already-resolved LTspice failure on the current pin', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      '93321ef6f7abd287f0fd6f37e37c5f4c199f3c4e',
      { wingetId: 'AnalogDevices.LTspice', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      '7d389dbd6e55b719e3d71772717cda0c8f724469',
      { wingetId: 'AnalogDevices.LTspice', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'AnalogDevices.LTspice', status: 'failed' }
    )).toBe(false);
  });

  it('retries Opera once on the reviewed immediate-uninstall release', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      '681b7510f7f30bec92c17581213c9ebc7f72765a',
      { wingetId: 'Opera.Opera', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      '9ff409ddabd3b1b4f8c65ad03b1f9e37778589fc',
      { wingetId: 'Opera.Opera', status: 'failed' }
    )).toBe(false);
    expect(shouldRetryTerminalToolchainCandidate(
      '8235887e7126972b89c264e2053c1c4f7418ea74',
      { wingetId: 'Opera.Opera', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'Opera.Opera', status: 'failed' }
    )).toBe(false);
  });

  it('retries Opera GX on its reviewed machine-wide removal release', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      '9f3105f568ec221fb672a53f1dbafdf01cd2e8b5',
      { wingetId: 'Opera.OperaGX', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      '4ca2932ca8ff26578cade36457f0fcc150513e4c',
      { wingetId: 'Opera.OperaGX', status: 'failed' }
    )).toBe(false);
  });

  it('retries HP Image Assistant on its managed extracted-payload release', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      '34189c6876f0fe4539b971ba1b9e962ff66cd259',
      { wingetId: 'HP.ImageAssistant', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      '9f3105f568ec221fb672a53f1dbafdf01cd2e8b5',
      { wingetId: 'HP.ImageAssistant', status: 'failed' }
    )).toBe(false);
  });

  it('retries Evernote and the pending HP validation on the process-close release', () => {
    for (const wingetId of ['Evernote.Evernote', 'HP.ImageAssistant']) {
      expect(shouldRetryTerminalToolchainCandidate(
        '1490844284f84f807e207fb9970bddc499bbe446',
        { wingetId, status: 'failed' }
      )).toBe(true);
      expect(shouldRetryTerminalToolchainCandidate(
        QA_PSADT_TOOLCHAIN.packagerCommit,
        { wingetId, status: 'failed' }
      )).toBe(false);
    }
    expect(shouldRetryTerminalToolchainCandidate(
      '34189c6876f0fe4539b971ba1b9e962ff66cd259',
      { wingetId: 'Evernote.Evernote', status: 'failed' }
    )).toBe(false);
  });

  it('keeps the Viber retry scoped to its user-scope release', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      '9214e4b5b71508bfba9aa1a2d4de5c3c771d3fea',
      { wingetId: 'Rakuten.Viber', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'Rakuten.Viber', status: 'failed' }
    )).toBe(false);
  });

  it.each([
    'Anthropic.ClaudeCode',
    'Google.PlatformTools',
  ])('retries %s once on the portable archive release', (wingetId) => {
    expect(shouldRetryTerminalToolchainCandidate(
      '3fce249f5021c120a23ed0ab5dc726baaf060f3e',
      { wingetId, status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId, status: 'failed' }
    )).toBe(false);
  });

  it('keeps the registered-command Dell retry scoped to its release', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      '4ca55ff8ac8d4d5f6d07665adbe06a07f0110006',
      { wingetId: 'Dell.Optimizer', status: 'failed' }
    )).toBe(true);
  });

  it('retries Dell Optimizer on the packaged Dell Update removal release', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      '4ca2932ca8ff26578cade36457f0fcc150513e4c',
      { wingetId: 'Dell.Optimizer', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'Dell.Optimizer', status: 'failed' }
    )).toBe(false);
  });

  it('keeps WebView2 replay scoped to its shared-runtime lifecycle releases', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      'f4bc37886e490ece525c701562869734a7e366d5',
      { wingetId: 'Microsoft.EdgeWebView2Runtime', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      '7d389dbd6e55b719e3d71772717cda0c8f724469',
      { wingetId: 'Microsoft.EdgeWebView2Runtime', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'Microsoft.EdgeWebView2Runtime', status: 'failed' }
    )).toBe(false);
  });

  it('keeps the Granola diagnostics replay scoped to its historical releases', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      '7d389dbd6e55b719e3d71772717cda0c8f724469',
      { wingetId: 'Granola.Granola', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      'f4bc37886e490ece525c701562869734a7e366d5',
      { wingetId: 'Granola.Granola', status: 'failed' }
    )).toBe(false);
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'Granola.Granola', status: 'failed' }
    )).toBe(false);
  });

  it.each([
    'Microsoft.VisualStudio.2019.BuildTools',
    'Microsoft.VisualStudio.2019.Community',
    'Microsoft.VisualStudio.2019.Enterprise',
    'Microsoft.VisualStudio.2019.Professional',
    'Mozilla.Firefox.de',
  ])(
    'keeps the terminal %s retry scoped to its historical toolchain release',
    (wingetId) => {
      expect(shouldRetryTerminalToolchainCandidate(
        'bbd8948f2bbefeaba9caf51f6e36ce5d26fdff35',
        { wingetId, status: 'failed' }
      )).toBe(true);
      expect(shouldRetryTerminalToolchainCandidate(
        QA_PSADT_TOOLCHAIN.packagerCommit,
        { wingetId, status: 'failed' }
      )).toBe(false);
    }
  );

  it.each([
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
  ])('retries terminal %s through the current reviewed instance root', (wingetId) => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId, status: 'failed' }
    )).toBe(true);
  });

  it('retries OpenWebStart once with its install4j unattended uninstaller', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'karakun.openwebstart', status: 'failed' }
    )).toBe(true);
  });

  it('retries MSYS2 once with its reviewed product identity and uninstaller', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'msys2.msys2', status: 'failed' }
    )).toBe(true);
  });

  it('keeps the VirtualBox retry scoped to its historical toolchain release', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      'bafea79a8dde42be074c385c35b4887fb5833aa0',
      { wingetId: 'Oracle.VirtualBox', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'Oracle.VirtualBox', status: 'failed' }
    )).toBe(false);
  });

  it('keeps the resolved Greenshot retry on its tool-cache release', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      'acfe2d8692cc2b910281236ff47d3ee5b2ce2b99',
      { wingetId: 'Greenshot.Greenshot', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      '681b7510f7f30bec92c17581213c9ebc7f72765a',
      { wingetId: 'Greenshot.Greenshot', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'Greenshot.Greenshot', status: 'failed' }
    )).toBe(false);
  });

  it('retries Qfinder Pro once with its runtime and process lifecycle fix', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      '7e83c363bcbafca153f00113b12ede2e332b2d2d',
      { wingetId: 'QNAP.QfinderPro', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'QNAP.QfinderPro', status: 'failed' }
    )).toBe(false);
    expect(shouldRetryTerminalToolchainCandidate(
      '681b7510f7f30bec92c17581213c9ebc7f72765a',
      { wingetId: 'QNAP.QfinderPro', status: 'failed' }
    )).toBe(false);
  });

  it('retries VisualCppRedist once with reviewed multi-product evidence', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      '670357c92fefa433036d8667dd5f382731d8326e',
      { wingetId: 'ABBODI1406.VCREDIST', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      '7e83c363bcbafca153f00113b12ede2e332b2d2d',
      { wingetId: 'abbodi1406.vcredist', status: 'failed' }
    )).toBe(false);
  });

  it('retries PostgreSQL 13 once with the family unattended lifecycle', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      '2c40f49e2cb0b5a1f7a1c27996f5aee72553a074',
      { wingetId: 'postgresql.postgresql.13', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      '670357c92fefa433036d8667dd5f382731d8326e',
      { wingetId: 'PostgreSQL.PostgreSQL.13', status: 'failed' }
    )).toBe(false);
  });

  it('retries EA Desktop once with the registered Burn helper lifecycle', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      'e6a4ae2f4f9a3a672c6912ab8e309483f53003b7',
      { wingetId: 'electronicarts.eadesktop', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      '2c40f49e2cb0b5a1f7a1c27996f5aee72553a074',
      { wingetId: 'ElectronicArts.EADesktop', status: 'failed' }
    )).toBe(false);
  });

  it('retries EA Desktop once after adding its process-close lifecycle', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      '2dca138ee2fe27dc45166dba536511aa80d8937e',
      { wingetId: 'ELECTRONICARTS.EADESKTOP', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      'e6a4ae2f4f9a3a672c6912ab8e309483f53003b7',
      { wingetId: 'ElectronicArts.EADesktop', status: 'failed' }
    )).toBe(true);
  });

  it('retries MPC-BE once after strengthening Inno quiet uninstall arguments', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      '54515b6566ff4e7c9040fa24a8eba6b6347ef09e',
      { wingetId: 'mpc-be.mpc-be', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'MPC-BE.MPC-BE', status: 'failed' }
    )).toBe(false);
  });

  it('retries Camera Hub once after guarding its MSI pre-uninstall helper', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      'cf24633576b6c5efcca5fbde8ffe7fb4f0f57272',
      { wingetId: 'elgato.camerahub', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'elgato.camerahub', status: 'failed' }
    )).toBe(false);
  });

  it('retries VSTO once with its reviewed external-installer removal switches', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      '54515b6566ff4e7c9040fa24a8eba6b6347ef09e',
      { wingetId: 'microsoft.vstor', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'Microsoft.VSTOR', status: 'failed' }
    )).toBe(false);
  });

  it.each(['Autodesk.DesktopApp'])('does not replay retired %s on the current pin', (wingetId) => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId, status: 'failed' }
    )).toBe(false);
  });

  it('keeps the OCS retry scoped to its historical toolchain release', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      'fc18fffd40f6d362be251e05e2bc784373dfc735',
      { wingetId: 'OCSInventoryNG.WindowsAgent', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'OCSInventoryNG.WindowsAgent', status: 'failed' }
    )).toBe(false);
  });

  it('does not replay an unrelated terminal failure', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'Unrelated.App', status: 'failed' }
    )).toBe(false);
  });

  it('retries Horizon Client after suppressing Burn uninstall restarts', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      'af4dfb94c9109ca598abc16a4b8cad57f6790066',
      { wingetId: 'OMNISSA.HORIZONCLIENT', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'OMNISSA.HORIZONCLIENT', status: 'failed' }
    )).toBe(false);
  });

  it('retries Ecosia once with Chromium silent removal', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      '94c8f81e38ac180048f86dbf2df7f987fa448676',
      { wingetId: 'ECOSIA.ECOSIABROWSER', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'ECOSIA.ECOSIABROWSER', status: 'failed' }
    )).toBe(false);
  });

  it('retries IntelliJ Ultimate with its exact named ARP key', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      'af4dfb94c9109ca598abc16a4b8cad57f6790066',
      { wingetId: 'jetbrains.intellijidea.ultimate', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'jetbrains.intellijidea.ultimate', status: 'failed' }
    )).toBe(false);
  });

  it('retries Snapform Viewer with install4j unattended removal', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'ringler.snapformviewer', status: 'failed' }
    )).toBe(true);
  });

  it.each([
    'Cisco.Jabber',
    'IPEVO.Visualizer',
  ])('retries %s after bypassing empty EXE path parsing for exact MSI removal', (wingetId) => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId, status: 'failed' }
    )).toBe(true);
  });

  it('retries Visualizer LTSE with exact version-suffixed ARP identity matching', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'ipevo.visualizerltse', status: 'failed' }
    )).toBe(true);
  });

  it('retries Sonos with its reviewed embedded-MSI lifecycle', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'sonos.controller', status: 'failed' }
    )).toBe(true);
  });

  it('retries Logitech Presentation after replacing its UAC-blocked user scope', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'logitech.presentation', status: 'failed' }
    )).toBe(true);
  });

  it('retries NVM after replacing its UAC-blocked user scope', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'coreybutler.nvmforwindows', status: 'failed' }
    )).toBe(true);
  });

  it('retries Autodesk Access with the exact ODIS quiet uninstall contract', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'autodesk.autodeskaccess', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      '81f443163ffb9f437be3901b44b6da74032032c4',
      { wingetId: 'Autodesk.AutodeskAccess', status: 'failed' }
    )).toBe(false);
  });

  it('retries Logitech G HUB only after activating its reviewed lifecycle', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'logitech.ghub', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      '7b2938c853d9a799ac76957bd122c5c7eb5406f5',
      { wingetId: 'Logitech.GHUB', status: 'failed' }
    )).toBe(false);
  });

  it('retries Arduino IDE only after activating machine-scope MSI normalization', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'arduinosa.ide.stable', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      '4537454fe9f0f942d59a7b748505b2318cf13a6c',
      { wingetId: 'ArduinoSA.IDE.stable', status: 'failed' }
    )).toBe(false);
  });

  it('retries OpenOffice only after activating exact-version prefix identity capture', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'apache.openoffice', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      '7c74dc4412c3e6834da9935cc74ab8371a7ed71f',
      { wingetId: 'Apache.OpenOffice', status: 'failed' }
    )).toBe(false);
  });

  it('keeps the consumed .NET Framework retry scoped to its registry-evidence release', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      '5569c16d136f464cbc014f40c70645414c601751',
      { wingetId: 'microsoft.dotnet.framework.runtime', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'microsoft.dotnet.framework.runtime', status: 'failed' }
    )).toBe(false);
  });

  it.each([
    'Autodesk.NavisworksFreedom.2026',
    'Autodesk.NavisworksFreedom.2027',
  ])('retries %s with its reviewed ODIS lifecycle', (wingetId) => {
    expect(shouldRetryTerminalToolchainCandidate(
      'ca77e52dc65a404eb81679c5188378bf4d69a692',
      { wingetId, status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId, status: 'failed' }
    )).toBe(false);
  });

  it('still rebuilds a non-terminal stale candidate', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'Unrelated.App', status: 'superseded' }
    )).toBe(true);
  });
});
