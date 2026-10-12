import type { PSADTConfig } from '@/types/psadt';

/** Apply verified execution defaults while retaining presentation choices. */
export function testedCuratedSettings(defaults: PSADTConfig, requested: PSADTConfig): PSADTConfig {
  const config = structuredClone(defaults);
  for (const key of ['brandingCompanyName', 'brandingWelcomeTitle', 'brandingWelcomeMessage', 'brandingAccentColor',
    'brandingLogoPath', 'brandingLogoDarkPath', 'brandingBannerPath', 'windowLocation'] as const) {
    if (key in requested) Object.assign(config, { [key]: requested[key] });
  }
  config.progressDialog = { ...config.progressDialog,
    statusMessage: requested.progressDialog?.statusMessage,
    windowLocation: requested.progressDialog?.windowLocation };
  return config;
}
