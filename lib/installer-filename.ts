import type { WingetInstallerType } from '@/types/winget';

function getDefaultExtension(installerType?: WingetInstallerType): string {
  switch (installerType) {
    case 'msi':
    case 'wix':
      return '.msi';
    case 'msix':
      return '.msix';
    case 'appx':
      return '.appx';
    case 'zip':
      return '.zip';
    case 'exe':
    case 'inno':
    case 'nullsoft':
    case 'burn':
    case 'portable':
      return '.exe';
    case 'pwa':
      return '.msix';
    default:
      return '.exe';
  }
}

export function resolveInstallerFileName(
  url: string,
  installerType?: WingetInstallerType
): string {
  const fallback = `installer${getDefaultExtension(installerType)}`;
  const knownInstallerExtension = /\.(?:exe|msi|msix|msixbundle|appx|appxbundle|zip)$/i;

  try {
    const urlObj = new URL(url);
    const rawFileName = urlObj.pathname.split('/').pop();
    const fileName = rawFileName ? decodeURIComponent(rawFileName).trim() : '';

    if (!fileName) {
      return fallback;
    }

    // A version-shaped URL such as /26.7.174 has a dotted numeric suffix but
    // no executable extension. Only preserve extensions that Windows package
    // handling supports; otherwise append the type-specific extension.
    if (knownInstallerExtension.test(fileName)) {
      return fileName;
    }

    return `${fileName}${getDefaultExtension(installerType)}`;
  } catch {
    return fallback;
  }
}
