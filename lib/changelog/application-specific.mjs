// Packaging, detection, removal, quarantine and availability fixes for a single
// catalog application are routine catalog maintenance, not product announcements.
// This module is shared by the publication validator (scripts/publish-changelog.mjs)
// and the in-app changelog feed (lib/product-changelog.ts) so both agree on what an
// application-specific entry looks like. Keep it dependency free.

export const applicationSpecificTitle = [
  /\b\d+(?:\.\d+){2,}\b/, // a specific release such as 1.0.124; 2.0 or 1.5 MB may describe the product
  /\b(?:unattended|silent|managed)\b.*\b(?:removal|uninstall)\b/i,
  /\bpackage (?:detection|identity|removal)\b/i,
  /\bdeployment availability\b/i,
  /\bremoval$/i, // catalog maintenance titles end with the operation, such as "More reliable PostgreSQL removal"
];

export const applicationSpecificSummary = [
  /\b\d+(?:\.\d+){2,}\b/, // a specific release such as 1.0.124
  /\bunavailable for automated deployment\b/i,
];

export function isApplicationSpecific(entry) {
  return applicationSpecificTitle.some((pattern) => pattern.test(entry.title)) ||
    applicationSpecificSummary.some((pattern) => pattern.test(entry.summary));
}
