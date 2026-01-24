/**
 * Feature flags for IntuneGet
 * Controls optional functionality based on configuration
 */

import { getAppConfig } from "./config";

export interface FeatureFlags {
  /** Analytics tracking enabled (Plausible) */
  analytics: boolean;

  /** Newsletter subscription enabled (Beehiiv) */
  newsletter: boolean;

  /** Packaging pipeline enabled (GitHub Actions or local packager) */
  pipeline: boolean;

  /** Local packager mode enabled (true self-hosting without GitHub Actions) */
  localPackager: boolean;

  /** Site password protection enabled */
  sitePassword: boolean;
}

/**
 * Get current feature flags based on environment configuration
 */
export function getFeatureFlags(): FeatureFlags {
  const config = getAppConfig();

  const localPackager = config.packager.mode === "local";
  const githubPipeline = Boolean(config.github.pat && config.github.owner && config.github.repo);

  return {
    analytics: config.analytics.enabled,
    newsletter: config.newsletter.enabled,
    // Pipeline is enabled if either GitHub Actions or local packager is configured
    pipeline: localPackager || githubPipeline,
    localPackager,
    sitePassword: Boolean(config.app.sitePassword),
  };
}

/**
 * Check if a specific feature is enabled
 */
export function isFeatureEnabled(feature: keyof FeatureFlags): boolean {
  const flags = getFeatureFlags();
  return flags[feature];
}

/**
 * Client-side feature flags (safe to expose)
 * Only includes features detectable from public env vars
 */
export function getClientFeatureFlags(): Pick<FeatureFlags, "analytics" | "newsletter"> {
  return {
    analytics: Boolean(process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN),
    newsletter: true, // Always show newsletter UI, API will handle if not configured
  };
}
