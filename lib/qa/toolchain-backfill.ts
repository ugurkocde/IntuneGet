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
