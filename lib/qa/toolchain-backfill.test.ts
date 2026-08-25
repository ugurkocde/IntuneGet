import { describe, expect, it } from 'vitest';
import { QA_PSADT_TOOLCHAIN } from './package-profile';
import {
  shouldRetryTerminalToolchainCandidate,
  terminalToolchainRetryTargets,
} from './toolchain-backfill';

describe('QA toolchain targeted retries', () => {
  it('does not replay DesktopOK after activating its managed-uninstall block', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: ' softwareok.desktopok ', status: 'failed' }
    )).toBe(false);
    expect(
      terminalToolchainRetryTargets(QA_PSADT_TOOLCHAIN.packagerCommit)
        .map((wingetId) => wingetId.toLowerCase())
    ).not.toContain('softwareok.desktopok');
  });

  it('retries RedisInsight only after activating its reviewed user scope', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: ' redisinsight.redisinsight ', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      '2eaa857bc5a1297ec7e7b521307079de4622b0b7',
      { wingetId: 'RedisInsight.RedisInsight', status: 'failed' }
    )).toBe(false);
  });

  it('retries Atlassian only after activating its documented quiet uninstall', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: ' atlassian.servicemanagementlts ', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      '326eafef044af8579bc0089c9556a3d59e26cbe0',
      { wingetId: 'Atlassian.ServiceManagementLTS', status: 'failed' }
    )).toBe(false);
  });

  it('carries Surfshark through diagnostics, visible-primary, and leaf-only releases', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: ' surfshark.surfshark ', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      '2d3d1b82c818613b2bd677ddbcf309e1f6dd12b1',
      { wingetId: 'Surfshark.Surfshark', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      'bb762159825bb59be2649f4cff4bf25fbbaef8b8',
      { wingetId: 'Surfshark.Surfshark', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      '228cd9def01122182631c91910554c05e9181edb',
      { wingetId: 'Surfshark.Surfshark', status: 'failed' }
    )).toBe(false);
  });

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
      'Tricentis.NeoLoad',
      'Piriform.Recuva',
      'Trimble.SketchUp.2022',
      'MiKTeX.MiKTeX',
      'Y-ASLant.ElegantClipboard',
      'Amazon.Music',
      'Greenshot.Greenshot.Preview',
      'ABB.RobotStudio',
      'Microsoft.msodbcsql.13',
      'Microsoft.WindowsAppRuntime.1.8',
      '8x8.Work',
      'Microsoft.FSLogix',
      'AvaCC.AvaDesktop',
      'Microsoft.RMSClient',
      'Movavi.MovaviPhotoFocus',
      'RedHat.Podman-Desktop',
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
      'Wiris.MathType.7',
      'Microsoft.AzureMonitorAgent',
      'Logitech.LogiBolt',
      'BlueJTeam.BlueJ',
      'Autodesk.DesignReview',
      'AppiumDevelopers.AppiumInspector',
      'Google.Chrome.Beta.EXE',
      'Microsoft.VisualStudio.BuildTools',
      'Microsoft.VisualStudio.2017.BuildTools',
      'Microsoft.VisualStudio.2019.BuildTools',
      'Microsoft.VisualStudio.2022.BuildTools',
      'Surfshark.Surfshark',
      'Waterfox.Waterfox',
      'Playnite.Playnite',
      'Tonec.InternetDownloadManager',
      'IObit.Uninstaller',
      'Autodesk.DesktopConnector',
      'Egnyte.EgnyteDesktopApp',
    ]));
    expect(targets).not.toContain('Acronis.CyberProtectHomeOffice');
    expect(targets).not.toContain('Tencent.QQ.NT');
    expect(targets).not.toContain('Webroot.SecureAnywhere');
    expect(targets).not.toContain('Speek.Speek');

    targets.length = 0;

    expect(terminalToolchainRetryTargets(QA_PSADT_TOOLCHAIN.packagerCommit)).toEqual(
      expect.arrayContaining([
        'Tricentis.NeoLoad',
        'Piriform.Recuva',
        'Trimble.SketchUp.2022',
        'MiKTeX.MiKTeX',
        'Y-ASLant.ElegantClipboard',
        'Amazon.Music',
        'Greenshot.Greenshot.Preview',
        'ABB.RobotStudio',
        'Microsoft.msodbcsql.13',
        'Microsoft.WindowsAppRuntime.1.8',
        '8x8.Work',
        'Microsoft.FSLogix',
        'Google.Chrome.Beta.EXE',
        'Microsoft.RMSClient',
        'Movavi.MovaviPhotoFocus',
        'RedHat.Podman-Desktop',
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
        'Wiris.MathType.7',
        'Microsoft.AzureMonitorAgent',
        'Logitech.LogiBolt',
        'BlueJTeam.BlueJ',
        'Autodesk.DesignReview',
        'AppiumDevelopers.AppiumInspector',
        'Microsoft.VisualStudio.BuildTools',
        'Microsoft.VisualStudio.2017.BuildTools',
        'Microsoft.VisualStudio.2019.BuildTools',
        'Microsoft.VisualStudio.2022.BuildTools',
        'Waterfox.Waterfox',
        'Playnite.Playnite',
        'Tonec.InternetDownloadManager',
        'IObit.Uninstaller',
        'Autodesk.DesktopConnector',
        'Egnyte.EgnyteDesktopApp',
      ])
    );
    expect(
      terminalToolchainRetryTargets(QA_PSADT_TOOLCHAIN.packagerCommit)
    ).not.toContain('Acronis.CyberProtectHomeOffice');
    expect(
      terminalToolchainRetryTargets(QA_PSADT_TOOLCHAIN.packagerCommit)
    ).not.toContain('Tencent.QQ.NT');
  });

  it('retries Waterfox only after activating its silent helper contract', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: ' waterfox.waterfox ', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      '44c38ddec97b546c7423374e09387d812e2386cc',
      { wingetId: 'Waterfox.Waterfox', status: 'failed' }
    )).toBe(false);
  });

  it('retries Playnite only after activating its process-close contract', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: ' playnite.playnite ', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      '937a4d51d8c62885f76cb896fa3d742069436ee2',
      { wingetId: 'Playnite.Playnite', status: 'failed' }
    )).toBe(false);
  });

  it('retries Internet Download Manager only after activating its silent uninstall contract', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: ' tonec.internetdownloadmanager ', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      'd8642e4a6e3ee867fd8dfaf5bae632fbe24200f5',
      { wingetId: 'Tonec.InternetDownloadManager', status: 'failed' }
    )).toBe(false);
  });

  it('retries IObit only after activating its Inno silent uninstall contract', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: ' iobit.uninstaller ', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      '943851a66f72cf115e2d97058a6415ee71e3f50f',
      { wingetId: 'IObit.Uninstaller', status: 'failed' }
    )).toBe(false);
  });

  it('retries Desktop Connector only after activating its ODIS registration wait', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: ' autodesk.desktopconnector ', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      '3400509334e29c78e960ba3b05ba3e4bec408b87',
      { wingetId: 'Autodesk.DesktopConnector', status: 'failed' }
    )).toBe(false);
  });

  it('retries Egnyte only after activating its update-on-boot contract', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: ' egnyte.egnytedesktopapp ', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      'b798917a85465cb2fe7b55582322d1e30b20e088',
      { wingetId: 'Egnyte.EgnyteDesktopApp', status: 'failed' }
    )).toBe(false);
  });

  it('does not retry blocked Stream Deck after removing the disproven guard', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: ' elgato.streamdeck ', status: 'failed' }
    )).toBe(false);
    expect(shouldRetryTerminalToolchainCandidate(
      '63219f1fe5c953c8fd799c79030176444ba637b4',
      { wingetId: 'Elgato.StreamDeck', status: 'failed' }
    )).toBe(true);
  });

  it('retries Windows App Runtime 1.3 only after activating exact shared Appx evidence', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: ' microsoft.windowsappruntime.1.3 ', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      'd30bedbc4374346b7900b4ffef2d7c77f222d3d2',
      { wingetId: 'Microsoft.WindowsAppRuntime.1.3', status: 'failed' }
    )).toBe(false);
  });

  it('retries ElegantClipboard only after activating its reviewed user scope', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: ' y-aslant.elegantclipboard ', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      'ffb7638dd870b188654c84673663b8ff151a7985',
      { wingetId: 'Y-ASLant.ElegantClipboard', status: 'failed' }
    )).toBe(false);
  });

  it('retries MiKTeX only after activating its unattended setup lifecycle', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: ' miktex.miktex ', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      'a2fa7cc7aec6faf0b22c0dcb7146ea8301ee9918',
      { wingetId: 'MiKTeX.MiKTeX', status: 'failed' }
    )).toBe(false);
  });

  it('does not retry blocked Webroot on the current release', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: ' webroot.secureanywhere ', status: 'failed' }
    )).toBe(false);
    expect(shouldRetryTerminalToolchainCandidate(
      '49775d3657a1b11b4ec1603e80ba8f78882b174f',
      { wingetId: 'Webroot.SecureAnywhere', status: 'failed' }
    )).toBe(false);
  });

  it('retries Chrome Beta EXE only after activating its exact vendor ARP identity', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: ' google.chrome.beta.exe ', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      '00983d36128aef319cc36f901beeff6dd03d847f',
      { wingetId: 'Google.Chrome.Beta.EXE', status: 'failed' }
    )).toBe(false);
  });

  it('retries every Build Tools generation after activating its deterministic install path', () => {
    for (const wingetId of [
      'Microsoft.VisualStudio.BuildTools',
      'Microsoft.VisualStudio.2017.BuildTools',
      'Microsoft.VisualStudio.2019.BuildTools',
      'Microsoft.VisualStudio.2022.BuildTools',
    ]) {
      expect(shouldRetryTerminalToolchainCandidate(
        QA_PSADT_TOOLCHAIN.packagerCommit,
        { wingetId, status: 'failed' }
      )).toBe(true);
    }
    expect(shouldRetryTerminalToolchainCandidate(
      '20fbdeff5e6a4dc9d911019a244f7e46ab19b708',
      { wingetId: 'Microsoft.VisualStudio.2017.BuildTools', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      'c1c9410f58318d055c09a60bc067996a4b9b4597',
      { wingetId: 'Microsoft.VisualStudio.2019.BuildTools', status: 'failed' }
    )).toBe(false);
  });

  it('retries SketchUp 2022 only after activating its reviewed silent removal argument', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: ' trimble.sketchup.2022 ', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      'b67135eb2f947485e54c2583cfb6083b1e2f24ba',
      { wingetId: 'Trimble.SketchUp.2022', status: 'failed' }
    )).toBe(false);
    expect(terminalToolchainRetryTargets(
      'b67135eb2f947485e54c2583cfb6083b1e2f24ba'
    )).toContain('Webroot.SecureAnywhere');
  });

  it('retries Recuva only after activating full-width WinGet success codes', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: ' piriform.recuva ', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      'dde6e9ae4e569568b4a15c087ba711d1bb3a8895',
      { wingetId: 'Piriform.Recuva', status: 'failed' }
    )).toBe(false);
    expect(terminalToolchainRetryTargets(
      'dde6e9ae4e569568b4a15c087ba711d1bb3a8895'
    )).toEqual(expect.arrayContaining([
      'Trimble.SketchUp.2022',
      'Webroot.SecureAnywhere',
    ]));
  });

  it('retries NeoLoad only after activating its reviewed install4j quiet argument', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: ' tricentis.neoload ', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      'dcaffc9d6fc7e9afb94fcf9a3035426a0156ee0d',
      { wingetId: 'Tricentis.NeoLoad', status: 'failed' }
    )).toBe(false);
    expect(terminalToolchainRetryTargets(
      'dcaffc9d6fc7e9afb94fcf9a3035426a0156ee0d'
    )).toEqual(expect.arrayContaining([
      'Piriform.Recuva',
      'Trimble.SketchUp.2022',
      'Webroot.SecureAnywhere',
    ]));
  });

  it('does not retry blocked QQ NT after removing its ineffective adapter', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: ' tencent.qq.nt ', status: 'failed' }
    )).toBe(false);
    expect(shouldRetryTerminalToolchainCandidate(
      '765d02a3041cc304d2df403aafc18b6f14258f59',
      { wingetId: 'Tencent.QQ.NT', status: 'failed' }
    )).toBe(true);
  });

  it('carries FSLogix from its reviewed identity release into nested-EXE disambiguation', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'microsoft.fslogix', status: 'error' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      '31faef7cae75613243bc36c9bb0af38c88761437',
      { wingetId: 'Microsoft.FSLogix', status: 'error' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      'f79b14647328d39bca04dada822a07f70573aa49',
      { wingetId: 'Microsoft.FSLogix', status: 'error' }
    )).toBe(false);
  });

  it('retries the saved custom marker profile only after activating marker recovery', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: '8X8.work', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      'bd61ef8e81dac8b16289a4a572022d4d1702b333',
      { wingetId: '8x8.Work', status: 'failed' }
    )).toBe(false);
  });

  it('does not replay Speek after activating its managed-install block', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'speek.speek', status: 'failed' }
    )).toBe(false);
    expect(shouldRetryTerminalToolchainCandidate(
      'd64f6815b43c16428d83cde1b909e6503d7cc40f',
      { wingetId: 'Speek.Speek', status: 'failed' }
    )).toBe(true);
  });

  it.each([
    'Microsoft.RMSClient',
    'Movavi.MovaviPhotoFocus',
  ])('retries %s only on the combined lifecycle release', (wingetId) => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId, status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      '4918638adf111a664f2589ce79d8aefe79c33936',
      { wingetId, status: 'failed' }
    )).toBe(false);
  });

  it('keeps DesktopOK retries confined to its retired repair releases', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'softwareok.desktopok', status: 'failed' }
    )).toBe(false);
    expect(shouldRetryTerminalToolchainCandidate(
      'f79b14647328d39bca04dada822a07f70573aa49',
      { wingetId: 'SoftwareOK.DesktopOK', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      '0a3741207b9fbab73f108b0b6f214ab9d2ffedfa',
      { wingetId: 'SoftwareOK.DesktopOK', status: 'failed' }
    )).toBe(false);
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

  it('retries ZeeDrive with its reviewed no-ARP managed lifecycle', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'thinkscape.zeedrive', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      '20546b8280874ba955b8d14182ad69bde8eacb58',
      { wingetId: 'Thinkscape.ZeeDrive', status: 'failed' }
    )).toBe(false);
  });

  it('retries Docker Desktop Edge only with the registered-identity release', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'docker.dockerdesktopedge', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      'b6254d8fdf1dd50ccc95fbb3e137a5ef5717cce5',
      { wingetId: 'Docker.DockerDesktopEdge', status: 'failed' }
    )).toBe(false);
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

  it('retries Greenshot Preview only through its exact Inno identity release', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'Greenshot.Greenshot.Preview', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      '21fbdbc5a29ca42ac0d2dd1c5939b9ad1f94adc2',
      { wingetId: 'Greenshot.Greenshot.Preview', status: 'failed' }
    )).toBe(false);
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'Greenshot.Greenshot', status: 'failed' }
    )).toBe(false);
  });

  it('retries Amazon Music only through the empty EXE argument release', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'Amazon.Music', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      'c2af5b6dfdd0a6bf44d344366abc23878c23d48b',
      { wingetId: 'Amazon.Music', status: 'failed' }
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

  it.each([
    'Wiris.MathType.7',
    'Microsoft.AzureMonitorAgent',
  ])('retries %s only after activating its reviewed uninstall repair', (wingetId) => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId, status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      'b29b7b930651b6b0d98eb5985ced7ee191550a3c',
      { wingetId, status: 'failed' }
    )).toBe(false);
  });

  it('retries Logi Bolt only after activating its exact /silent uninstaller', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'logitech.logibolt', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      'f5d7258e504f10679f54f025cebf11bfe9584221',
      { wingetId: 'Logitech.LogiBolt', status: 'failed' }
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

  it('retries BankID only after preserving the nested MSI product identity', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'financialid.bankid', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      '82de31f37d7977906153135fde2eb12cf30909c7',
      { wingetId: 'FinancialID.BankID', status: 'failed' }
    )).toBe(false);
  });

  it('retries Visual Studio 2017 only after activating its instance lifecycle', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'microsoft.visualstudio.2017.enterprise', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      '63172f3739807b25bbd54b970dc6f56d1cfc2c9d',
      { wingetId: 'Microsoft.VisualStudio.2017.Enterprise', status: 'failed' }
    )).toBe(false);
  });

  it('carries the bounded BlueJ retry into its explicit per-user MSI release', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'BlueJTeam.BlueJ', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      '0ad6cdec44cd8ec47ce12c9ae59487f2fa9dda52',
      { wingetId: 'BlueJTeam.BlueJ', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      'f91af4469ba113dac1524f8764c4a03d535eb188',
      { wingetId: 'BlueJTeam.BlueJ', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      '8ed88e9a9889fec478235b1623e313f9fd86bd59',
      { wingetId: 'BlueJTeam.BlueJ', status: 'failed' }
    )).toBe(false);
  });

  it('retries Design Review only on its bounded ODIS lifecycle release', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'autodesk.designreview', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      'd7293535636c41b795088f4d265e4e085445a05c',
      { wingetId: 'Autodesk.DesignReview', status: 'failed' }
    )).toBe(false);
  });

  it('retries Appium Inspector only on its user-scope lifecycle release', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'appiumdevelopers.appiuminspector', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      '06b92432e61d66eab624085dfd6db138d3778862',
      { wingetId: 'AppiumDevelopers.AppiumInspector', status: 'failed' }
    )).toBe(false);
  });

  it('keeps historical darktable retries scoped away from the blocked current release', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'darktable.darktable', status: 'failed' }
    )).toBe(false);
    expect(shouldRetryTerminalToolchainCandidate(
      '7391c73a8eacb01becfc76682bfbb37b1d60b17f',
      { wingetId: 'darktable.darktable', status: 'failed' }
    )).toBe(true);
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
