export interface QaToolchainBackfillCandidate {
  wingetId: string;
  status: string;
  priority: number;
  enqueuedAt: string;
}

// A packager release should not automatically re-run every known vendor or
// application failure. Record only the apps whose previously failing path is
// changed by the current packager release. Successful and never-tested apps
// continue through the normal compatibility/backfill logic.
const TOOLCHAIN_TERMINAL_RETRY_TARGETS: Readonly<Record<string, readonly string[]>> = {
  '1490844284f84f807e207fb9970bddc499bbe446': [
    // Evernote's NSIS uninstaller cannot finish while its desktop process is
    // active. This release closes it through the shared PSADT lifecycle.
    'Evernote.Evernote',
    // Preserve the targeted validation for the immediately preceding HP Image
    // Assistant lifecycle fix until that failed payload records a passing run.
    'HP.ImageAssistant',
  ],
  '34189c6876f0fe4539b971ba1b9e962ff66cd259': [
    // HP Image Assistant is a SoftPaq extractor with no ARP lifecycle. This
    // release verifies and removes its exact managed SWSetup payload for both
    // QA and customer packages.
    'HP.ImageAssistant',
  ],
  '9f3105f568ec221fb672a53f1dbafdf01cd2e8b5': [
    // Opera GX's registered slash command exits without removing the browser.
    // This release uses the reviewed machine-wide double-dash lifecycle.
    'Opera.OperaGX',
  ],
  '4ca2932ca8ff26578cade36457f0fcc150513e4c': [
    // Dell's registered InstallShield helper ignored documented silent removal
    // switches. This release invokes the original hash-verified Dell Update
    // Package with /passthrough /silent /remove.
    'Dell.Optimizer',
  ],
  '4ca55ff8ac8d4d5f6d07665adbe06a07f0110006': [
    // Dell Optimizer's registered removal command is interactive and leaves
    // its exact ARP identity. This release applies Dell's documented
    // unattended /silent /remove lifecycle to QA and customer packages.
    'Dell.Optimizer',
  ],
  '3fce249f5021c120a23ed0ab5dc726baaf060f3e': [
    // Claude Code ships as a bare portable executable. Earlier releases
    // generated an incomplete archive command for it; this release installs
    // bare portable payloads through the reviewed copy lifecycle.
    'Anthropic.ClaudeCode',
    // Platform Tools is a plain zip with no nested installer contract. This
    // release stages such archives as complete portable folders instead of
    // failing with the nested installer requirement.
    'Google.PlatformTools',
  ],
  '9214e4b5b71508bfba9aa1a2d4de5c3c771d3fea': [
    // Viber's machine-declared MSI resolves LocalAppData into the SYSTEM
    // profile and its VerifyInstalledFiles action then fails with 1603. The
    // shared adapter now packages this vendor installer in reviewed user scope.
    'Rakuten.Viber',
  ],
  '8235887e7126972b89c264e2053c1c4f7418ea74': [
    // Opera removes its product registration while retaining a small assistant
    // payload. This release verifies the exact ARP identity after running the
    // reviewed launcher command instead of waiting for the directory to vanish.
    'Opera.Opera',
  ],
  '5f95d233998479791a49d1d784ea95137c098e73': [
    // Opera's registered slash-form uninstall verb exits without removing the
    // product. This release invokes the reviewed double-dash launcher command
    // exactly and verifies that the machine installation directory disappears.
    'Opera.Opera',
  ],
  '2e68a941d3410e4eb7c6ed1e73fbc0eff290c807': [
    // These extractors have no single vendor ARP identity. The new managed
    // directory contract verifies their real payload and removes it through
    // either exact folder ownership or the documented vendor lifecycle.
    'Microsoft.OfficeDeploymentTool',
    'Microsoft.VisualStudio.BuildTools',
    // Opera now receives an explicit profile-retention choice so its SYSTEM
    // uninstaller cannot wait behind that unresolved prompt.
    'Opera.Opera',
  ],
  'cf24633576b6c5efcca5fbde8ffe7fb4f0f57272': [
    // Camera Hub's MSI launches a fresh --pre-uninstall --quit helper after
    // PSADT closes the desktop process. This release gives only that reviewed
    // command line a grace period before ending it so MSI removal can finish.
    'Elgato.CameraHub',
  ],
  '54515b6566ff4e7c9040fa24a8eba6b6347ef09e': [
    // ZIP is the package transport, not the registered uninstall engine.
    // This release carries the nested Inno type into both QA and customer
    // packages so MPC-BE receives the fully unattended uninstall switches.
    'MPC-BE.MPC-BE',
    // Carry the two reviewed lifecycle retries through the atomic toolchain
    // rollout; neither completed successfully on the preceding pin.
    'Elgato.CameraHub',
    'Microsoft.VSTOR',
  ],
  '2eea7f106971cda783665a60eb4d0e25846dae46': [
    // MPC-BE's Inno QuietUninstallString uses only /SILENT and can wait behind
    // an invisible prompt in SYSTEM context. This release normalizes all Inno
    // registrations to the fully unattended, message-box-free switch set.
    'MPC-BE.MPC-BE',
    // Camera Hub starts its desktop process during install and its MSI removal
    // custom action waits for that process. The shared application adapter now
    // closes it before invoking the exact MSI product uninstall.
    'Elgato.CameraHub',
    // VSTO's visible External Installer entry contains a bare install.exe.
    // The shared application adapter now supplies its unattended removal
    // switches instead of accepting the helper's no-op exit code.
    'Microsoft.VSTOR',
  ],
  '2dca138ee2fe27dc45166dba536511aa80d8937e': [
    // EAUninstall.exe remains blocked while the EA client/background process
    // family owns the installation. This release closes those reviewed
    // processes before invoking the exact registered helper.
    'ElectronicArts.EADesktop',
  ],
  'e6a4ae2f4f9a3a672c6912ab8e309483f53003b7': [
    // EA Desktop registers a purpose-built EAUninstall.exe helper. This
    // release prefers that exact helper while retaining the packaged Burn
    // bootstrapper fallback for disposable cache registrations.
    'ElectronicArts.EADesktop',
  ],
  '2c40f49e2cb0b5a1f7a1c27996f5aee72553a074': [
    // Carry the multi-product runtime replay through the atomic rollout; it
    // was queued but had not run before the PostgreSQL family fix superseded it.
    'abbodi1406.vcredist',
    // EnterpriseDB PostgreSQL releases share the same BitRock uninstaller.
    // This release applies the reviewed unattended arguments to the family.
    'PostgreSQL.PostgreSQL.13',
  ],
  '670357c92fefa433036d8667dd5f382731d8326e': [
    // VisualCppRedist AIO deliberately creates many independently registered
    // shared runtimes. This release verifies that reviewed multi-product
    // evidence without weakening the ordinary one-product identity rule.
    'abbodi1406.vcredist',
  ],
  '7e83c363bcbafca153f00113b12ede2e332b2d2d': [
    // Qfinder Pro omitted its x86 Visual C++ runtime from the WinGet
    // manifest and left its launched process blocking NSIS removal. This
    // release corrects both paths in QA and customer packages.
    'QNAP.QfinderPro',
  ],
  '681b7510f7f30bec92c17581213c9ebc7f72765a': [
    // Opera's former /silent adapter was removed by the vendor. This release
    // switches both QA and customer packaging to --runimmediately.
    'Opera.Opera',
    // Greenshot never reached the VM because the pinned PSADT template download
    // was interrupted. The protected runner now has a verified persistent tool
    // cache, so carry that infrastructure error through one bounded replay.
    'Greenshot.Greenshot',
  ],
  '7d389dbd6e55b719e3d71772717cda0c8f724469': [
    // Opera's registered uninstaller is interactive unless /silent is added.
    // This release applies that reviewed lifecycle adapter to QA and customer
    // packages, so the exact failing version receives one bounded replay.
    'Opera.Opera',
    // These bounded retries were queued on the preceding release when this
    // pin superseded it. Carry them once so a toolchain rollout cannot discard
    // already-selected customer coverage work.
    'AnalogDevices.LTspice',
    'Autodesk.DesktopApp',
    'Granola.Granola',
    'Greenshot.Greenshot',
    'Makeblock.xToolStudio',
    'Microsoft.EdgeWebView2Runtime',
  ],
  '9ff409ddabd3b1b4f8c65ad03b1f9e37778589fc': [
    // One bounded replay is required after the QA runner learned to collect
    // PSADT logs from the active interactive-user profile. Granola's newer
    // user-scoped release failed without those diagnostics, while its prior
    // version passed through the same customer packaging path.
    'Granola.Granola',
    'Microsoft.EdgeWebView2Runtime',
  ],
  'f4bc37886e490ece525c701562869734a7e366d5': [
    'Microsoft.EdgeWebView2Runtime',
  ],
  '93321ef6f7abd287f0fd6f37e37c5f4c199f3c4e': [
    'AnalogDevices.LTspice',
    // The xTool retry was superseded while this release was deploying, so
    // carry it forward until it receives one bounded run on the new toolchain.
    'Makeblock.xToolStudio',
  ],
  'b3b2729bab6959a554c0e6d41af0a841d6177386': [
    'Makeblock.xToolStudio',
  ],
  '072dc26c5c25369bf01f265af5af17c47c0e50e5': [
    'Microsoft.SQLServerManagementStudio.21',
    'Microsoft.SQLServerManagementStudio.22',
    'Microsoft.SQLServerManagementStudio.22.Preview',
  ],
  'bbd8948f2bbefeaba9caf51f6e36ce5d26fdff35': [
    'Microsoft.SQLServerManagementStudio.22',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2019.BuildTools',
    'Microsoft.VisualStudio.2019.Community',
    'Microsoft.VisualStudio.2019.Enterprise',
    'Microsoft.VisualStudio.2019.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'Mozilla.Firefox.de',
  ],
  '1b130924ecc68909d6bb15f8cdf295944255a2f9': [
    'HandBrake.HandBrake',
    'Microsoft.VisualStudio.2019.Enterprise',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.WindowsApp',
    'PostgreSQL.PostgreSQL.18',
    'RARLab.WinRAR',
    'SoftwareOK.Q-Dir',
  ],
  '354756f01cb572cfd410f95dd6af5ab3a9cb8efb': [
    'Microsoft.VisualStudio.2019.Enterprise',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'PostgreSQL.PostgreSQL.18',
    'RARLab.WinRAR',
    'SoftwareOK.Q-Dir',
  ],
  'd9b55d1f1717bed2f1119347faf4984fed4eae53': [
    'Microsoft.VisualStudio.2019.Enterprise',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'PostgreSQL.PostgreSQL.18',
    'RARLab.WinRAR',
    'SoftwareOK.Q-Dir',
  ],
  'bafea79a8dde42be074c385c35b4887fb5833aa0': [
    'Oracle.VirtualBox',
  ],
  'acfe2d8692cc2b910281236ff47d3ee5b2ce2b99': [
    'Greenshot.Greenshot',
  ],
  'fc18fffd40f6d362be251e05e2bc784373dfc735': [
    'OCSInventoryNG.WindowsAgent',
  ],
  'ef75edee9fcabaf904bcf80e02ead9aa58490dc9': [
    'Google.Chrome',
    'Yealink.YealinkUSBConnect',
  ],
  '66448ea49841c2c9f3ebf56e455ce8797e2b2abb': ['Google.Chrome'],
  '430f817da1120f6a14f421b7016b628a06854aba': [
    'Adobe.CreativeCloud',
    'Elgato.StreamDeck',
    'Formlabs.PreForm',
  ],
  '99edd0a9f4b7e10d4cc4272f90d763f3bd681440': ['Figma.Figma'],
  'c1fe66c04b11f595bfaf4c9ca7cc1444186ea028': [
    'Figma.Figma',
    'HP.ImageAssistant',
    'Microsoft.Office',
  ],
  '42bf6e2af604a5e6bb44f2feff38e941ab2222c1': [
    'Adobe.CreativeCloud',
    'Elgato.StreamDeck',
  ],
  '404c9718a2c977722850bc9d70a02772a9bd1c7a': [
    // PDFsam's WinGet /quiet command stalled under LocalSystem. This release
    // replaces it with the vendor-documented managed MSI property set.
    'PDFsam.PDFsam',
  ],
  'd67ec022c5edcd89b8d84edb958b4f1c494da5b5': [
    // PDFsam's reviewed MSI command remains present in this cumulative
    // packager release, so preserve its still-unconsumed bounded retry.
    'PDFsam.PDFsam',
    // MEGAsync defaults silent NSIS installs to CurrentUser. This release
    // adds the vendor's /MULTIUSER switch for LocalSystem deployments.
    'Mega.MEGASync',
  ],
  'f7c3ed00118ada623d70503009d1f72a164f1d95': [
    // Preserve the still-unconsumed reviewed PDFsam and MEGAsync retries in
    // this cumulative packager release.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    // Link Controller's Inno uninstaller left its exact ARP key while the
    // tray/background process family was still active. This release closes
    // those reviewed processes through PSADT before vendor removal.
    'Insta360.Link.Controller',
  ],
  '0565fb456b7faf84cca56f2c988c99591015fe93': [
    // Preserve every still-unconsumed reviewed lifecycle retry in this
    // cumulative packager release.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    // SetPoint's NSIS removal left its ARP identity while the notification-area
    // client family was active. This release closes those reviewed processes
    // through PSADT before vendor removal.
    'Logitech.SetPoint',
  ],
  '77ed8d66246e8c7098f427e32d8488bc73f8eb3d': [
    // Preserve every still-unconsumed reviewed lifecycle retry in this
    // cumulative packager release.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    // Timely publishes `Memory` as a stable NSIS ProductCode. This release
    // binds that exact registry key so install verification and removal do not
    // depend on ambiguous display-name matching.
    'Timely.Memory',
  ],
  'c14531559086f83364ce69178369bf9462bcd872': [
    // Preserve every still-unconsumed reviewed lifecycle retry in this
    // cumulative packager release.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    // Google Drive launches its versioned uninstaller asynchronously. This
    // release appends Google's documented --silent --force_stop contract so
    // the exact ARP product is removed under non-interactive LocalSystem.
    'Google.GoogleDrive',
  ],
  '00fa68c7a24afe9db434cef87baa42455ed81fbb': [
    // Preserve every still-unconsumed reviewed lifecycle retry in this
    // cumulative packager release.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    // Dropbox's enterprise offline installer leaves the desktop process
    // running, which blocks its captured machine uninstaller. This release
    // closes the reviewed process through the shared PSADT lifecycle.
    'Dropbox.Dropbox',
  ],
  '20e762d9c48a90881d9901c93d3f84f2d9474654': [
    // Preserve every still-unconsumed reviewed lifecycle retry in this
    // cumulative packager release.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    // The previous Dropbox retry proved that closing the client alone is not
    // enough. This release installs without launching Dropbox and appends /S
    // to its captured machine uninstaller for a fully unattended lifecycle.
    'Dropbox.Dropbox',
  ],
  '719d7fd6db57ce5cbcecad528d53ae9c9088616f': [
    // Preserve every still-unconsumed reviewed lifecycle retry in this
    // cumulative packager release.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    // Partition Assistant can keep its Inno uninstaller interactive while
    // its desktop process is active. This release closes PartAssist through
    // PSADT and supplies the complete unattended Inno removal contract.
    'AOMEI.PartitionAssistant',
  ],
  '6db4e201f11e49bceb4d2729a2bc77fb0e675e89': [
    // Preserve every still-unconsumed reviewed lifecycle retry in this
    // cumulative packager release.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    // AOMEI uses /S rather than generic Inno switches. The exact reviewed
    // vendor command is now authoritative in QA and customer packages.
    'AOMEI.PartitionAssistant',
  ],
  '0c2765c26b69619df8f581190f4e67d97d79b589': [
    // Preserve every still-unconsumed reviewed lifecycle retry in this
    // cumulative packager release.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    // Preserve AOMEI's registered /SILENT argument under the exact reviewed
    // command guard after both generic Inno switches and /S proved no-ops.
    'AOMEI.PartitionAssistant',
  ],
  '461c2757292d3b7bcde33682d3f7b33e566b1fea': [
    // Preserve every still-unconsumed reviewed lifecycle retry in this
    // cumulative packager release.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    // AOMEI's exact vendor command now preserves /SILENT while suppressing
    // custom message boxes, restarts, and the startup prompt under SYSTEM.
    'AOMEI.PartitionAssistant',
  ],
  '02f93d590887282aca0037412c8786785ddc6486': [
    // Preserve every still-unconsumed reviewed lifecycle retry in this
    // cumulative packager release.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    // Horizon Client's registered Burn helper omitted restart suppression and
    // shut down the device during removal. The shared packager now guarantees
    // the complete unattended Burn lifecycle for QA and customer packages.
    'Omnissa.HorizonClient',
  ],
  'ca77e52dc65a404eb81679c5188378bf4d69a692': [
    // Preserve every still-unconsumed reviewed lifecycle retry in this
    // cumulative packager release.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Omnissa.HorizonClient',
    // Autodesk ODIS keeps working after its bootstrap process exits. These
    // releases wait for the exact managed executable and ODIS completion,
    // then use Autodesk's manifest-driven unattended uninstall lifecycle.
    'Autodesk.NavisworksFreedom.2026',
    'Autodesk.NavisworksFreedom.2027',
  ],
  '94c8f81e38ac180048f86dbf2df7f987fa448676': [
    // Preserve unresolved, customer-deployed lifecycle retries through the
    // cumulative rollout. Compatible passes are filtered before enqueue.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Omnissa.HorizonClient',
    // Ecosia's captured Chromium command omitted the switch that suppresses
    // confirmation UI. This release appends --force-uninstall for one retry.
    'Ecosia.EcosiaBrowser',
  ],
  'af4dfb94c9109ca598abc16a4b8cad57f6790066': [
    // Preserve every still-unconsumed reviewed lifecycle retry in this
    // cumulative packager release. Compatible passes are filtered before enqueue.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Omnissa.HorizonClient',
    // IntelliJ publishes a stable, versioned non-MSI ProductCode. Preserve it
    // as the exact ARP registry key for QA and customer package lifecycle.
    'JetBrains.IntelliJIDEA.Ultimate',
  ],
  '22b8e738d51a612f68b01c83b705d2dabc3bbcff': [
    // Preserve every still-unconsumed reviewed lifecycle retry in this
    // cumulative packager release. Compatible passes are filtered before enqueue.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    // install4j registers its canonical .install4j uninstaller without quiet
    // arguments. The shared packager now applies its documented unattended mode.
    'Ringler.SnapformViewer',
  ],
  'cc143c874f2e84f06097cb199ad9998344040ded': [
    // Preserve every still-unconsumed reviewed lifecycle retry in this
    // cumulative packager release. Compatible passes are filtered before enqueue.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    // These MSI packages registered an authoritative ProductCode while their
    // parsed executable uninstall path was empty. The shared packager now
    // reaches the MSI branch before attempting any EXE path normalization.
    'Cisco.Jabber',
    'IPEVO.Visualizer',
  ],
  '25682a8899466dbfe72403556e854d7335e1ae8f': [
    // Preserve every still-unconsumed reviewed lifecycle retry in this
    // cumulative packager release. Compatible passes are filtered before enqueue.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    // This MSI app appends the exact package version to its ARP display name.
    // The shared packager now captures that one observed, version-agreeing identity.
    'IPEVO.VisualizerLTSE',
  ],
  'cfc6f269e1a818dd4a61b95121268f6991f78642': [
    // Preserve every still-unconsumed reviewed lifecycle retry in this
    // cumulative packager release. Compatible passes are filtered before enqueue.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    // Sonos uses an InstallShield Basic MSI bootstrapper. The shared packager
    // now sends one quoted /v payload so the embedded MSI receives /qn and the
    // restart-suppression properties instead of returning MSI error 1619.
    'Sonos.Controller',
  ],
  '5569c16d136f464cbc014f40c70645414c601751': [
    // Preserve every still-unconsumed reviewed lifecycle retry in this
    // cumulative packager release. Compatible passes are filtered before enqueue.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    // .NET Framework has no single dependable ARP identity. This release
    // verifies Microsoft's documented Full\Release DWORD and retains the
    // shared Windows runtime when IntuneGet relinquishes its marker.
    'Microsoft.DotNet.Framework.Runtime',
  ],
  '7c63f08735a32d428068d9e7fd467830096250a1': [
    // Preserve every still-unconsumed reviewed lifecycle retry in this
    // cumulative packager release. Compatible passes are filtered before enqueue.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    // Sonos' native launcher cannot install silently as LocalSystem. This
    // release extracts its embedded MSI inside the target context, validates
    // its exact product identity, and installs it through PSADT.
    'Sonos.Controller',
  ],
  'e6dfe920d82e0b62c5d5e420fb603f61acdb5a42': [
    // Preserve every still-unconsumed reviewed lifecycle retry in this
    // cumulative packager release. Compatible passes are filtered before enqueue.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    // Retry Sonos with fully headless embedded-MSI extraction. The previous
    // /qb path stalled under LocalSystem before the MSI could be installed.
    'Sonos.Controller',
  ],
  '81ad189d7e51026bd15681264f774f498429f526': [
    // Preserve every still-unconsumed reviewed lifecycle retry in this
    // cumulative packager release. Compatible passes are filtered before enqueue.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    // Retry Sonos through the documented InstallShield administrative-image
    // path. The previous /x command entered uninstall mode on the current
    // launcher and returned Windows Installer error 1605.
    'Sonos.Controller',
  ],
  'f70f65692afddaf7b249cdacdcbacb356822f4f0': [
    // Preserve every still-unconsumed reviewed lifecycle retry in this
    // cumulative release. Compatible passes are filtered before enqueue.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    // Retry Snapform with root-level install4j uninstall.exe recognition and
    // the framework's documented unattended removal arguments.
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
  ],
  '4d9a1c9cae5383b6bf44f7501e4bb0dc157c7e3f': [
    // Preserve every still-unconsumed reviewed lifecycle retry across the
    // atomic pin change. Compatible passes are filtered before enqueue.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    // The registered DWG FastView setup command is interactive unless the
    // vendor's reviewed /silent /uninstall contract is appended. Retry the
    // exact failed version once through the shared QA/customer adapter.
    'Gstarsoft.DWGFastView',
  ],
  '02caa5a067569ad1d1e017fc6f52f3ee4e152120': [
    // Carry every unconsumed bounded lifecycle retry through the atomic pin
    // rollout. Compatible passes are removed before candidates are created.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    // Give the exact failed DWG FastView version one final bounded retry with
    // the current /s /uninstall shared QA/customer packaging adapter.
    'Gstarsoft.DWGFastView',
  ],
  '7870c214b74ac666b16573ac42cbc9e65a3848e2': [
    // Carry the still-unconsumed bounded lifecycle retries through the atomic
    // pin rollout. DWG FastView is intentionally absent because the shared
    // eligibility gate now blocks its unsupported managed uninstall.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
  ],
  '1467e138d1e6f5f0cee3d8cda6f981c4d44f6b8f': [
    // Carry every still-unconsumed bounded retry across the atomic pin
    // rollout. Compatible passes are filtered before candidates are created.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    // Visual Studio 2022 and newer install 64-bit instances below Program
    // Files. Retry terminal outcomes through the corrected shared adapter.
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
  ],
  '82958ac0c0b39e06af14a87b70319251604910f7': [
    // Carry still-unconsumed bounded retries across the atomic pin rollout.
    // Compatible passes are filtered before candidates are created.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    // Keep the Visual Studio retries bounded while correcting the 2022 Build
    // Tools exception back to its documented Program Files (x86) root.
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
  ],
  '11933b94c72275551a565bed7364ebb8616e4414': [
    // Carry still-unconsumed bounded retries across the atomic pin rollout.
    // Compatible passes are filtered before candidates are created.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    // Retry the exact failed OpenWebStart release once with install4j's
    // documented unattended removal arguments.
    'karakun.OpenWebStart',
  ],
  '0b562aa574144a19a6b4c5e6c3d3d7a4c241961f': [
    // Carry still-unconsumed bounded retries across the atomic pin rollout.
    // Compatible passes are filtered before candidates are created.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    // Retry the exact failed MSYS2 release once with its reviewed registration
    // identity and official Qt Installer Framework removal command.
    'MSYS2.MSYS2',
  ],
  'a48022baddf7b3f312541ef2e127220f508104a8': [
    // Carry still-unconsumed bounded retries across the atomic pin rollout.
    // Compatible passes are filtered before candidates are created.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    // Retry the preparation failure once with registry-owned path discovery
    // and the reviewed Qt Installer Framework removal arguments.
    'MSYS2.MSYS2',
  ],
  '91abb42cf1096de692500203fc7373ef6a25a3dd': [
    // Carry still-unconsumed bounded retries across the atomic pin rollout.
    // Compatible passes are filtered before candidates are created.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    // Retry only the failed Tor lifecycle with its reviewed exact extracted
    // user-folder verification and removal behavior.
    'TorProject.TorBrowser',
  ],
  'fec554c1bc7139ef1e7b489571a09f29760b06c0': [
    // Carry still-unconsumed bounded retries across the atomic pin rollout.
    // Compatible passes are filtered before candidates are created.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    // Retry the exact failed PTC payload once with the official MSI-forwarding
    // command now shared by QA and customer PSADT packages.
    'PTC.CreoView.Express',
  ],
  'fbb4aa2eed6cc545ec343373dd8947d04463a4a1': [
    // Carry still-unconsumed bounded retries across the atomic pin rollout.
    // Compatible passes are filtered before candidates are created.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    // Retry the exact PTC payload with the published main MSI ProductCode.
    'PTC.CreoView.Express',
  ],
  '71ee706fe545cdcd8667545eb65e8ba62d82208c': [
    // Carry still-unconsumed bounded retries across the atomic pin rollout.
    // Compatible passes are filtered before candidates are created.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    // Battle.net declares InstallLocationRequired. Retry its exact failed
    // payload with the inherited WinGet install-location contract.
    'Blizzard.BattleNet',
  ],
  'f426e369f2134ca5bb896170c9f7fd7e526c5916': [
    // Autodesk Licensing Service does not expose a product ARP identity. This
    // release verifies its dedicated service payload and uses Autodesk's
    // documented unattended uninstaller.
    'Autodesk.LicensingService',
    // Carry still-unconsumed bounded retries across the atomic pin rollout.
    // Compatible passes are filtered before candidates are created.
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  '16a626f329d93d1e499c1db30a243d9dc18a2aa6': [
    // Bria keeps its desktop client running in the notification area. This
    // release closes that reviewed process before invoking the MSI lifecycle.
    'Bria.Bria',
    // Carry still-unconsumed bounded retries across the atomic pin rollout.
    // Compatible passes are filtered before candidates are created.
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  'ca46c0860496e13b91842f7106f45505441dc44d': [
    // Retry only the failed PotPlayer payload with its reviewed all-users
    // NSIS install contract shared by QA and customer PSADT packages.
    'Daum.PotPlayer',
    // Carry still-unconsumed bounded retries across the atomic pin rollout.
    // Compatible passes and eligibility-blocked apps are filtered before
    // candidates are created.
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  'b2e26a6954cf32d1541c52a2bd663f0aaad5f0d8': [
    // Carry still-unconsumed bounded retries through the fail-closed plain-EXE
    // rollout. Compatible passes and eligibility-blocked apps are filtered
    // before candidates are created.
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  '9205d51e3c693afe7fdd385572f181c4739d91c5': [
    // Carry the still-unconsumed prior repair targets through the atomic pin
    // rollout; compatible passes and eligibility-blocked apps are filtered
    // upstream.
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  '78dfd1a4113805acbd03fe52ddfe6bc06d90544d': [
    // Carry still-unconsumed bounded targets; compatible passes and
    // eligibility-blocked apps are filtered upstream.
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  '77735e28d450c6b1c4f14a9a667bc5336eeeb3ea': [
    // Carry still-unconsumed bounded targets through the Acronis eligibility
    // release. The blocked Acronis package is intentionally absent and is
    // also filtered by the shared eligibility policy before enqueue.
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  '7a8401469e353172b652259e731aa505cf8067bd': [
    // Ubuntu completed provisioning but the old package emitted no log entry
    // while Windows servicing was active, so QA terminated it as stalled.
    // Retry it with the shared Appx provisioning heartbeat release.
    'Canonical.Ubuntu.2404',
    // Carry still-unconsumed bounded targets across the atomic pin rollout.
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  'c69410a6d1ab34e403b7ebb25519074acbe8952c': [
    // Logitech Presentation's signed NSIS bootstrapper raises an elevation
    // prompt in user context even with /S. Retry it with the reviewed
    // LocalSystem execution scope and Logitech's remote-deployment switches.
    'Logitech.Presentation',
    // Carry still-unconsumed bounded targets across the atomic pin rollout.
    // Compatible passes and ineligible apps are filtered before enqueue.
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  '6788c71df2ec0844f829b5abe0f5b154ca3abdb4': [
    // Visual Studio 2017 was omitted from the shared instance-aware adapter
    // and fell back to an ARP command that left the product registered. Retry
    // Enterprise through Microsoft's exact Visual Studio Installer lifecycle.
    'Microsoft.VisualStudio.2017.Enterprise',
    // BankID is a ZIP with a nested MSI whose exact ProductCode was present
    // in trusted manifest metadata but previously dropped from the canonical
    // uninstall identity. Retry it through the shared QA/customer generator.
    'FinancialID.BankID',
    // OpenOffice's Nullsoft bootstrapper installs an MSI whose ARP display
    // name appends a marketing version. Retry it with the exact requested
    // DisplayVersion and strict configured-name-prefix identity contract.
    'Apache.OpenOffice',
    // Arduino IDE's dual-purpose MSI defaults to per-user installation even
    // though WinGet declares this installer machine-scope. Retry it now that
    // the shared normalizer explicitly carries that scope into MSI arguments.
    'ArduinoSA.IDE.stable',
    // G HUB's evergreen bootstrapper can remain active without console output,
    // and its registered bare software-manager command does not remove the
    // product under LocalSystem. Retry the exact failed customer-requested
    // package with the corrected generated argument expression, observable
    // install, and full silent removal adapter.
    'Logitech.GHUB',
    // Carry still-unconsumed bounded targets across the atomic pin rollout.
    // Compatible passes and ineligible apps are filtered before enqueue.
    'Autodesk.AutodeskAccess',
    'CoreyButler.NVMforWindows',
    'Logitech.Presentation',
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  '7391c73a8eacb01becfc76682bfbb37b1d60b17f': [
    // darktable's CPack/NSIS installer extracted its payload but was
    // interrupted by the generic inactivity guard before final registration.
    // Retry it through the shared bounded wait with PSADT heartbeats.
    'darktable.darktable',
    // Carry still-unconsumed bounded targets across the atomic pin rollout.
    // Compatible passes and ineligible apps are filtered before enqueue.
    'Microsoft.VisualStudio.2017.Enterprise',
    'FinancialID.BankID',
    'Apache.OpenOffice',
    'ArduinoSA.IDE.stable',
    'Logitech.GHUB',
    'Autodesk.AutodeskAccess',
    'CoreyButler.NVMforWindows',
    'Logitech.Presentation',
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  '837c54ac684d6a3d36a0ad5f14f258f8add540cf': [
    // Autodesk Access registers the exact ODIS manifest removal command but
    // omits Autodesk's documented -q switch. Retry through the shared PSADT
    // packager now that the exact AdODIS signature is made unattended.
    'Autodesk.AutodeskAccess',
    // Carry still-unconsumed bounded targets across the atomic pin rollout.
    // Compatible passes and ineligible apps are filtered before enqueue.
    'CoreyButler.NVMforWindows',
    'Logitech.Presentation',
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  '81f443163ffb9f437be3901b44b6da74032032c4': [
    // NVM's official Inno setup requires administrative privileges despite
    // WinGet publishing it as user-scope. Retry it with the reviewed trusted-
    // byte selection, LocalSystem execution, and deterministic machine path.
    'CoreyButler.NVMforWindows',
    // Carry still-unconsumed bounded targets across the atomic pin rollout.
    // Compatible passes and ineligible apps are filtered before enqueue.
    'Logitech.Presentation',
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  '12831539c9dc30678c6f16367faab76820502d2a': [
    // CutePDF's registered unInstcpw helper requires its vendor-specific
    // /uninstall /s contract rather than the nested installer's Inno switches.
    'AcroSoftware.CutePDFWriter',
    // Carry still-unconsumed bounded retries across the atomic pin rollout.
    // Compatible passes are filtered before candidates are created.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  '6af0cfac18f3c4653a69a01f41bc1170c1237807': [
    // Carry still-unconsumed bounded retries across the atomic pin rollout.
    // Compatible passes are filtered before candidates are created.
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    // These registered vendor uninstallers are retried from a safe PSADT
    // working directory outside their own application trees.
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    // The installer executes from a version-shaped extensionless URL. Retry
    // once with the corrected executable filename in QA and customer packages.
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    // DATEV did not reach GitHub because the old 60-second Vercel function
    // window ended during exact installer preflight.
    'DATEV.SicherheitspaketCompact',
  ],
  '20546b8280874ba955b8d14182ad69bde8eacb58': [
    // Carry still-unconsumed bounded targets across the atomic pin rollout.
    // Compatible passes and ineligible apps are filtered before enqueue.
    'Microsoft.VisualStudio.2017.Enterprise',
    'FinancialID.BankID',
    'Apache.OpenOffice',
    'ArduinoSA.IDE.stable',
    'Logitech.GHUB',
    'Autodesk.AutodeskAccess',
    'CoreyButler.NVMforWindows',
    'Logitech.Presentation',
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  'b6254d8fdf1dd50ccc95fbb3e137a5ef5717cce5': [
    // ZeeDrive's MSI deliberately has no ARP registration. Retry its failed
    // lifecycle with the reviewed versioned Program Files contract.
    'Thinkscape.ZeeDrive',
    // Carry still-unconsumed bounded targets across the atomic pin rollout.
    // Compatible passes and ineligible apps are filtered before enqueue.
    'Microsoft.VisualStudio.2017.Enterprise',
    'FinancialID.BankID',
    'Apache.OpenOffice',
    'ArduinoSA.IDE.stable',
    'Logitech.GHUB',
    'Autodesk.AutodeskAccess',
    'CoreyButler.NVMforWindows',
    'Logitech.Presentation',
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  'ab045cb1da3611f91329943fade2263491bb211d': [
    // Docker's legacy Edge-channel catalog title differs from its exact ARP
    // identity. Retry the failed lifecycle through the shared adapter.
    'Docker.DockerDesktopEdge',
    // Carry still-unconsumed bounded targets across the atomic pin rollout.
    // Compatible passes and ineligible apps are filtered before enqueue.
    'Thinkscape.ZeeDrive',
    'Microsoft.VisualStudio.2017.Enterprise',
    'FinancialID.BankID',
    'Apache.OpenOffice',
    'ArduinoSA.IDE.stable',
    'Logitech.GHUB',
    'Autodesk.AutodeskAccess',
    'CoreyButler.NVMforWindows',
    'Logitech.Presentation',
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  '4918638adf111a664f2589ce79d8aefe79c33936': [
    // Podman Desktop's assisted NSIS installer defaults to the invoking user.
    // Retry the failed lifecycle with its reviewed all-users contract.
    'RedHat.Podman-Desktop',
    // Carry still-unconsumed bounded targets across the atomic pin rollout.
    // Compatible passes and ineligible apps are filtered before enqueue.
    'Docker.DockerDesktopEdge',
    'Thinkscape.ZeeDrive',
    'Microsoft.VisualStudio.2017.Enterprise',
    'FinancialID.BankID',
    'Apache.OpenOffice',
    'ArduinoSA.IDE.stable',
    'Logitech.GHUB',
    'Autodesk.AutodeskAccess',
    'CoreyButler.NVMforWindows',
    'Logitech.Presentation',
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  'b42fb5d02883b199e057c466a2cd9a7b86d994d9': [
    // RMS Client's Burn child can remove its exact registration shortly after
    // the parent exits. Retry with the reviewed bounded completion window.
    'Microsoft.RMSClient',
    // Movavi installs and registers successfully before its signed NSIS
    // launcher returns 1223. Retry with the evidence-guarded success code.
    'Movavi.MovaviPhotoFocus',
    // Carry still-unconsumed bounded targets across the atomic pin rollout.
    // Compatible passes and ineligible apps are filtered before enqueue.
    'RedHat.Podman-Desktop',
    'Docker.DockerDesktopEdge',
    'Thinkscape.ZeeDrive',
    'Microsoft.VisualStudio.2017.Enterprise',
    'FinancialID.BankID',
    'Apache.OpenOffice',
    'ArduinoSA.IDE.stable',
    'Logitech.GHUB',
    'Autodesk.AutodeskAccess',
    'CoreyButler.NVMforWindows',
    'Logitech.Presentation',
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  '4bc4126f8991da9facd520d0bc213a7dd3ebbf5c': [
    // Retry the two failure paths corrected by this protected release.
    'Microsoft.RMSClient',
    'SoftwareOK.DesktopOK',
    // Movavi already passed on the preceding pin; compatibility filtering
    // prevents a duplicate while retaining it if reconciliation lagged.
    'Movavi.MovaviPhotoFocus',
    // Carry still-unconsumed bounded targets across the atomic pin rollout.
    'RedHat.Podman-Desktop',
    'Docker.DockerDesktopEdge',
    'Thinkscape.ZeeDrive',
    'Microsoft.VisualStudio.2017.Enterprise',
    'FinancialID.BankID',
    'Apache.OpenOffice',
    'ArduinoSA.IDE.stable',
    'Logitech.GHUB',
    'Autodesk.AutodeskAccess',
    'CoreyButler.NVMforWindows',
    'Logitech.Presentation',
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  'f79b14647328d39bca04dada822a07f70573aa49': [
    // Retry the two package-scope lifecycles corrected by this release.
    'SoftwareOK.DesktopOK',
    'AvaCC.AvaDesktop',
    // Compatibility filtering skips these completed validations while retaining
    // their retry intent if reconciliation has not yet recorded the pass.
    'Microsoft.RMSClient',
    'Movavi.MovaviPhotoFocus',
    // Carry still-unconsumed bounded targets across the atomic pin rollout.
    'RedHat.Podman-Desktop',
    'Docker.DockerDesktopEdge',
    'Thinkscape.ZeeDrive',
    'Microsoft.VisualStudio.2017.Enterprise',
    'FinancialID.BankID',
    'Apache.OpenOffice',
    'ArduinoSA.IDE.stable',
    'Logitech.GHUB',
    'Autodesk.AutodeskAccess',
    'CoreyButler.NVMforWindows',
    'Logitech.Presentation',
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  '31faef7cae75613243bc36c9bb0af38c88761437': [
    // Retry FSLogix with its reviewed Microsoft bundle display identity.
    'Microsoft.FSLogix',
    // Carry every still-unconsumed bounded target across the atomic pin.
    'SoftwareOK.DesktopOK',
    'AvaCC.AvaDesktop',
    'Microsoft.RMSClient',
    'Movavi.MovaviPhotoFocus',
    'RedHat.Podman-Desktop',
    'Docker.DockerDesktopEdge',
    'Thinkscape.ZeeDrive',
    'Microsoft.VisualStudio.2017.Enterprise',
    'FinancialID.BankID',
    'Apache.OpenOffice',
    'ArduinoSA.IDE.stable',
    'Logitech.GHUB',
    'Autodesk.AutodeskAccess',
    'CoreyButler.NVMforWindows',
    'Logitech.Presentation',
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  'bd61ef8e81dac8b16289a4a572022d4d1702b333': [
    // Retry FSLogix with nested-EXE wrapper identity disambiguation enabled.
    'Microsoft.FSLogix',
    // Carry every still-unconsumed bounded target across the atomic pin.
    'SoftwareOK.DesktopOK',
    'AvaCC.AvaDesktop',
    'Microsoft.RMSClient',
    'Movavi.MovaviPhotoFocus',
    'RedHat.Podman-Desktop',
    'Docker.DockerDesktopEdge',
    'Thinkscape.ZeeDrive',
    'Microsoft.VisualStudio.2017.Enterprise',
    'FinancialID.BankID',
    'Apache.OpenOffice',
    'ArduinoSA.IDE.stable',
    'Logitech.GHUB',
    'Autodesk.AutodeskAccess',
    'CoreyButler.NVMforWindows',
    'Logitech.Presentation',
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  '9aaebb8f2af8bf3144fb5358b8b34e99195c088e': [
    // Retry the exact customer profile whose saved marker root was omitted
    // from PSADT generation, causing post-install detection to fail.
    '8x8.Work',
    // Carry every still-unconsumed bounded target across the atomic pin.
    'Microsoft.FSLogix',
    'SoftwareOK.DesktopOK',
    'AvaCC.AvaDesktop',
    'Microsoft.RMSClient',
    'Movavi.MovaviPhotoFocus',
    'RedHat.Podman-Desktop',
    'Docker.DockerDesktopEdge',
    'Thinkscape.ZeeDrive',
    'Microsoft.VisualStudio.2017.Enterprise',
    'FinancialID.BankID',
    'Apache.OpenOffice',
    'ArduinoSA.IDE.stable',
    'Logitech.GHUB',
    'Autodesk.AutodeskAccess',
    'CoreyButler.NVMforWindows',
    'Logitech.Presentation',
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  'b29b7b930651b6b0d98eb5985ced7ee191550a3c': [
    // Retry Speek only after its reviewed non-ARP managed-directory lifecycle
    // is active for both QA and customer packaging.
    'Speek.Speek',
    // Carry every still-unconsumed bounded target across the atomic pin.
    '8x8.Work',
    'Microsoft.FSLogix',
    'SoftwareOK.DesktopOK',
    'AvaCC.AvaDesktop',
    'Microsoft.RMSClient',
    'Movavi.MovaviPhotoFocus',
    'RedHat.Podman-Desktop',
    'Docker.DockerDesktopEdge',
    'Thinkscape.ZeeDrive',
    'Microsoft.VisualStudio.2017.Enterprise',
    'FinancialID.BankID',
    'Apache.OpenOffice',
    'ArduinoSA.IDE.stable',
    'Logitech.GHUB',
    'Autodesk.AutodeskAccess',
    'CoreyButler.NVMforWindows',
    'Logitech.Presentation',
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  'd7293535636c41b795088f4d265e4e085445a05c': [
    // Retry BlueJ with the explicit Windows Installer 5 per-user context.
    'BlueJTeam.BlueJ',
    // Carry every still-unconsumed bounded target across the atomic pin.
    'Logitech.LogiBolt',
    'Wiris.MathType.7',
    'Microsoft.AzureMonitorAgent',
    'Speek.Speek',
    '8x8.Work',
    'Microsoft.FSLogix',
    'SoftwareOK.DesktopOK',
    'AvaCC.AvaDesktop',
    'Microsoft.RMSClient',
    'Movavi.MovaviPhotoFocus',
    'RedHat.Podman-Desktop',
    'Docker.DockerDesktopEdge',
    'Thinkscape.ZeeDrive',
    'Microsoft.VisualStudio.2017.Enterprise',
    'FinancialID.BankID',
    'Apache.OpenOffice',
    'ArduinoSA.IDE.stable',
    'Logitech.GHUB',
    'Autodesk.AutodeskAccess',
    'CoreyButler.NVMforWindows',
    'Logitech.Presentation',
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  '0ad6cdec44cd8ec47ce12c9ae59487f2fa9dda52': [
    // Retry BlueJ with its explicit user-writable MSI install directory.
    'BlueJTeam.BlueJ',
    // Carry every still-unconsumed bounded target across the atomic pin.
    'Logitech.LogiBolt',
    'Wiris.MathType.7',
    'Microsoft.AzureMonitorAgent',
    'Speek.Speek',
    '8x8.Work',
    'Microsoft.FSLogix',
    'SoftwareOK.DesktopOK',
    'AvaCC.AvaDesktop',
    'Microsoft.RMSClient',
    'Movavi.MovaviPhotoFocus',
    'RedHat.Podman-Desktop',
    'Docker.DockerDesktopEdge',
    'Thinkscape.ZeeDrive',
    'Microsoft.VisualStudio.2017.Enterprise',
    'FinancialID.BankID',
    'Apache.OpenOffice',
    'ArduinoSA.IDE.stable',
    'Logitech.GHUB',
    'Autodesk.AutodeskAccess',
    'CoreyButler.NVMforWindows',
    'Logitech.Presentation',
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  'f91af4469ba113dac1524f8764c4a03d535eb188': [
    // Retry the terminal BlueJ install path changed by this release.
    'BlueJTeam.BlueJ',
    // Carry every still-unconsumed bounded target across the atomic pin.
    'Logitech.LogiBolt',
    'Wiris.MathType.7',
    'Microsoft.AzureMonitorAgent',
    'Speek.Speek',
    '8x8.Work',
    'Microsoft.FSLogix',
    'SoftwareOK.DesktopOK',
    'AvaCC.AvaDesktop',
    'Microsoft.RMSClient',
    'Movavi.MovaviPhotoFocus',
    'RedHat.Podman-Desktop',
    'Docker.DockerDesktopEdge',
    'Thinkscape.ZeeDrive',
    'Microsoft.VisualStudio.2017.Enterprise',
    'FinancialID.BankID',
    'Apache.OpenOffice',
    'ArduinoSA.IDE.stable',
    'Logitech.GHUB',
    'Autodesk.AutodeskAccess',
    'CoreyButler.NVMforWindows',
    'Logitech.Presentation',
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  '8ed88e9a9889fec478235b1623e313f9fd86bd59': [
    // Retry the terminal Logi Bolt path changed by this release.
    'Logitech.LogiBolt',
    // Carry every still-unconsumed bounded target across the atomic pin.
    'Wiris.MathType.7',
    'Microsoft.AzureMonitorAgent',
    'Speek.Speek',
    '8x8.Work',
    'Microsoft.FSLogix',
    'SoftwareOK.DesktopOK',
    'AvaCC.AvaDesktop',
    'Microsoft.RMSClient',
    'Movavi.MovaviPhotoFocus',
    'RedHat.Podman-Desktop',
    'Docker.DockerDesktopEdge',
    'Thinkscape.ZeeDrive',
    'Microsoft.VisualStudio.2017.Enterprise',
    'FinancialID.BankID',
    'Apache.OpenOffice',
    'ArduinoSA.IDE.stable',
    'Logitech.GHUB',
    'Autodesk.AutodeskAccess',
    'CoreyButler.NVMforWindows',
    'Logitech.Presentation',
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
  'f5d7258e504f10679f54f025cebf11bfe9584221': [
    // Retry only the two terminal uninstall paths changed by this release.
    'Wiris.MathType.7',
    'Microsoft.AzureMonitorAgent',
    // Carry every still-unconsumed bounded target across the atomic pin.
    'Speek.Speek',
    '8x8.Work',
    'Microsoft.FSLogix',
    'SoftwareOK.DesktopOK',
    'AvaCC.AvaDesktop',
    'Microsoft.RMSClient',
    'Movavi.MovaviPhotoFocus',
    'RedHat.Podman-Desktop',
    'Docker.DockerDesktopEdge',
    'Thinkscape.ZeeDrive',
    'Microsoft.VisualStudio.2017.Enterprise',
    'FinancialID.BankID',
    'Apache.OpenOffice',
    'ArduinoSA.IDE.stable',
    'Logitech.GHUB',
    'Autodesk.AutodeskAccess',
    'CoreyButler.NVMforWindows',
    'Logitech.Presentation',
    'Canonical.Ubuntu.2404',
    'Daum.PotPlayer',
    'Autodesk.LicensingService',
    'AcroSoftware.CutePDFWriter',
    'PDFsam.PDFsam',
    'Mega.MEGASync',
    'Insta360.Link.Controller',
    'Logitech.SetPoint',
    'Timely.Memory',
    'Google.GoogleDrive',
    'Dropbox.Dropbox',
    'AOMEI.PartitionAssistant',
    'Ringler.SnapformViewer',
    'Cisco.Jabber',
    'IPEVO.Visualizer',
    'IPEVO.VisualizerLTSE',
    'Sonos.Controller',
    'Microsoft.VisualStudio.BuildTools',
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'karakun.OpenWebStart',
    'MSYS2.MSYS2',
    'TorProject.TorBrowser',
    'PTC.CreoView.Express',
    'Blizzard.BattleNet',
    'DATEV.SicherheitspaketCompact',
  ],
};

export function terminalToolchainRetryTargets(packagerCommit: string): string[] {
  return [...(TOOLCHAIN_TERMINAL_RETRY_TARGETS[packagerCommit] || [])];
}

export function shouldRetryTerminalToolchainCandidate(
  packagerCommit: string,
  candidate: Pick<QaToolchainBackfillCandidate, 'wingetId' | 'status'>
): boolean {
  if (!['failed', 'error'].includes(candidate.status)) return true;
  const normalizedWingetId = candidate.wingetId.trim().toLowerCase();
  return (TOOLCHAIN_TERMINAL_RETRY_TARGETS[packagerCommit] || []).some(
    (wingetId) => wingetId.toLowerCase() === normalizedWingetId
  );
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function prioritizeToolchainBackfill(
  candidates: QaToolchainBackfillCandidate[]
): string[] {
  return [...candidates]
    .sort((left, right) => {
      const leftFailureRank = left.status === 'failed' ? 0 : left.status === 'error' ? 1 : 2;
      const rightFailureRank = right.status === 'failed' ? 0 : right.status === 'error' ? 1 : 2;
      if (leftFailureRank !== rightFailureRank) return leftFailureRank - rightFailureRank;
      if (left.priority !== right.priority) return right.priority - left.priority;
      return timestamp(right.enqueuedAt) - timestamp(left.enqueuedAt);
    })
    .map((candidate) => candidate.wingetId);
}
