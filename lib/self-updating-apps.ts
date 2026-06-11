/**
 * Apps that keep themselves up to date on the device and must not be offered
 * as updates by IntuneGet.
 *
 * Microsoft 365 Apps for enterprise updates itself through Click-to-Run
 * channels; the winget version is only the setup bootstrapper build, which
 * bumps near-weekly. Repackaging it changes nothing on devices and the app
 * would show as permanently outdated. Extend this list only for apps whose
 * installed product updates itself regardless of the deployed package.
 */
const SELF_UPDATING_WINGET_IDS = new Set(['microsoft.office']);

export function isSelfUpdatingApp(wingetId: string): boolean {
  return SELF_UPDATING_WINGET_IDS.has(wingetId.toLowerCase());
}
