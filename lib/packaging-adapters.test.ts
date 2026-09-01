import { describe, expect, it } from 'vitest';
import { DEFAULT_PSADT_CONFIG } from '@/types/psadt';
import {
  applyApplicationPackagingAdapter,
  resolveApplicationInstallScope,
  resolveApplicationInstallerSuccessCodes,
  resolveApplicationInstallerSelectionScope,
  resolveApplicationInstallerSelectionType,
  resolveApplicationUninstallCommand,
} from './packaging-adapters';

describe('application packaging adapters', () => {
  it('attests Amazon Music as an argument-free unattended bootstrapper', () => {
    const adapted = applyApplicationPackagingAdapter(
      'Amazon.Music',
      { ...DEFAULT_PSADT_CONFIG }
    );
    expect(adapted.reviewedArgumentlessInstall).toBe(true);
    expect(adapted.uninstallCompletionTimeoutMinutes).toBe(15);
    expect(applyApplicationPackagingAdapter(
      'Example.App',
      { ...DEFAULT_PSADT_CONFIG, reviewedArgumentlessInstall: true }
    ).reviewedArgumentlessInstall).toBeUndefined();
  });

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
    expect(resolveApplicationInstallerSuccessCodes(
      'Piriform.Recuva',
      [3221225477, 3221226505]
    )).toEqual([-1073741819, -1073740791]);
  });

  it('selects Surfshark visible primary ARP registration without trusting customer config', () => {
    expect(
      applyApplicationPackagingAdapter('Surfshark.Surfshark', DEFAULT_PSADT_CONFIG)
        .reviewedPreferVisiblePrimaryUninstallRegistration
    ).toBe(true);
    expect(
      applyApplicationPackagingAdapter('Example.App', {
        ...DEFAULT_PSADT_CONFIG,
        reviewedPreferVisiblePrimaryUninstallRegistration: true,
      }).reviewedPreferVisiblePrimaryUninstallRegistration
    ).toBeUndefined();
  });

  it('binds the legacy Poly Lens catalog ID to the renamed Poly Studio ARP identity', () => {
    expect(
      applyApplicationPackagingAdapter('Poly.PolyLens', {
        ...DEFAULT_PSADT_CONFIG,
        reviewedRegistryUninstallDisplayName: 'customer override',
      }).reviewedRegistryUninstallDisplayName
    ).toBe('Poly Studio');
    expect(
      applyApplicationPackagingAdapter('Example.App', {
        ...DEFAULT_PSADT_CONFIG,
        reviewedRegistryUninstallDisplayName: 'customer override',
      }).reviewedRegistryUninstallDisplayName
    ).toBeUndefined();
  });

  it('binds Jamovi Desktop to its actual lowercase jamovi ARP identity', () => {
    expect(
      applyApplicationPackagingAdapter('Jamovi.Desktop.Current', {
        ...DEFAULT_PSADT_CONFIG,
        reviewedRegistryUninstallDisplayName: 'customer override',
      }).reviewedRegistryUninstallDisplayName
    ).toBe('jamovi');
  });

  it('binds AionUi Community to the upstream AionUi ARP identity', () => {
    expect(
      applyApplicationPackagingAdapter('Lumysia.AionUiCommunity', {
        ...DEFAULT_PSADT_CONFIG,
        reviewedRegistryUninstallDisplayName: 'customer override',
      }).reviewedRegistryUninstallDisplayName
    ).toBe('AionUi');
  });

  it('binds QTTabBar to the exact ARP identity registered by its nested MSI', () => {
    expect(
      applyApplicationPackagingAdapter('indiff.QTTabBar', {
        ...DEFAULT_PSADT_CONFIG,
        reviewedRegistryUninstallDisplayName: 'customer override',
      }).reviewedRegistryUninstallDisplayName
    ).toBe('QTTabBar 1.5.6.1 Beta(2024)');
  });

  it('uses IrfanView\'s documented case-sensitive silent uninstall switch', () => {
    expect(
      applyApplicationPackagingAdapter(
        'irfanskILJan.irfanview',
        DEFAULT_PSADT_CONFIG
      ).reviewedUninstallArguments
    ).toEqual(['/silent']);
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

  it('binds DSH Desktop to its exact unbraced NSIS key despite the catalog typo', () => {
    expect(resolveApplicationUninstallCommand(
      'JustGenius-s.DSHDesktop',
      'REGISTRY_UNINSTALL_PRODUCT:{239D4E5C-394E-5607-BF11-8B5229505789}:DSH-Decktop'
    )).toBe(
      'REGISTRY_UNINSTALL_KEY:239d4e5c-394e-5607-bf11-8b5229505789:DSH-Desktop 0.2.0'
    );
    expect(resolveApplicationUninstallCommand(
      'justgenius-s.dshdesktop',
      'vendor-uninstall.exe --custom'
    )).toBe('vendor-uninstall.exe --custom');
  });

  it('uses Greenshot Preview\'s exact shared Inno registry identity', () => {
    expect(resolveApplicationUninstallCommand(
      'Greenshot.Greenshot.Preview',
      'REGISTRY_UNINSTALL:Greenshot Preview'
    )).toBe('REGISTRY_UNINSTALL_KEY:Greenshot_is1:Greenshot');
    expect(resolveApplicationUninstallCommand(
      'Greenshot.Greenshot',
      'REGISTRY_UNINSTALL:Greenshot'
    )).toBe('REGISTRY_UNINSTALL:Greenshot');
    expect(resolveApplicationUninstallCommand(
      'Greenshot.Greenshot.Preview',
      'vendor-uninstall.exe --custom'
    )).toBe('vendor-uninstall.exe --custom');
  });

  it('uses G.SKILL Trident Z\'s exact vendor Inno registry identity', () => {
    expect(resolveApplicationUninstallCommand(
      'GSKILL.TridentZLightingControl',
      'REGISTRY_UNINSTALL:G.SKILL Trident Z Lighting Control'
    )).toBe(
      'REGISTRY_UNINSTALL_KEY:{97CD7AFC-0ED3-41B8-9CCD-22717E8631D0}_is1:Trident Z Lighting Control'
    );
    expect(resolveApplicationUninstallCommand(
      'gskill.tridentzlightingcontrol',
      'vendor-uninstall.exe --custom'
    )).toBe('vendor-uninstall.exe --custom');
  });

  it('uses IJe\'s stable Inno registry key despite its versioned ARP name', () => {
    expect(resolveApplicationUninstallCommand(
      'IJe.IJe',
      'REGISTRY_UNINSTALL:IJe Programming Language'
    )).toBe(
      'REGISTRY_UNINSTALL_KEY:{C626C8D8-8095-4654-8C2A-851532029011}_is1:IJe version 1.0.1'
    );
    expect(resolveApplicationUninstallCommand(
      'ije.ije',
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
    expect(
      applyApplicationPackagingAdapter(
        'Microsoft.FSLogix',
        DEFAULT_PSADT_CONFIG
      ).reviewedUninstallArguments
    ).toEqual(['/norestart']);
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

  it('uses Chrome Beta EXE\'s vendor channel key instead of WinGet\'s stable key', () => {
    expect(resolveApplicationUninstallCommand(
      'Google.Chrome.Beta.EXE',
      'REGISTRY_UNINSTALL_KEY:Google Chrome:Google Chrome Beta (EXE)'
    )).toBe(
      'REGISTRY_UNINSTALL_KEY:Google Chrome Beta:Google Chrome Beta'
    );
    expect(resolveApplicationUninstallCommand(
      'google.chrome.beta.exe',
      'REGISTRY_UNINSTALL:Google Chrome Beta (EXE)'
    )).toBe(
      'REGISTRY_UNINSTALL_KEY:Google Chrome Beta:Google Chrome Beta'
    );
    expect(resolveApplicationUninstallCommand(
      'Google.Chrome.Beta.EXE',
      'REGISTRY_UNINSTALL_KEY:Different Key:Google Chrome Beta (EXE)'
    )).toBe(
      'REGISTRY_UNINSTALL_KEY:Different Key:Google Chrome Beta (EXE)'
    );
    expect(resolveApplicationUninstallCommand(
      'Google.Chrome.Beta.EXE',
      'vendor-uninstall.exe --custom'
    )).toBe('vendor-uninstall.exe --custom');
  });

  it('uses Postgres Pro 17\'s exact PostgreSQL NSIS registry identity', () => {
    expect(resolveApplicationUninstallCommand(
      'PostgresPro.Standard.17',
      'REGISTRY_UNINSTALL:Postgres Pro Standard 17'
    )).toBe(
      'REGISTRY_UNINSTALL_KEY:PostgreSQL 17 (64bit):PostgreSQL 17 (64bit)'
    );
    expect(resolveApplicationUninstallCommand(
      'PostgresPro.Standard.17',
      'REGISTRY_UNINSTALL:Postgres Pro Standard 16'
    )).toBe('REGISTRY_UNINSTALL:Postgres Pro Standard 16');
    expect(resolveApplicationUninstallCommand(
      'PostgreSQL.PostgreSQL.17',
      'REGISTRY_UNINSTALL:PostgreSQL 17'
    )).toBe('REGISTRY_UNINSTALL:PostgreSQL 17');
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

  it('uses Quassel IRC\'s exact NSIS registry identity', () => {
    expect(resolveApplicationUninstallCommand(
      'Quassel.QuasselIRC',
      'REGISTRY_UNINSTALL:QuasselIRC'
    )).toBe('REGISTRY_UNINSTALL_KEY:Quassel IRC:Quassel IRC');
    expect(resolveApplicationUninstallCommand(
      'quassel.quasselirc',
      'vendor-uninstall.exe --custom'
    )).toBe('vendor-uninstall.exe --custom');
  });

  it('forces reviewed per-user installers out of the LocalSystem profile', () => {
    expect(
      resolveApplicationInstallScope('Y-ASLant.ElegantClipboard', 'machine')
    ).toBe('user');
    expect(
      resolveApplicationInstallScope(' y-aslant.elegantclipboard ', undefined)
    ).toBe('user');
    expect(
      resolveApplicationInstallScope('SIMSDEV.AndroidAppsManager', 'machine')
    ).toBe('user');
    expect(
      resolveApplicationInstallScope(' simsdev.androidappsmanager ', undefined)
    ).toBe('user');
    expect(resolveApplicationInstallScope('WowUp.Wowup.Beta', 'machine')).toBe(
      'user'
    );
    expect(
      resolveApplicationInstallScope(' wowup.wowup.beta ', undefined)
    ).toBe('user');
    expect(
      resolveApplicationInstallScope('WebCatalogLtd.Switchbar', 'machine')
    ).toBe('user');
    expect(
      resolveApplicationInstallScope(' webcatalogltd.switchbar ', undefined)
    ).toBe('user');
    expect(
      resolveApplicationInstallScope('ITWCreativeWorks.Somiibo', 'machine')
    ).toBe('user');
    expect(
      resolveApplicationInstallScope(' itwcreativeworks.somiibo ', undefined)
    ).toBe('user');
    expect(resolveApplicationInstallScope('SeqLens.SeqLens', 'machine')).toBe(
      'user'
    );
    expect(resolveApplicationInstallScope(' seqlens.seqlens ', undefined)).toBe(
      'user'
    );
    expect(resolveApplicationInstallScope('AvaCC.AvaDesktop', 'machine')).toBe(
      'user'
    );
    expect(resolveApplicationInstallScope(' avacc.avadesktop ', undefined)).toBe(
      'user'
    );
    expect(resolveApplicationInstallScope('saraansx.Luniq', 'machine')).toBe(
      'user'
    );
    expect(resolveApplicationInstallScope(' saraansx.luniq ', undefined)).toBe(
      'user'
    );
    expect(
      resolveApplicationInstallScope('ente-io.photos-desktop', 'machine')
    ).toBe('user');
    expect(
      resolveApplicationInstallScope(' ENTE-IO.PHOTOS-DESKTOP ', undefined)
    ).toBe('user');
    expect(resolveApplicationInstallScope('VNGCorp.Zalo', 'machine')).toBe('user');
    expect(
      resolveApplicationInstallScope('Streetwriters.Notesnook', 'machine')
    ).toBe('user');
    expect(
      resolveApplicationInstallScope(' streetwriters.notesnook ', undefined)
    ).toBe('user');
    expect(
      resolveApplicationInstallScope(
        'AppiumDevelopers.AppiumInspector',
        'machine'
      )
    ).toBe('user');
    expect(resolveApplicationInstallScope('Zoho.Mail', 'machine')).toBe('user');
    expect(resolveApplicationInstallScope(' zoho.mail ', undefined)).toBe('user');
    expect(resolveApplicationInstallScope(
      'BarryCarlyon.BarryCarlyonExtensionTools',
      'machine'
    )).toBe('user');
    expect(resolveApplicationInstallScope(
      ' barrycarlyon.barrycarlyonextensiontools ',
      undefined
    )).toBe('user');
    expect(resolveApplicationInstallScope(
      'ShatteredChaos.FightPlanner',
      'machine'
    )).toBe('user');
    expect(resolveApplicationInstallScope(
      ' shatteredchaos.fightplanner ',
      undefined
    )).toBe('user');
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
    expect(resolveApplicationInstallScope(
      'SeasaltAI.SeaMeetSnapRecorder',
      'machine'
    )).toBe('user');
    expect(resolveApplicationInstallScope(
      ' seasaltai.seameetsnaprecorder ',
      undefined
    )).toBe('user');
    expect(resolveApplicationInstallScope('SamsungSDS.BrityMeeting', 'machine')).toBe('user');
    expect(resolveApplicationInstallScope(
      ' samsungsds.britymeeting ',
      undefined
    )).toBe('user');
    expect(
      resolveApplicationInstallScope('RedisInsight.RedisInsight', 'machine')
    ).toBe('user');
    expect(
      resolveApplicationInstallScope(' redisinsight.redisinsight ', undefined)
    ).toBe('user');
    expect(resolveApplicationInstallScope('Rakuten.Viber', 'machine')).toBe('user');
    expect(resolveApplicationInstallScope(' rakuten.viber ', undefined)).toBe('user');
    expect(resolveApplicationInstallScope('TorProject.TorBrowser', 'machine')).toBe('user');
    expect(resolveApplicationInstallScope(' torproject.torbrowser ', undefined)).toBe('user');
    expect(resolveApplicationInstallScope('Example.App', 'user')).toBe('user');
    expect(resolveApplicationInstallScope('Example.App', 'machine')).toBe('machine');
  });

  it('runs zyfun assisted NSIS all-users so its VC++ prerequisite can complete', () => {
    expect(resolveApplicationInstallScope('HiramWong.zyfun', 'user')).toBe(
      'machine'
    );
    expect(
      resolveApplicationInstallScope(' hiramwong.zyfun ', undefined)
    ).toBe('machine');
    expect(
      applyApplicationPackagingAdapter(
        'HiramWong.zyfun',
        DEFAULT_PSADT_CONFIG
      )
    ).toMatchObject({
      reviewedInstallArguments: ['/allusers'],
    });
  });

  it('keeps Appium Inspector on its machine-labelled manifest bytes while executing per-user', () => {
    expect(resolveApplicationInstallScope(
      'AppiumDevelopers.AppiumInspector',
      'machine'
    )).toBe('user');
    expect(resolveApplicationInstallerSelectionScope(
      'AppiumDevelopers.AppiumInspector',
      'user'
    )).toBe('machine');
  });

  it('keeps Zoho Mail on its machine-labelled manifest bytes while executing per-user', () => {
    expect(resolveApplicationInstallScope('Zoho.Mail', 'machine')).toBe('user');
    expect(resolveApplicationInstallerSelectionScope(
      'Zoho.Mail',
      'user'
    )).toBe('machine');
  });

  it('keeps BarryCarlyon Extension Tools on its machine-labelled bytes while executing per-user', () => {
    expect(resolveApplicationInstallScope(
      'BarryCarlyon.BarryCarlyonExtensionTools',
      'machine'
    )).toBe('user');
    expect(resolveApplicationInstallerSelectionScope(
      'BarryCarlyon.BarryCarlyonExtensionTools',
      'user'
    )).toBe('machine');
  });

  it('keeps FightPlanner on its machine-labelled bytes while executing per-user', () => {
    expect(resolveApplicationInstallScope(
      'ShatteredChaos.FightPlanner',
      'machine'
    )).toBe('user');
    expect(resolveApplicationInstallerSelectionScope(
      'ShatteredChaos.FightPlanner',
      'user'
    )).toBe('machine');
  });

  it('requires Webroot SecureAnywhere to use its unattended MSI lifecycle', () => {
    expect(resolveApplicationInstallerSelectionType('Webroot.SecureAnywhere')).toBe('msi');
    expect(resolveApplicationInstallerSelectionType(' webroot.secureanywhere ')).toBe('msi');
    expect(
      applyApplicationPackagingAdapter('Webroot.SecureAnywhere', DEFAULT_PSADT_CONFIG)
    ).toMatchObject({
      reviewedInstallArguments: ['CMDLINE=SME,quiet'],
      reviewedInstallCompletionTimeoutMinutes: 30,
    });
    expect(resolveApplicationInstallerSelectionType('Example.App')).toBeUndefined();
  });

  it('runs Logitech LGS elevated without weakening catalog scope matching', () => {
    expect(resolveApplicationInstallScope('Logitech.LGS', 'user')).toBe('machine');
    expect(resolveApplicationInstallerSelectionScope(
      'Logitech.LGS',
      'machine'
    )).toBe('user');
    const adapted = applyApplicationPackagingAdapter(
      'Logitech.LGS',
      DEFAULT_PSADT_CONFIG
    );
    expect(adapted.reviewedInstallArgumentsOverride).toBeUndefined();
    expect(adapted.reviewedExactUninstall).toEqual({
      executablePath:
        '%ProgramFiles%\\Logitech Gaming Software\\uninstallhlpr.exe',
      arguments: [
        '/bitness=x64',
        '/silentmode=on',
        '/langid=ENU',
        '/downgrade=no',
        '/firstRun=yes',
        '/S',
      ],
      completionTimeoutMinutes: 5,
    });
    expect(adapted.reviewedExactUninstall?.arguments).not.toContain(
      '/silentmode=off'
    );
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

  it('runs WatchBP Analyzer elevated without weakening catalog scope matching', () => {
    expect(resolveApplicationInstallScope(
      'Microlife.WatchBPAnalyzer',
      'user'
    )).toBe('machine');
    expect(resolveApplicationInstallerSelectionScope(
      'Microlife.WatchBPAnalyzer',
      'machine'
    )).toBe('user');
    expect(resolveApplicationInstallScope('Example.App', 'user')).toBe('user');
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

  it('models Olive as the vendor-defined machine-wide non-ARP lifecycle', () => {
    expect(
      resolveApplicationInstallScope('OliveTeam.OliveVideoEditor', 'user')
    ).toBe('machine');
    expect(
      applyApplicationPackagingAdapter(
        'OliveTeam.OliveVideoEditor',
        DEFAULT_PSADT_CONFIG
      )
    ).toMatchObject({
      reviewedManagedInstallDirectory: '%ProgramW6432%\\Olive',
      reviewedManagedInstallEvidenceFile:
        '%ProgramW6432%\\Olive\\olive-editor.exe',
      reviewedManagedInstallCompletionTimeoutMinutes: 5,
      reviewedManagedUninstall: {
        executablePath: '%ProgramW6432%\\Olive\\uninstall.exe',
        arguments: ['/S'],
        completionTimeoutMinutes: 5,
      },
    });
  });

  it('uses Teradata\'s suite-specific silent archive removal contract', () => {
    expect(
      applyApplicationPackagingAdapter('Teradata.TTUOdbc', DEFAULT_PSADT_CONFIG)
    ).toMatchObject({
      reviewedArchiveUninstall: {
        relativePath: 'TeradataODBC\\silent_uninstall.bat',
        arguments: ['ALL'],
        completionTimeoutMinutes: 15,
      },
    });
  });

  it('keeps the darktable NSIS extraction observable within a bounded wait', () => {
    expect(
      applyApplicationPackagingAdapter('darktable.darktable', DEFAULT_PSADT_CONFIG)
    ).toMatchObject({
      reviewedInstallCompletionTimeoutMinutes: 15,
    });
  });

  it('keeps the Retoolkit component bundle observable within a bounded wait', () => {
    expect(
      applyApplicationPackagingAdapter(
        'mentebinaria.retoolkit',
        DEFAULT_PSADT_CONFIG
      )
    ).toMatchObject({
      reviewedInstallCompletionTimeoutMinutes: 45,
    });
  });

  it('keeps the ARES Commander bootstrapper observable within a bounded wait', () => {
    expect(
      applyApplicationPackagingAdapter(
        'Graebert.AresCommander.2022',
        DEFAULT_PSADT_CONFIG
      )
    ).toMatchObject({
      reviewedInstallCompletionTimeoutMinutes: 15,
    });
  });

  it('keeps the FlashPrint bootstrapper observable within a bounded wait', () => {
    expect(
      applyApplicationPackagingAdapter(
        'Flashforge.FlashPrint',
        DEFAULT_PSADT_CONFIG
      )
    ).toMatchObject({
      reviewedInstallCompletionTimeoutMinutes: 15,
    });
  });

  it('keeps the SEGGER Embedded Studio installer observable within a bounded wait', () => {
    expect(
      applyApplicationPackagingAdapter(
        'Segger.EmbeddedStudioARM',
        DEFAULT_PSADT_CONFIG
      )
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
      )
    ).not.toHaveProperty('reviewedExactUninstall');
    expect(resolveApplicationInstallScope('SoftwareOK.DesktopOK', 'user')).toBe(
      'user'
    );
    expect(
      applyApplicationPackagingAdapter('SoftwareOK.Q-Dir', DEFAULT_PSADT_CONFIG)
        .reviewedUninstallArguments
    ).toEqual([]);
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
      applyApplicationPackagingAdapter(
        'Trimble.SketchUp.2022',
        DEFAULT_PSADT_CONFIG
      ).reviewedUninstallArguments
    ).toEqual(['-silent']);
    expect(
      applyApplicationPackagingAdapter(
        'Trimble.SketchUpViewer',
        DEFAULT_PSADT_CONFIG
      ).reviewedUninstallArguments
    ).toEqual(['-silent']);
    expect(
      applyApplicationPackagingAdapter('Tricentis.NeoLoad', DEFAULT_PSADT_CONFIG)
        .reviewedUninstallArguments
    ).toEqual(['-q']);
    expect(
      applyApplicationPackagingAdapter(
        'ReceitaFederaldoBrasil.ReceitanetBX',
        DEFAULT_PSADT_CONFIG
      ).reviewedUninstallArguments
    ).toEqual(['/mode', 'silent']);
    expect(
      applyApplicationPackagingAdapter(
        'Microchip.MPLABXC16CCompiler',
        DEFAULT_PSADT_CONFIG
      ).reviewedUninstallArguments
    ).toEqual(['--mode', 'unattended']);
    expect(
      applyApplicationPackagingAdapter(
        'Atlassian.ServiceManagementLTS',
        DEFAULT_PSADT_CONFIG
      ).reviewedUninstallArguments
    ).toEqual(['-q']);
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
      applyApplicationPackagingAdapter('MiKTeX.MiKTeX', DEFAULT_PSADT_CONFIG)
        .reviewedExactUninstall
    ).toEqual({
      executablePath:
        '%ProgramFiles%\\MiKTeX\\miktex\\bin\\x64\\miktexsetup.exe',
      arguments: ['--quiet', '--shared=yes', 'uninstall'],
      completionTimeoutMinutes: 15,
    });
    expect(
      applyApplicationPackagingAdapter(
        'Microsoft.AzureMonitorAgent',
        DEFAULT_PSADT_CONFIG
      ).reviewedUninstallServiceNames
    ).toEqual(['AzureMonitorAgent']);
    expect(
      applyApplicationPackagingAdapter('Logitech.LogiBolt', DEFAULT_PSADT_CONFIG)
        .reviewedExactUninstall
    ).toEqual({
      executablePath: '%ProgramFiles%\\Logi\\LogiBolt\\LogiBoltUninstaller.exe',
      arguments: ['/silent'],
      completionTimeoutMinutes: 5,
    });
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
        'Autodesk.DesktopConnector',
        DEFAULT_PSADT_CONFIG
      )
    ).toMatchObject({
      processesToClose: [
        {
          name: 'DesktopConnector.Applications.Tray',
          description: 'Autodesk Desktop Connector',
        },
      ],
      reviewedInstallCompletionTimeoutMinutes: 15,
    });
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
        'Autodesk.DesignReview',
        DEFAULT_PSADT_CONFIG
      )
    ).toMatchObject({
      reviewedManagedInstallDirectory:
        '%ProgramW6432%\\Autodesk\\Autodesk Design Review',
      reviewedManagedInstallEvidenceFile:
        '%ProgramW6432%\\Autodesk\\Autodesk Design Review\\DesignReview.exe',
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
          '%ProgramData%\\Autodesk\\ODIS\\metadata\\{C1AF4762-AE0A-3B4E-836B-D4C091BF46F8}\\bundleManifest.xml',
          '-x',
          '%ProgramData%\\Autodesk\\ODIS\\metadata\\{C1AF4762-AE0A-3B4E-836B-D4C091BF46F8}\\SetupRes\\manifest.xsd',
        ],
        completionTimeoutMinutes: 15,
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
      reviewedInstallArguments: [
        '--installPath "%ProgramFiles%\\Microsoft Visual Studio\\18\\BuildTools"',
        '--add Microsoft.VisualStudio.Workload.MSBuildTools',
        '--norestart',
      ],
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
      reviewedInstallArguments: [
        '--installPath "%ProgramFiles(x86)%\\Microsoft Visual Studio\\2022\\BuildTools"',
        '--add Microsoft.VisualStudio.Workload.MSBuildTools',
        '--norestart',
      ],
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

  it('drives only IDM reviewed uninstaller windows and keeps ARP removal authoritative', () => {
    const adapted = applyApplicationPackagingAdapter(
      'Tonec.InternetDownloadManager',
      { ...DEFAULT_PSADT_CONFIG, reviewedUninstallArguments: ['/S'] }
    );

    expect(adapted.reviewedUninstallArguments).toEqual([]);
    expect(adapted.reviewedUninstallWindowAutomation).toEqual({
      processName: 'Uninstall.exe',
      steps: [
        {
          windowText: 'Internet Download Manager',
          buttonIndex: 2,
          timeoutSeconds: 60,
        },
        { buttonIndex: 3, timeoutSeconds: 15 },
        {
          windowText: 'Internet protocol options',
          buttonIndex: 2,
          timeoutSeconds: 15,
        },
      ],
    });
    expect(adapted.uninstallCompletionTimeoutMinutes).toBe(3);
  });

  it('uses IObit detain removal with the exact captured ARP command', () => {
    const adapted = applyApplicationPackagingAdapter(
      'iobit.uninstaller',
      DEFAULT_PSADT_CONFIG
    );

    expect(adapted.reviewedUninstallArguments).toEqual(['/DetainUninstall']);
  });

  it('recovers iFun Screenshot only through its reviewed exact captured identity', () => {
    const adapted = applyApplicationPackagingAdapter(
      'iobit.ifunscreenshot',
      DEFAULT_PSADT_CONFIG
    );

    expect(adapted.reviewedRecoverCapturedUninstallByExactIdentity).toBe(true);
    expect(
      applyApplicationPackagingAdapter('Example.App', {
        ...DEFAULT_PSADT_CONFIG,
        reviewedRecoverCapturedUninstallByExactIdentity: true,
      }).reviewedRecoverCapturedUninstallByExactIdentity
    ).toBeUndefined();
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

  it('stages Egnyte updates on boot when managed packaging suppresses reboot', () => {
    const adapted = applyApplicationPackagingAdapter(
      'Egnyte.EgnyteDesktopApp',
      DEFAULT_PSADT_CONFIG
    );

    expect(adapted.reviewedInstallArguments).toEqual(['ED_UPDATE_ON_BOOT=1']);
    expect(adapted.reviewedUninstallArguments).toEqual([]);
  });

  it('uses Microsoft\'s documented Service Fabric runtime install contract', () => {
    const adapted = applyApplicationPackagingAdapter(
      'Microsoft.ServiceFabricRuntime',
      DEFAULT_PSADT_CONFIG
    );

    expect(adapted.reviewedInstallArgumentsOverride).toBe('/accepteula');
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

  it('uses BlueJ\'s documented explicit per-user MSI contract', () => {
    expect(resolveApplicationInstallScope('BlueJTeam.BlueJ', 'machine')).toBe('user');
    const adapted = applyApplicationPackagingAdapter(
      'BlueJTeam.BlueJ',
      DEFAULT_PSADT_CONFIG
    );

    expect(adapted.reviewedInstallArgumentsOverride).toBe(
      '/qn /norestart ALLUSERS=2 MSIINSTALLPERUSER=1 INSTALLDIR="%LOCALAPPDATA%\\Programs\\BlueJ"'
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

  it('selects TreeSize administrative Inno mode for LocalSystem deployment', () => {
    expect(resolveApplicationInstallScope('JAMSoftware.TreeSize', 'user')).toBe('machine');
    const adapted = applyApplicationPackagingAdapter(
      'JAMSoftware.TreeSize',
      DEFAULT_PSADT_CONFIG
    );

    expect(adapted.reviewedInstallArgumentsOverride).toBe(
      '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- /ALLUSERS'
    );
    expect(adapted.reviewedUninstallArguments).toEqual([]);
  });

  it('runs the elevation-requiring WPS Office installer as LocalSystem', () => {
    expect(resolveApplicationInstallScope('Kingsoft.WPSOffice', 'user')).toBe('machine');
    expect(resolveApplicationInstallerSelectionScope(
      'Kingsoft.WPSOffice',
      'machine'
    )).toBe('user');
    const adapted = applyApplicationPackagingAdapter(
      'kingsoft.wpsoffice',
      DEFAULT_PSADT_CONFIG
    );

    expect(adapted.reviewedInstallArgumentsOverride).toBeUndefined();
    expect(adapted.reviewedUninstallArguments).toEqual([]);
  });

  it('runs TeamSpeak 6 Beta all-users MSI contract as LocalSystem', () => {
    expect(resolveApplicationInstallScope(
      'TeamSpeakSystems.TeamSpeakClient.Beta.6',
      'user'
    )).toBe('machine');
    expect(resolveApplicationInstallerSelectionScope(
      'TeamSpeakSystems.TeamSpeakClient.Beta.6',
      'machine'
    )).toBe('user');
    expect(resolveApplicationInstallScope('Example.App', 'user')).toBe('user');
  });

  it('runs the Simple Hydraulic Calculator NSIS uninstaller in place', () => {
    const adapted = applyApplicationPackagingAdapter(
      'igneus.simplehydrauliccalculator',
      DEFAULT_PSADT_CONFIG
    );

    expect(adapted.reviewedExactUninstall).toEqual({
      executablePath:
        '%ProgramFiles(x86)%\\Igneus\\SHC\\shc2uninstall.exe',
      arguments: ['/S _?=%ProgramFiles(x86)%\\Igneus\\SHC'],
      completionTimeoutMinutes: 5,
    });
    expect(adapted.reviewedExactUninstall?.arguments).toHaveLength(1);
    expect(adapted.reviewedUninstallWindowAutomation).toEqual({
      processName: 'shc2uninstall.exe',
      steps: [
        {
          windowText: 'Simple Hydraulic Calculator',
          buttonIndex: 1,
          timeoutSeconds: 60,
        },
      ],
    });
  });

  it('uses JetBrains silent mode with the exact dotPeek ARP command', () => {
    const adapted = applyApplicationPackagingAdapter(
      'jetbrains.dotpeek',
      DEFAULT_PSADT_CONFIG
    );

    expect(adapted.reviewedUninstallArguments).toEqual(['/Silent=True']);
    expect(adapted.reviewedInstallArgumentsOverride).toBeUndefined();
  });

  it('uses Total Commander\'s documented complete unattended uninstall mode', () => {
    const adapted = applyApplicationPackagingAdapter(
      'ghisler.totalcommander',
      DEFAULT_PSADT_CONFIG
    );

    expect(adapted.reviewedUninstallArguments).toEqual(['/7']);
    expect(adapted.reviewedInstallArgumentsOverride).toBeUndefined();
  });

  it('pins RobotStudio to its complete silent install and exact 2025.2 MSI identity', () => {
    const adapted = applyApplicationPackagingAdapter(
      'abb.robotstudio',
      DEFAULT_PSADT_CONFIG
    );

    expect(adapted.reviewedInstallArgumentsOverride).toBe(
      '/s /v"/qn ADDLOCAL=ALL /norestart"'
    );
    expect(adapted.reviewedInstallCompletionTimeoutMinutes).toBe(15);
    expect(
      resolveApplicationUninstallCommand(
        'ABB.RobotStudio',
        'REGISTRY_UNINSTALL:RobotStudio'
      )
    ).toBe(
      'REGISTRY_UNINSTALL_PRODUCT:{F8E387C8-8D36-4513-A1AB-9C438461D926}:ABB RobotStudio 2025.2'
    );
  });

  it('keeps MaxTo in user scope with a reviewed observable installer wait', () => {
    const adapted = applyApplicationPackagingAdapter(
      'domino.maxto',
      DEFAULT_PSADT_CONFIG
    );

    expect(resolveApplicationInstallScope('Domino.MaxTo', 'machine')).toBe('user');
    expect(adapted.reviewedInstallCompletionTimeoutMinutes).toBe(15);
  });

  it('uses Mozilla NSIS silent mode with the exact Zen Browser ARP command', () => {
    const adapted = applyApplicationPackagingAdapter(
      'zen-team.zen-browser',
      DEFAULT_PSADT_CONFIG
    );

    expect(adapted.reviewedUninstallArguments).toEqual(['/S']);
    expect(adapted.reviewedInstallArgumentsOverride).toBeUndefined();
  });

  it('uses Mozilla NSIS silent mode with the exact Waterfox ARP command', () => {
    const adapted = applyApplicationPackagingAdapter(
      'waterfox.waterfox',
      DEFAULT_PSADT_CONFIG
    );

    expect(adapted.reviewedUninstallArguments).toEqual(['/S']);
    expect(adapted.reviewedInstallArgumentsOverride).toBeUndefined();
  });

  it('uses JetBrains Toolbox\'s documented headless uninstall mode', () => {
    const adapted = applyApplicationPackagingAdapter(
      'jetbrains.toolbox',
      DEFAULT_PSADT_CONFIG
    );

    expect(adapted.reviewedUninstallArguments).toEqual(['/headless']);
    expect(adapted.reviewedInstallArgumentsOverride).toBeUndefined();
  });

  it('uses Postgres Pro 17\'s reviewed NSIS silent uninstall mode', () => {
    const adapted = applyApplicationPackagingAdapter(
      'postgrespro.standard.17',
      DEFAULT_PSADT_CONFIG
    );

    expect(adapted.reviewedUninstallArguments).toEqual(['/S']);
    expect(adapted.reviewedInstallArgumentsOverride).toBeUndefined();
  });

  it('selects Podman Desktop all-users mode for the full Intune lifecycle', () => {
    const adapted = applyApplicationPackagingAdapter(
      'redhat.podman-desktop',
      DEFAULT_PSADT_CONFIG
    );

    expect(adapted.reviewedInstallArgumentsOverride).toBe('/S /allusers');
    expect(adapted.reviewedUninstallArguments).toEqual(['/allusers', '/S']);
  });

  it('selects UniFi OS Server all-users mode for the full Intune lifecycle', () => {
    const adapted = applyApplicationPackagingAdapter(
      'ubiquiti.unifiosserver',
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

  it('uses exact Microsoft Appx evidence for Windows App Runtime 1.8', () => {
    expect(
      applyApplicationPackagingAdapter(
        'microsoft.windowsappruntime.1.8',
        DEFAULT_PSADT_CONFIG
      )
    ).toMatchObject({
      preserveVendorInstallationOnUninstall: true,
      reviewedAppxInstallEvidence: {
        packageName: 'Microsoft.WindowsAppRuntime.1.8',
        publisherId: '8wekyb3d8bbwe',
        minimumVersion: '8000.879.2017.0',
      },
    });
  });

  it('uses exact Microsoft Appx evidence for Windows App Runtime 1.3', () => {
    expect(
      applyApplicationPackagingAdapter(
        'microsoft.windowsappruntime.1.3',
        DEFAULT_PSADT_CONFIG
      )
    ).toMatchObject({
      preserveVendorInstallationOnUninstall: true,
      reviewedAppxInstallEvidence: {
        packageName: 'Microsoft.WindowsAppRuntime.1.3',
        publisherId: '8wekyb3d8bbwe',
        minimumVersion: '3000.934.1904.0',
      },
    });
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
      reviewedAppxInstallEvidence: {
        packageName: 'Example.Framework',
        publisherId: 'example1234567',
        minimumVersion: '1.0.0.0',
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
      reviewedArchiveUninstall: {
        relativePath: 'Example\\silent_uninstall.bat',
        arguments: ['ALL'],
        completionTimeoutMinutes: 5,
      },
    });

    expect(adapted.preserveVendorInstallationOnUninstall).toBeUndefined();
    expect(adapted.reviewedMultiProductInstallDisplayNamePrefixes).toBeUndefined();
    expect(adapted.reviewedMultiProductInstallMinimumCount).toBeUndefined();
    expect(adapted.reviewedRegistryInstallEvidence).toBeUndefined();
    expect(adapted.reviewedAppxInstallEvidence).toBeUndefined();
    expect(adapted.reviewedInstallShieldAdministrativeImage).toBeUndefined();
    expect(adapted.reviewedInstallCompletionTimeoutMinutes).toBeUndefined();
    expect(adapted.reviewedManagedInstallDirectory).toBeUndefined();
    expect(adapted.reviewedManagedInstallEvidenceFile).toBeUndefined();
    expect(adapted.reviewedManagedInstallCompletionProcess).toBeUndefined();
    expect(adapted.reviewedManagedInstallCompletionTimeoutMinutes).toBeUndefined();
    expect(adapted.reviewedManagedUninstall).toBeUndefined();
    expect(adapted.reviewedExactUninstall).toBeUndefined();
    expect(adapted.reviewedArchiveUninstall).toBeUndefined();
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

  it('closes both Playnite frontends before its exact Inno removal', () => {
    expect(
      applyApplicationPackagingAdapter(
        'playnite.playnite',
        DEFAULT_PSADT_CONFIG
      ).processesToClose
    ).toEqual([
      { name: 'Playnite.DesktopApp', description: 'Playnite Desktop' },
      { name: 'Playnite.FullscreenApp', description: 'Playnite Fullscreen' },
    ]);
  });

  it.each([
    'Microsoft.SQLServerManagementStudio.21',
    'Microsoft.SQLServerManagementStudio.21.Preview',
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

  it('does not retain the disproven Stream Deck lifecycle guard', () => {
    const adapted = applyApplicationPackagingAdapter(
      'Elgato.StreamDeck',
      DEFAULT_PSADT_CONFIG
    );

    expect(adapted.processesToClose).toEqual([]);
    expect(adapted.reviewedUninstallProcessGuard).toBeUndefined();
    expect(DEFAULT_PSADT_CONFIG.processesToClose).toEqual([]);
  });

  it('closes Greenshot before install and removal lifecycle actions', () => {
    for (const wingetId of [
      'Greenshot.Greenshot',
      'Greenshot.Greenshot.Preview',
    ]) {
      const adapted = applyApplicationPackagingAdapter(
        wingetId,
        DEFAULT_PSADT_CONFIG
      );

      expect(adapted.processesToClose).toEqual([
        { name: 'Greenshot', description: 'Greenshot' },
      ]);
    }
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
      applyApplicationPackagingAdapter('  elgato.camerahub  ', DEFAULT_PSADT_CONFIG)
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
  });

  it('preserves customer Stream Deck configuration without an adapter', () => {
    const config = {
      ...DEFAULT_PSADT_CONFIG,
      processesToClose: [
        { name: 'streamdeck.exe', description: 'Customer description' },
        { name: 'companion', description: 'Companion app' },
      ],
    };
    const adapted = applyApplicationPackagingAdapter('Elgato.StreamDeck', config);

    expect(adapted).toBe(config);
    expect(adapted.processesToClose).toEqual([
      { name: 'streamdeck.exe', description: 'Customer description' },
      { name: 'companion', description: 'Companion app' },
    ]);
    expect(adapted.reviewedUninstallProcessGuard).toBeUndefined();
  });

  it('does not attach an adapter to a different application identity', () => {
    const config = { ...DEFAULT_PSADT_CONFIG, processesToClose: [] };
    expect(applyApplicationPackagingAdapter('Example.StreamDeck', config)).toBe(config);
  });

  it('rejects a close-process entry without an executable name for apps without an adapter', () => {
    const config = {
      ...DEFAULT_PSADT_CONFIG,
      processesToClose: [
        { name: '', description: 'Git' },
        { name: '', description: 'Git Bash' },
      ],
    };

    expect(() => applyApplicationPackagingAdapter('Git.Git', config)).toThrow(
      'A process to close for Git.Git is missing its executable name (Git, Git Bash)'
    );
  });

  it('rejects a name that is only a .exe suffix', () => {
    const config = {
      ...DEFAULT_PSADT_CONFIG,
      processesToClose: [{ name: '.exe', description: 'Broken entry' }],
    };

    expect(() => applyApplicationPackagingAdapter('Git.Git', config)).toThrow(
      'missing its executable name'
    );
  });

  it('drops fully empty close-process rows for apps without an adapter', () => {
    const config = {
      ...DEFAULT_PSADT_CONFIG,
      processesToClose: [
        { name: 'git', description: 'Git' },
        { name: '', description: '' },
        { name: '   ', description: '' },
      ],
    };

    const adapted = applyApplicationPackagingAdapter('Git.Git', config);

    expect(adapted.processesToClose).toEqual([{ name: 'git', description: 'Git' }]);
  });

  it('keeps valid close-process rows byte-identical for apps without an adapter', () => {
    const config = {
      ...DEFAULT_PSADT_CONFIG,
      processesToClose: [{ name: 'notepad++.exe', description: 'Notepad++' }],
    };

    const adapted = applyApplicationPackagingAdapter('Notepad++.Notepad++', config);

    expect(adapted).toBe(config);
    expect(adapted.processesToClose[0]).toEqual({
      name: 'notepad++.exe',
      description: 'Notepad++',
    });
  });
});
