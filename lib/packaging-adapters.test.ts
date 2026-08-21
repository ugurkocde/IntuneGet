import { describe, expect, it } from 'vitest';
import { DEFAULT_PSADT_CONFIG } from '@/types/psadt';
import {
  applyApplicationPackagingAdapter,
  resolveApplicationInstallScope,
  resolveApplicationInstallerSuccessCodes,
  resolveApplicationInstallerSelectionScope,
  resolveApplicationUninstallCommand,
} from './packaging-adapters';

describe('application packaging adapters', () => {
  it('adds Movavi Photo Focus vendor success code without weakening other apps', () => {
    expect(resolveApplicationInstallerSuccessCodes(
      'Movavi.MovaviPhotoFocus',
      undefined
    )).toEqual([1223]);
    expect(resolveApplicationInstallerSuccessCodes(
      ' movavi.movaviphotofocus ',
      [3010, 1223]
    )).toEqual([1223, 3010]);
    expect(resolveApplicationInstallerSuccessCodes(
      'Example.App',
      [3010]
    )).toEqual([3010]);
  });

  it('uses the reviewed Chrome EXE registry identity without widening matching', () => {
    expect(resolveApplicationUninstallCommand(
      'Google.Chrome.EXE',
      'REGISTRY_UNINSTALL:Google Chrome (EXE)'
    )).toBe('REGISTRY_UNINSTALL:Google Chrome');
    expect(resolveApplicationUninstallCommand(
      'Google.Chrome',
      'REGISTRY_UNINSTALL:Google Chrome'
    )).toBe('REGISTRY_UNINSTALL:Google Chrome');
    expect(resolveApplicationUninstallCommand(
      'Google.Chrome.EXE',
      'vendor-uninstall.exe --custom'
    )).toBe('vendor-uninstall.exe --custom');
  });

  it('uses Docker Desktop Edge\'s actual registered product identity', () => {
    expect(resolveApplicationUninstallCommand(
      'Docker.DockerDesktopEdge',
      'REGISTRY_UNINSTALL:Docker Desktop Edge'
    )).toBe('REGISTRY_UNINSTALL:Docker Desktop');
    expect(resolveApplicationUninstallCommand(
      'docker.dockerdesktopedge',
      'vendor-uninstall.exe --custom'
    )).toBe('vendor-uninstall.exe --custom');
  });

  it('uses FSLogix\'s registered bundle display identity', () => {
    expect(resolveApplicationUninstallCommand(
      'Microsoft.FSLogix',
      'REGISTRY_UNINSTALL:FSLogix'
    )).toBe('REGISTRY_UNINSTALL:Microsoft FSLogix Apps');
    expect(resolveApplicationUninstallCommand(
      'microsoft.fslogix',
      'vendor-uninstall.exe --custom'
    )).toBe('vendor-uninstall.exe --custom');
  });

  it('uses the exact stable Inno registry key for every K-Lite edition', () => {
    for (const edition of ['Basic', 'Standard', 'Full', 'Mega']) {
      expect(resolveApplicationUninstallCommand(
        `CodecGuide.K-LiteCodecPack.${edition}`,
        `REGISTRY_UNINSTALL:K-Lite Codec Pack ${edition}`
      )).toBe(
        `REGISTRY_UNINSTALL_KEY:KLiteCodecPack_is1:K-Lite Codec Pack ${edition}`
      );
    }
    expect(resolveApplicationUninstallCommand(
      'CodecGuide.K-LiteCodecPack.Standard',
      'vendor-uninstall.exe --custom'
    )).toBe('vendor-uninstall.exe --custom');
  });

  it('uses Maestro 2025\'s reviewed embedded-MSI product key', () => {
    expect(resolveApplicationUninstallCommand(
      'MaestroSoft.MaestroAarsoppgjoer.2025',
      'REGISTRY_UNINSTALL:Maestro Årsoppgjør 2025'
    )).toBe(
      'REGISTRY_UNINSTALL_PRODUCT:{20C36C0E-AF6D-4C46-AA1C-39080889BE9F}:Maestro Årsoppgjør 2025'
    );
    expect(resolveApplicationUninstallCommand(
      'MaestroSoft.MaestroAarsoppgjoer.2025',
      'vendor-uninstall.exe --custom'
    )).toBe('vendor-uninstall.exe --custom');
  });

  it('uses PTC Creo View Express published MSI identity across prerequisite installs', () => {
    expect(resolveApplicationUninstallCommand(
      'PTC.CreoView.Express',
      'REGISTRY_UNINSTALL:PTC Creo View Express'
    )).toBe(
      'REGISTRY_UNINSTALL_PRODUCT:{6DE7DB1D-27F7-46A8-AE3A-D8C2BB62870B}:PTC Creo View Express'
    );
  });

  it('uses Timely Memory\'s published stable NSIS registry key', () => {
    expect(resolveApplicationUninstallCommand(
      'Timely.Memory',
      'REGISTRY_UNINSTALL:Memory'
    )).toBe('REGISTRY_UNINSTALL_KEY:Memory:Memory');
    expect(resolveApplicationUninstallCommand(
      'timely.memory',
      'vendor-uninstall.exe --custom'
    )).toBe('vendor-uninstall.exe --custom');
  });

  it('uses MSYS2\'s registered product family instead of its catalog title', () => {
    expect(resolveApplicationUninstallCommand(
      'MSYS2.MSYS2',
      'REGISTRY_UNINSTALL:MSYS2 Installer'
    )).toBe('REGISTRY_UNINSTALL:MSYS2');
    expect(resolveApplicationUninstallCommand(
      'msys2.msys2',
      'vendor-uninstall.exe --custom'
    )).toBe('vendor-uninstall.exe --custom');
  });

  it('forces reviewed per-user installers out of the LocalSystem profile', () => {
    expect(resolveApplicationInstallScope('AvaCC.AvaDesktop', 'machine')).toBe(
      'user'
    );
    expect(resolveApplicationInstallScope(' avacc.avadesktop ', undefined)).toBe(
      'user'
    );
    expect(resolveApplicationInstallScope('VNGCorp.Zalo', 'machine')).toBe('user');
    expect(resolveApplicationInstallScope(' vngcorp.zalo ', undefined)).toBe('user');
    expect(resolveApplicationInstallScope('Youdao.YoudaoTranslate', 'machine')).toBe('user');
    expect(resolveApplicationInstallScope(' youdao.youdaotranslate ', undefined)).toBe('user');
    expect(resolveApplicationInstallScope('Makeblock.xToolStudio', 'machine')).toBe('user');
    expect(resolveApplicationInstallScope(' makeblock.xtoolstudio ', undefined)).toBe('user');
    expect(resolveApplicationInstallScope(
      'UltimateGadgetLaboratories.UHKAgent',
      'machine'
    )).toBe('user');
    expect(resolveApplicationInstallScope(
      ' ultimategadgetlaboratories.uhkagent ',
      undefined
    )).toBe('user');
    expect(resolveApplicationInstallScope('Rakuten.Viber', 'machine')).toBe('user');
    expect(resolveApplicationInstallScope(' rakuten.viber ', undefined)).toBe('user');
    expect(resolveApplicationInstallScope('TorProject.TorBrowser', 'machine')).toBe('user');
    expect(resolveApplicationInstallScope(' torproject.torbrowser ', undefined)).toBe('user');
    expect(resolveApplicationInstallScope('Example.App', 'user')).toBe('user');
    expect(resolveApplicationInstallScope('Example.App', 'machine')).toBe('machine');
  });

  it('runs Logitech Presentation elevated without weakening catalog scope matching', () => {
    expect(resolveApplicationInstallScope('Logitech.Presentation', 'user')).toBe('machine');
    expect(resolveApplicationInstallerSelectionScope(
      'Logitech.Presentation',
      'machine'
    )).toBe('user');
    expect(resolveApplicationInstallerSelectionScope('Example.App', 'machine')).toBe('machine');
    expect(
      applyApplicationPackagingAdapter('Logitech.Presentation', DEFAULT_PSADT_CONFIG)
    ).toMatchObject({
      reviewedInstallArgumentsOverride: '/S /U:0 /A:0',
    });
  });

  it('runs NVM for Windows elevated from a deterministic machine directory', () => {
    expect(resolveApplicationInstallScope('CoreyButler.NVMforWindows', 'user')).toBe(
      'machine'
    );
    expect(resolveApplicationInstallerSelectionScope(
      'CoreyButler.NVMforWindows',
      'machine'
    )).toBe('user');
    expect(
      applyApplicationPackagingAdapter('CoreyButler.NVMforWindows', DEFAULT_PSADT_CONFIG)
    ).toMatchObject({
      reviewedInstallArgumentsOverride:
        '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- /DIR="%ProgramFiles%\\nvm"',
    });
  });

  it('models Tor Browser as the vendor-documented extracted user folder', () => {
    expect(
      applyApplicationPackagingAdapter('TorProject.TorBrowser', DEFAULT_PSADT_CONFIG)
    ).toMatchObject({
      reviewedManagedInstallDirectory: '%USERPROFILE%\\Desktop\\Tor Browser',
    });
  });

  it('models Speek as the reviewed non-ARP Program Files payload', () => {
    expect(
      applyApplicationPackagingAdapter('Speek.Speek', DEFAULT_PSADT_CONFIG)
    ).toMatchObject({
      reviewedManagedInstallDirectory: '%ProgramFiles(x86)%\\Speek',
      reviewedManagedInstallEvidenceFile:
        '%ProgramFiles(x86)%\\Speek\\Speek.exe',
      reviewedManagedInstallCompletionTimeoutMinutes: 2,
    });
  });

  it('keeps the darktable NSIS extraction observable within a bounded wait', () => {
    expect(
      applyApplicationPackagingAdapter('darktable.darktable', DEFAULT_PSADT_CONFIG)
    ).toMatchObject({
      reviewedInstallCompletionTimeoutMinutes: 15,
    });
  });

  it('does not extend the blocked Acronis managed-uninstall lifecycle', () => {
    expect(
      applyApplicationPackagingAdapter(
        'Acronis.CyberProtectHomeOffice',
        DEFAULT_PSADT_CONFIG
      ).uninstallCompletionTimeoutMinutes
    ).toBeUndefined();
  });

  it('adds reviewed silent removal arguments for failing vendor lifecycles', () => {
    expect(
      applyApplicationPackagingAdapter('RARLab.WinRAR', DEFAULT_PSADT_CONFIG)
        .reviewedUninstallArguments
    ).toEqual(['/S']);
    expect(
      applyApplicationPackagingAdapter('Cockos.REAPER', DEFAULT_PSADT_CONFIG)
        .reviewedUninstallArguments
    ).toEqual(['/S']);
    expect(
      applyApplicationPackagingAdapter('AnyDesk.AnyDesk', DEFAULT_PSADT_CONFIG)
    ).toMatchObject({
      processesToClose: [{ name: 'AnyDesk', description: 'AnyDesk' }],
      reviewedExactUninstall: {
        executablePath: '%ProgramFiles(x86)%\\AnyDesk\\AnyDesk.exe',
        arguments: ['--silent', '--remove'],
        completionTimeoutMinutes: 5,
      },
    });
    expect(
      applyApplicationPackagingAdapter(
        'SoftwareOK.DesktopOK',
        DEFAULT_PSADT_CONFIG
      ).reviewedExactUninstall
    ).toEqual({
      executablePath: '%ProgramFiles%\\DesktopOK\\DesktopOK_x64.exe',
      arguments: ['/silent', '-?uninstall'],
      completionTimeoutMinutes: 5,
    });
    expect(resolveApplicationInstallScope('SoftwareOK.DesktopOK', 'user')).toBe(
      'machine'
    );
    expect(
      applyApplicationPackagingAdapter('SoftwareOK.Q-Dir', DEFAULT_PSADT_CONFIG)
        .reviewedUninstallArguments
    ).toEqual(['/silent', 'forall']);
    expect(
      applyApplicationPackagingAdapter('Google.GoogleDrive', DEFAULT_PSADT_CONFIG)
        .reviewedUninstallArguments
    ).toEqual(['--silent', '--force_stop']);
    expect(
      applyApplicationPackagingAdapter('Apryse.XodoPDFReader', DEFAULT_PSADT_CONFIG)
        .reviewedUninstallArguments
    ).toEqual(['-q']);
    expect(
      applyApplicationPackagingAdapter('karakun.OpenWebStart', DEFAULT_PSADT_CONFIG)
        .reviewedUninstallArguments
    ).toEqual(['-q', '-Dinstall4j.suppressUnattendedReboot=true']);
    expect(
      applyApplicationPackagingAdapter('MSYS2.MSYS2', DEFAULT_PSADT_CONFIG)
        .reviewedUninstallArguments
    ).toEqual(['pr', '--confirm-command']);
    expect(
      applyApplicationPackagingAdapter('Ecosia.EcosiaBrowser', DEFAULT_PSADT_CONFIG)
        .reviewedUninstallArguments
    ).toEqual(['--force-uninstall']);
    expect(
      applyApplicationPackagingAdapter('Dropbox.Dropbox', DEFAULT_PSADT_CONFIG)
    ).toMatchObject({
      reviewedInstallArgumentsOverride: '/NOLAUNCH',
      reviewedUninstallArguments: ['/S'],
      processesToClose: [{ name: 'Dropbox', description: 'Dropbox' }],
    });
    expect(
      applyApplicationPackagingAdapter(
        'AOMEI.PartitionAssistant',
        DEFAULT_PSADT_CONFIG
      )
    ).toMatchObject({
      reviewedExactUninstall: {
        executablePath:
          '%ProgramFiles(x86)%\\AOMEI Partition Assistant\\unins000.exe',
        arguments: ['/SILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-'],
        completionTimeoutMinutes: 5,
      },
      processesToClose: [
        { name: 'PartAssist', description: 'AOMEI Partition Assistant' },
      ],
    });
    expect(
      applyApplicationPackagingAdapter('Wiris.MathType.7', DEFAULT_PSADT_CONFIG)
        .reviewedExactUninstall
    ).toEqual({
      executablePath: '%ProgramFiles(x86)%\\MathType\\Setup.exe',
      arguments: ['-Q', '-R'],
      completionTimeoutMinutes: 5,
    });
    expect(
      applyApplicationPackagingAdapter(
        'Microsoft.AzureMonitorAgent',
        DEFAULT_PSADT_CONFIG
      ).reviewedUninstallServiceNames
    ).toEqual(['AzureMonitorAgent']);
    expect(
      applyApplicationPackagingAdapter('Dell.Optimizer', DEFAULT_PSADT_CONFIG)
    ).toMatchObject({
      reviewedExactUninstall: {
        executablePath: '%PackageInstaller%',
        arguments: ['/passthrough', '/silent', '/remove'],
        completionTimeoutMinutes: 10,
      },
    });
    expect(
      applyApplicationPackagingAdapter(
        'Dell.DisplayAndPeripheralManager',
        DEFAULT_PSADT_CONFIG
      )
    ).toMatchObject({
      processesToClose: expect.arrayContaining([
        { name: 'DPM', description: 'Dell Display and Peripheral Manager' },
        { name: 'DPMService', description: 'Dell Display and Peripheral Manager' },
        { name: 'Dell.CoreServices.Client', description: 'Dell Core Services' },
      ]),
      reviewedExactUninstall: {
        executablePath:
          '%ProgramFiles%\\Dell\\Dell Display and Peripheral Manager\\Installer\\setup.exe',
        arguments: ['/uninst', '/Silent'],
        completionTimeoutMinutes: 20,
      },
    });
    for (const wingetId of [
      'PostgreSQL.PostgreSQL.9.6',
      'PostgreSQL.PostgreSQL.13',
      'PostgreSQL.PostgreSQL.18',
      'postgresql.postgresql.19',
    ]) {
      expect(
        applyApplicationPackagingAdapter(wingetId, DEFAULT_PSADT_CONFIG)
          .reviewedUninstallArguments
      ).toEqual(['--mode', 'unattended', '--unattendedmodeui', 'none']);
    }
    expect(
      applyApplicationPackagingAdapter('PostgreSQL.pgAdmin', DEFAULT_PSADT_CONFIG)
        .reviewedUninstallArguments
    ).toEqual([]);
    expect(
      applyApplicationPackagingAdapter('Evernote.Evernote', DEFAULT_PSADT_CONFIG)
        .processesToClose
    ).toEqual([{ name: 'Evernote', description: 'Evernote' }]);
    expect(
      applyApplicationPackagingAdapter('Bria.Bria', DEFAULT_PSADT_CONFIG)
        .processesToClose
    ).toEqual([{ name: 'Bria', description: 'Bria' }]);
    expect(
      applyApplicationPackagingAdapter('Insta360.Link.Controller', DEFAULT_PSADT_CONFIG)
        .processesToClose
    ).toEqual([
      { name: 'Insta360 Link Controller', description: 'Insta360 Link Controller' },
      { name: 'VirtualCameraService', description: 'Insta360 Virtual Camera' },
      { name: 'Insta360LinkDriver', description: 'Insta360 Link driver' },
    ]);
    expect(
      applyApplicationPackagingAdapter('Logitech.SetPoint', DEFAULT_PSADT_CONFIG)
        .processesToClose
    ).toEqual([
      { name: 'SetPoint', description: 'Logitech SetPoint' },
      { name: 'SetPointII', description: 'Logitech SetPoint' },
      { name: 'KHALMNPR', description: 'Logitech SetPoint device service' },
    ]);
    expect(
      applyApplicationPackagingAdapter('Opera.Opera', DEFAULT_PSADT_CONFIG)
    ).toMatchObject({
      processesToClose: [{ name: 'opera', description: 'Opera browser' }],
      reviewedExactUninstall: {
        executablePath: '%ProgramFiles%\\Opera\\opera.exe',
        arguments: ['--uninstall', '--runimmediately', '--deleteuserprofile=0'],
        completionTimeoutMinutes: 5,
      },
    });
    expect(
      applyApplicationPackagingAdapter(
        'Microsoft.OfficeDeploymentTool',
        DEFAULT_PSADT_CONFIG
      ).reviewedManagedInstallDirectory
    ).toBe('%ProgramW6432%\\OfficeDeploymentTool');
    expect(
      applyApplicationPackagingAdapter('HP.ImageAssistant', DEFAULT_PSADT_CONFIG)
        .reviewedManagedInstallDirectory
    ).toBe('%SystemDrive%\\SWSetup\\HPImageAssistant');
    expect(
      applyApplicationPackagingAdapter(
        'Autodesk.LicensingService',
        DEFAULT_PSADT_CONFIG
      )
    ).toMatchObject({
      reviewedManagedInstallDirectory:
        '%ProgramFiles(x86)%\\Common Files\\Autodesk Shared\\AdskLicensing',
      reviewedManagedInstallEvidenceFile:
        '%ProgramFiles(x86)%\\Common Files\\Autodesk Shared\\AdskLicensing\\uninstall.exe',
      reviewedManagedInstallCompletionTimeoutMinutes: 5,
      reviewedManagedUninstall: {
        executablePath:
          '%ProgramFiles(x86)%\\Common Files\\Autodesk Shared\\AdskLicensing\\uninstall.exe',
        arguments: ['--mode', 'unattended'],
        completionTimeoutMinutes: 5,
      },
    });
    expect(
      applyApplicationPackagingAdapter(
        'Autodesk.NavisworksFreedom.2026',
        DEFAULT_PSADT_CONFIG
      )
    ).toMatchObject({
      reviewedManagedInstallDirectory:
        '%ProgramW6432%\\Autodesk\\Navisworks Freedom 2026',
      reviewedManagedInstallEvidenceFile:
        '%ProgramW6432%\\Autodesk\\Navisworks Freedom 2026\\Roamer.exe',
      reviewedManagedInstallCompletionProcess:
        '%ProgramW6432%\\Autodesk\\AdODIS\\V1\\Installer.exe',
      reviewedManagedInstallCompletionTimeoutMinutes: 15,
      reviewedManagedUninstall: {
        executablePath: '%ProgramW6432%\\Autodesk\\AdODIS\\V1\\Installer.exe',
        arguments: [
          '-i',
          'uninstall',
          '--silent',
          '--trigger_point',
          'system',
          '-m',
          '%ProgramData%\\Autodesk\\ODIS\\metadata\\{BE06C262-73A9-3C2F-8982-C105E1EE9A34}\\bundleManifest.xml',
          '-x',
          '%ProgramData%\\Autodesk\\ODIS\\metadata\\{BE06C262-73A9-3C2F-8982-C105E1EE9A34}\\SetupRes\\manifest.xsd',
        ],
        completionTimeoutMinutes: 15,
      },
    });
    expect(
      applyApplicationPackagingAdapter(
        'autodesk.navisworksfreedom.2027',
        DEFAULT_PSADT_CONFIG
      )
    ).toMatchObject({
      reviewedManagedInstallDirectory:
        '%ProgramW6432%\\Autodesk\\Navisworks Freedom 2027',
      reviewedManagedInstallEvidenceFile:
        '%ProgramW6432%\\Autodesk\\Navisworks Freedom 2027\\Roamer.exe',
      reviewedManagedInstallCompletionProcess:
        '%ProgramW6432%\\Autodesk\\AdODIS\\V1\\Installer.exe',
      reviewedManagedInstallCompletionTimeoutMinutes: 15,
      reviewedManagedUninstall: {
        arguments: expect.arrayContaining([
          '%ProgramData%\\Autodesk\\ODIS\\metadata\\{52AC45A2-3099-370C-8394-8B347967768B}\\bundleManifest.xml',
        ]),
        completionTimeoutMinutes: 15,
      },
    });
    expect(
      applyApplicationPackagingAdapter('Google.GoogleUpdater', DEFAULT_PSADT_CONFIG)
    ).toMatchObject({
      reviewedManagedInstallDirectory:
        '%ProgramFiles(x86)%\\Google\\GoogleUpdater',
      reviewedManagedUninstall: {
        executablePath:
          '%ProgramFiles(x86)%\\Google\\GoogleUpdater\\<VERSION>\\updater.exe',
        arguments: ['--uninstall', '--system'],
        completionTimeoutMinutes: 5,
      },
    });
    expect(
      applyApplicationPackagingAdapter(
        'Microsoft.VisualStudio.BuildTools',
        DEFAULT_PSADT_CONFIG
      )
    ).toMatchObject({
      reviewedManagedInstallDirectory:
        '%ProgramFiles%\\Microsoft Visual Studio\\18\\BuildTools',
      reviewedManagedUninstall: {
        executablePath:
          '%ProgramFiles(x86)%\\Microsoft Visual Studio\\Installer\\setup.exe',
        arguments: [
          'uninstall',
          '--installPath',
          '%ProgramFiles%\\Microsoft Visual Studio\\18\\BuildTools',
          '--quiet',
          '--norestart',
        ],
        completionTimeoutMinutes: 15,
      },
    });
    expect(
      applyApplicationPackagingAdapter(
        'ElectronicArts.EADesktop',
        DEFAULT_PSADT_CONFIG
      ).processesToClose
    ).toEqual([
      { name: 'EADesktop', description: 'EA app' },
      { name: 'EALauncher', description: 'EA app launcher' },
      { name: 'EACefSubProcess', description: 'EA app web process' },
      { name: 'EALocalHostSvc', description: 'EA local host service' },
      { name: 'EABackgroundService', description: 'EA background service' },
    ]);
    expect(
      applyApplicationPackagingAdapter('Elgato.CameraHub', DEFAULT_PSADT_CONFIG)
    ).toMatchObject({
      processesToClose: [
        { name: 'Camera Hub', description: 'Elgato Camera Hub' },
      ],
      reviewedUninstallProcessGuard: {
        processName: 'Camera Hub.exe',
        argumentsPattern: '(?:^|\\s)--pre-uninstall(?:\\s|$).*--quit(?:\\s|$)',
        graceSeconds: 20,
      },
    });
    expect(
      applyApplicationPackagingAdapter('Microsoft.VSTOR', DEFAULT_PSADT_CONFIG)
        .reviewedUninstallArguments
    ).toEqual(['/uninstall', '/quiet', '/norestart']);
    expect(
      applyApplicationPackagingAdapter(
        'Microsoft.RMSClient',
        DEFAULT_PSADT_CONFIG
      ).uninstallCompletionTimeoutMinutes
    ).toBe(10);
    expect(
      applyApplicationPackagingAdapter(
        'Microsoft.VisualStudio.2022.BuildTools',
        DEFAULT_PSADT_CONFIG
      )
    ).toMatchObject({
      reviewedManagedInstallDirectory:
        '%ProgramFiles(x86)%\\Microsoft Visual Studio\\2022\\BuildTools',
      reviewedManagedUninstall: {
        executablePath:
          '%ProgramFiles(x86)%\\Microsoft Visual Studio\\Installer\\setup.exe',
        arguments: [
          'uninstall',
          '--installPath',
          '%ProgramFiles(x86)%\\Microsoft Visual Studio\\2022\\BuildTools',
          '--quiet',
          '--norestart',
        ],
        completionTimeoutMinutes: 15,
      },
    });
    expect(
      applyApplicationPackagingAdapter(
        'Microsoft.VisualStudio.2022.Professional',
        DEFAULT_PSADT_CONFIG
      )
    ).toMatchObject({
      reviewedManagedInstallDirectory:
        '%ProgramFiles%\\Microsoft Visual Studio\\2022\\Professional',
      reviewedManagedUninstall: {
        executablePath:
          '%ProgramFiles(x86)%\\Microsoft Visual Studio\\Installer\\setup.exe',
        arguments: [
          'uninstall',
          '--installPath',
          '%ProgramFiles%\\Microsoft Visual Studio\\2022\\Professional',
          '--quiet',
          '--norestart',
        ],
        completionTimeoutMinutes: 15,
      },
    });
    expect(
      applyApplicationPackagingAdapter(
        'Microsoft.VisualStudio.2017.Enterprise',
        DEFAULT_PSADT_CONFIG
      )
    ).toMatchObject({
      reviewedManagedInstallDirectory:
        '%ProgramFiles(x86)%\\Microsoft Visual Studio\\2017\\Enterprise',
      reviewedManagedUninstall: {
        executablePath:
          '%ProgramFiles(x86)%\\Microsoft Visual Studio\\Installer\\setup.exe',
        arguments: [
          'uninstall',
          '--installPath',
          '%ProgramFiles(x86)%\\Microsoft Visual Studio\\2017\\Enterprise',
          '--quiet',
          '--norestart',
        ],
        completionTimeoutMinutes: 15,
      },
    });
    expect(
      applyApplicationPackagingAdapter(
        'Microsoft.VisualStudio.2019.BuildTools',
        DEFAULT_PSADT_CONFIG
      )
    ).toMatchObject({
      reviewedManagedInstallDirectory:
        '%ProgramFiles(x86)%\\Microsoft Visual Studio\\2019\\BuildTools',
      reviewedManagedUninstall: {
        arguments: [
          'uninstall',
          '--installPath',
          '%ProgramFiles(x86)%\\Microsoft Visual Studio\\2019\\BuildTools',
          '--quiet',
          '--norestart',
        ],
        completionTimeoutMinutes: 15,
      },
    });
    expect(
      applyApplicationPackagingAdapter(
        'Microsoft.SQLServerManagementStudio.22',
        DEFAULT_PSADT_CONFIG
      )
    ).toMatchObject({
      reviewedUninstallArguments: ['--quiet', '--norestart', '--noweb'],
      uninstallCompletionTimeoutMinutes: 15,
    });
  });

  it('uses ZeeDrive\'s documented no-ARP Intune lifecycle', () => {
    expect(
      applyApplicationPackagingAdapter(
        'Thinkscape.ZeeDrive',
        DEFAULT_PSADT_CONFIG
      )
    ).toMatchObject({
      reviewedInstallArguments: ['COMMAND=Install'],
      reviewedManagedInstallDirectory:
        '%ProgramFiles%\\Thinkscape Zee Drive\\<VERSION>',
      reviewedManagedInstallEvidenceFile:
        '%ProgramFiles%\\Thinkscape Zee Drive\\<VERSION>\\ZeeDrive.exe',
      reviewedManagedInstallCompletionTimeoutMinutes: 5,
    });
  });

  it('adds the vendor-supported LTspice enterprise install mode', () => {
    const adapted = applyApplicationPackagingAdapter(
      'AnalogDevices.LTspice',
      DEFAULT_PSADT_CONFIG
    );

    expect(adapted.reviewedInstallArguments).toEqual(['MY_SPECIAL_MODE=2']);
    expect(adapted.reviewedUninstallArguments).toEqual([]);
  });

  it('uses PDFsam\'s documented managed MSI command', () => {
    const adapted = applyApplicationPackagingAdapter(
      'PDFsam.PDFsam',
      DEFAULT_PSADT_CONFIG
    );

    expect(adapted.reviewedInstallArgumentsOverride).toBe(
      '/qb /norestart CHECK_FOR_UPDATES=false DONATE_NOTIFICATION=false SKIPTHANKSPAGE=Yes'
    );
    expect(adapted.reviewedUninstallArguments).toEqual([]);
  });

  it('uses PTC Creo View Express documented MSI-forwarding syntax', () => {
    const adapted = applyApplicationPackagingAdapter(
      'PTC.CreoView.Express',
      DEFAULT_PSADT_CONFIG
    );

    expect(adapted.reviewedInstallArgumentsOverride).toBe(
      '/vADDLOCAL="ALL" /qn /norestart'
    );
    expect(adapted.reviewedUninstallArguments).toEqual([]);
  });

  it('uses the reviewed InstallShield administrative-image lifecycle for Sonos', () => {
    const adapted = applyApplicationPackagingAdapter(
      'Sonos.Controller',
      { ...DEFAULT_PSADT_CONFIG, installCommand: 'customer override' }
    );

    expect(adapted.reviewedInstallArgumentsOverride).toBeUndefined();
    expect(adapted.reviewedInstallShieldAdministrativeImage).toEqual({
      expectedMsiFileName: 'Sonos.msi',
    });
    expect(adapted.installCommand).toBeUndefined();
    expect(adapted.reviewedUninstallArguments).toEqual([]);
  });

  it('selects MEGAsync all-users mode for LocalSystem deployment', () => {
    const adapted = applyApplicationPackagingAdapter(
      'Mega.MEGASync',
      DEFAULT_PSADT_CONFIG
    );

    expect(adapted.reviewedInstallArgumentsOverride).toBe('/S /MULTIUSER');
    expect(adapted.reviewedUninstallArguments).toEqual([]);
  });

  it('selects Podman Desktop all-users mode for the full Intune lifecycle', () => {
    const adapted = applyApplicationPackagingAdapter(
      'redhat.podman-desktop',
      DEFAULT_PSADT_CONFIG
    );

    expect(adapted.reviewedInstallArgumentsOverride).toBe('/S /allusers');
    expect(adapted.reviewedUninstallArguments).toEqual(['/allusers', '/S']);
  });

  it('replaces Bitvise generic switches with its documented unattended mode', () => {
    const adapted = applyApplicationPackagingAdapter(
      'Bitvise.SSH.Client',
      DEFAULT_PSADT_CONFIG
    );

    expect(adapted.reviewedInstallArgumentsOverride).toBe('-unat -acceptEula');
    expect(adapted.reviewedUninstallArguments).toEqual(['-unat']);
  });

  it('retains the shared WebView2 runtime while removing IntuneGet ownership', () => {
    expect(
      applyApplicationPackagingAdapter(
        'Microsoft.EdgeWebView2Runtime',
        DEFAULT_PSADT_CONFIG
      ).preserveVendorInstallationOnUninstall
    ).toBe(true);
  });

  it('uses reviewed multi-product evidence for the shared Visual C++ runtime bundle', () => {
    expect(
      applyApplicationPackagingAdapter('ABBODI1406.VCREDIST', DEFAULT_PSADT_CONFIG)
    ).toMatchObject({
      preserveVendorInstallationOnUninstall: true,
      reviewedMultiProductInstallDisplayNamePrefixes: [
        'Microsoft Visual C++',
        'Visual C++',
      ],
      reviewedMultiProductInstallMinimumCount: 10,
    });
  });

  it('uses Microsoft registry evidence for the shared .NET Framework runtime', () => {
    expect(
      applyApplicationPackagingAdapter(
        'Microsoft.DotNet.Framework.Runtime',
        DEFAULT_PSADT_CONFIG
      )
    ).toMatchObject({
      preserveVendorInstallationOnUninstall: true,
      reviewedRegistryInstallEvidence: {
        keyPath: 'HKLM:\\SOFTWARE\\Microsoft\\NET Framework Setup\\NDP\\v4\\Full',
        valueName: 'Release',
        minimumDword: 533320,
      },
    });
  });

  it('does not accept shared-runtime retention from customer-controlled config', () => {
    const adapted = applyApplicationPackagingAdapter('Example.App', {
      ...DEFAULT_PSADT_CONFIG,
      preserveVendorInstallationOnUninstall: true,
      reviewedMultiProductInstallDisplayNamePrefixes: ['Anything'],
      reviewedMultiProductInstallMinimumCount: 2,
      reviewedRegistryInstallEvidence: {
        keyPath: 'HKLM:\\SOFTWARE\\Example',
        valueName: 'Release',
        minimumDword: 1,
      },
      reviewedInstallShieldAdministrativeImage: {
        expectedMsiFileName: 'customer-controlled.msi',
      },
      reviewedInstallCompletionTimeoutMinutes: 30,
      reviewedManagedInstallDirectory: '%ProgramFiles%\\Example',
      reviewedManagedInstallEvidenceFile: '%ProgramFiles%\\Example\\app.exe',
      reviewedManagedInstallCompletionProcess:
        '%ProgramFiles%\\Example\\installer.exe',
      reviewedManagedInstallCompletionTimeoutMinutes: 5,
      reviewedManagedUninstall: {
        executablePath: '%ProgramFiles%\\Example\\uninstall.exe',
        arguments: ['/quiet'],
        completionTimeoutMinutes: 5,
      },
      reviewedExactUninstall: {
        executablePath: '%ProgramFiles%\\Example\\exact-uninstall.exe',
        arguments: ['/quiet'],
        completionTimeoutMinutes: 5,
      },
    });

    expect(adapted.preserveVendorInstallationOnUninstall).toBeUndefined();
    expect(adapted.reviewedMultiProductInstallDisplayNamePrefixes).toBeUndefined();
    expect(adapted.reviewedMultiProductInstallMinimumCount).toBeUndefined();
    expect(adapted.reviewedRegistryInstallEvidence).toBeUndefined();
    expect(adapted.reviewedInstallShieldAdministrativeImage).toBeUndefined();
    expect(adapted.reviewedInstallCompletionTimeoutMinutes).toBeUndefined();
    expect(adapted.reviewedManagedInstallDirectory).toBeUndefined();
    expect(adapted.reviewedManagedInstallEvidenceFile).toBeUndefined();
    expect(adapted.reviewedManagedInstallCompletionProcess).toBeUndefined();
    expect(adapted.reviewedManagedInstallCompletionTimeoutMinutes).toBeUndefined();
    expect(adapted.reviewedManagedUninstall).toBeUndefined();
    expect(adapted.reviewedExactUninstall).toBeUndefined();
  });

  it('preserves and deduplicates reviewed install arguments case-insensitively', () => {
    const adapted = applyApplicationPackagingAdapter('AnalogDevices.LTspice', {
      ...DEFAULT_PSADT_CONFIG,
      reviewedInstallArguments: ['my_special_mode=2', 'EXAMPLE=1'],
    });

    expect(adapted.reviewedInstallArguments).toEqual([
      'my_special_mode=2',
      'EXAMPLE=1',
    ]);
  });

  it.each([
    'Microsoft.SQLServerManagementStudio.21',
    'Microsoft.SQLServerManagementStudio.22',
    'Microsoft.SQLServerManagementStudio.22.Preview',
  ])('applies the Visual Studio Installer lifecycle to %s', (wingetId) => {
    expect(
      applyApplicationPackagingAdapter(wingetId.toLowerCase(), DEFAULT_PSADT_CONFIG)
    ).toMatchObject({
      reviewedUninstallArguments: ['--quiet', '--norestart', '--noweb'],
      uninstallCompletionTimeoutMinutes: 15,
    });
  });

  it('preserves and deduplicates reviewed uninstall arguments case-insensitively', () => {
    const adapted = applyApplicationPackagingAdapter('RARLab.WinRAR', {
      ...DEFAULT_PSADT_CONFIG,
      reviewedUninstallArguments: ['/s', '--custom'],
    });

    expect(adapted.reviewedUninstallArguments).toEqual(['/s', '--custom']);
  });

  it('binds the reviewed Logitech G HUB install and removal lifecycle', () => {
    const adapted = applyApplicationPackagingAdapter(
      'logitech.ghub',
      DEFAULT_PSADT_CONFIG
    );

    expect(adapted.processesToClose).toEqual([
      { name: 'lghub', description: 'Logitech G HUB' },
      { name: 'lghub_agent', description: 'Logitech G HUB Agent' },
      { name: 'lghub_updater', description: 'Logitech G HUB Updater' },
      {
        name: 'lghub_software_manager',
        description: 'Logitech G HUB Software Manager',
      },
    ]);
    expect(adapted.reviewedInstallCompletionTimeoutMinutes).toBe(15);
    expect(adapted.reviewedExactUninstall).toEqual({
      executablePath: '%ProgramFiles%\\LGHUB\\lghub_updater.exe',
      arguments: ['--uninstall', '--full'],
      completionTimeoutMinutes: 10,
    });
  });

  it('preserves customer Opera process settings while enforcing the exact reviewed removal contract', () => {
    const adapted = applyApplicationPackagingAdapter('opera.opera', {
      ...DEFAULT_PSADT_CONFIG,
      processesToClose: [
        { name: 'Opera.exe', description: 'Customer browser session' },
      ],
      reviewedUninstallArguments: ['--RUNIMMEDIATELY', '--custom'],
    });

    expect(adapted.processesToClose).toEqual([
      { name: 'Opera', description: 'Customer browser session' },
    ]);
    expect(adapted.reviewedUninstallArguments).toEqual(['--RUNIMMEDIATELY', '--custom']);
    expect(adapted.reviewedExactUninstall).toEqual({
      executablePath: '%ProgramFiles%\\Opera\\opera.exe',
      arguments: ['--uninstall', '--runimmediately', '--deleteuserprofile=0'],
      completionTimeoutMinutes: 5,
    });
  });

  it('uses the reviewed machine-wide Opera GX removal contract', () => {
    const adapted = applyApplicationPackagingAdapter(
      'opera.operagx',
      DEFAULT_PSADT_CONFIG
    );

    expect(adapted.processesToClose).toEqual([
      { name: 'opera', description: 'Opera GX browser' },
    ]);
    expect(adapted.reviewedExactUninstall).toEqual({
      executablePath: '%ProgramFiles%\\Opera GX\\opera.exe',
      arguments: ['--uninstall', '--runimmediately', '--deleteuserprofile=0'],
      completionTimeoutMinutes: 5,
    });
  });

  it('closes the reviewed Adobe desktop processes before Creative Cloud removal', () => {
    const adapted = applyApplicationPackagingAdapter(
      'Adobe.CreativeCloud',
      DEFAULT_PSADT_CONFIG
    );

    expect(adapted.processesToClose).toEqual([
      { name: 'Creative Cloud', description: 'Adobe Creative Cloud' },
      { name: 'AdobeDesktopService', description: 'Adobe Desktop Service' },
      { name: 'AdobeCEFHelper', description: 'Adobe CEF Helper' },
      { name: 'AdobeInstaller', description: 'Adobe Installer' },
      { name: 'AdobeUpdateService', description: 'Adobe Update Service' },
      { name: 'CCLibrary', description: 'Adobe Creative Cloud Library' },
      { name: 'CCXProcess', description: 'Adobe Creative Cloud Experience' },
      { name: 'CoreSync', description: 'Adobe CoreSync' },
      { name: 'AdobeIPCBroker', description: 'Adobe IPC Broker' },
      { name: 'AdobeNotificationClient', description: 'Adobe Notification Client' },
      { name: 'CreativeCloudHelper', description: 'Adobe Creative Cloud Helper' },
    ]);
  });

  it('preserves a customer Adobe process description while filling missing lifecycle entries', () => {
    const adapted = applyApplicationPackagingAdapter('Adobe.CreativeCloud', {
      ...DEFAULT_PSADT_CONFIG,
      processesToClose: [
        { name: 'Creative Cloud.exe', description: 'Customer-managed sync client' },
      ],
    });

    expect(adapted.processesToClose[0]).toEqual({
      name: 'Creative Cloud',
      description: 'Customer-managed sync client',
    });
    expect(adapted.processesToClose).toHaveLength(11);
  });

  it('adds the reviewed Stream Deck lifecycle process to the exact app', () => {
    const adapted = applyApplicationPackagingAdapter(
      'Elgato.StreamDeck',
      DEFAULT_PSADT_CONFIG
    );

    expect(adapted.processesToClose).toEqual([
      { name: 'StreamDeck', description: 'Elgato Stream Deck' },
    ]);
    expect(DEFAULT_PSADT_CONFIG.processesToClose).toEqual([]);
  });

  it('closes Greenshot before install and removal lifecycle actions', () => {
    const adapted = applyApplicationPackagingAdapter(
      'Greenshot.Greenshot',
      DEFAULT_PSADT_CONFIG
    );

    expect(adapted.processesToClose).toEqual([
      { name: 'Greenshot', description: 'Greenshot' },
    ]);
  });

  it('closes Qfinder Pro before its NSIS removal lifecycle', () => {
    const adapted = applyApplicationPackagingAdapter(
      'QNAP.QfinderPro',
      DEFAULT_PSADT_CONFIG
    );

    expect(adapted.processesToClose).toEqual([
      { name: 'QfinderPro', description: 'QNAP Qfinder Pro' },
    ]);
  });

  it('closes the vendor-documented OCS Inventory processes before package lifecycle actions', () => {
    const adapted = applyApplicationPackagingAdapter(
      'OCSInventoryNG.WindowsAgent',
      DEFAULT_PSADT_CONFIG
    );

    expect(adapted.processesToClose).toEqual([
      { name: 'OcsSystray', description: 'OCS Inventory system tray' },
      { name: 'OcsService', description: 'OCS Inventory service' },
      { name: 'OCSInventory', description: 'OCS Inventory agent' },
      { name: 'download', description: 'OCS Inventory download helper' },
    ]);
  });

  it('preserves customer OCS Inventory processes without adding duplicate executable names', () => {
    const adapted = applyApplicationPackagingAdapter('OCSInventoryNG.WindowsAgent', {
      ...DEFAULT_PSADT_CONFIG,
      processesToClose: [
        { name: 'ocsservice.exe', description: 'Customer-managed OCS service' },
        { name: 'OcsNotifyUser', description: 'Customer notification helper' },
      ],
    });

    expect(adapted.processesToClose).toEqual([
      { name: 'ocsservice', description: 'Customer-managed OCS service' },
      { name: 'OcsNotifyUser', description: 'Customer notification helper' },
      { name: 'OcsSystray', description: 'OCS Inventory system tray' },
      { name: 'OCSInventory', description: 'OCS Inventory agent' },
      { name: 'download', description: 'OCS Inventory download helper' },
    ]);
  });

  it('matches WinGet identities case-insensitively', () => {
    expect(
      applyApplicationPackagingAdapter('  elgato.streamdeck  ', DEFAULT_PSADT_CONFIG)
        .processesToClose
    ).toEqual([
      { name: 'StreamDeck', description: 'Elgato Stream Deck' },
    ]);
  });

  it('preserves customer processes and deduplicates names with an exe suffix', () => {
    const adapted = applyApplicationPackagingAdapter('Elgato.StreamDeck', {
      ...DEFAULT_PSADT_CONFIG,
      processesToClose: [
        { name: 'streamdeck.exe', description: 'Customer description' },
        { name: 'companion', description: 'Companion app' },
      ],
    });

    expect(adapted.processesToClose).toEqual([
      { name: 'streamdeck', description: 'Customer description' },
      { name: 'companion', description: 'Companion app' },
    ]);
  });

  it('does not attach an adapter to a different application identity', () => {
    const config = { ...DEFAULT_PSADT_CONFIG, processesToClose: [] };
    expect(applyApplicationPackagingAdapter('Example.StreamDeck', config)).toBe(config);
  });
});
