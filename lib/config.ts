/**
 * Centralized configuration management for IntuneGet
 * Supports both hosted and self-hosted deployment modes
 */

export interface AppConfig {
  // Deployment mode
  mode: "hosted" | "self-hosted";

  // Database configuration (for true self-hosting)
  database: {
    mode: "sqlite" | "supabase";
    path?: string; // SQLite database file path
  };

  // Packager API authentication (for self-hosted SQLite mode)
  packagerAuth: {
    apiKey?: string;
  };

  // Supabase services (optional in SQLite mode)
  supabase: {
    url: string;
    anonKey: string;
    serviceRoleKey?: string;
  };

  azure: {
    clientId: string;
    clientSecret?: string;
  };

  github: {
    pat?: string;
    owner?: string;
    repo?: string;
    workflowsRepo?: string; // Private repo for GitHub Actions workflows
  };

  // Packager configuration (for true self-hosting)
  packager: {
    mode: "github" | "local";
  };

  // Application settings
  app: {
    url: string;
    callbackSecret?: string;
  };

  // Optional services
  analytics: {
    enabled: boolean;
    plausibleDomain?: string;
  };

  newsletter: {
    enabled: boolean;
    beehiivApiKey?: string;
  };
}

function getEnvVar(key: string, required: boolean = false): string | undefined {
  const value = process.env[key];
  if (required && !value) {
    console.warn(`Missing required environment variable: ${key}`);
  }
  return value;
}

function determineDeploymentMode(): "hosted" | "self-hosted" {
  // Check if running on Vercel (hosted)
  if (process.env.VERCEL === "1") {
    return "hosted";
  }

  // Check for explicit mode setting
  if (process.env.DEPLOYMENT_MODE === "hosted") {
    return "hosted";
  }

  // Default to self-hosted
  return "self-hosted";
}

export function getConfig(): AppConfig {
  const mode = determineDeploymentMode();
  const databaseMode = (getEnvVar("DATABASE_MODE")?.toLowerCase() as "sqlite" | "supabase") || "supabase";

  // In SQLite mode, Supabase credentials are optional
  const requireSupabase = databaseMode !== "sqlite";

  return {
    mode,

    database: {
      mode: databaseMode,
      path: getEnvVar("DATABASE_PATH"),
    },

    packagerAuth: {
      apiKey: getEnvVar("PACKAGER_API_KEY"),
    },

    supabase: {
      url: getEnvVar("NEXT_PUBLIC_SUPABASE_URL", requireSupabase) || "",
      anonKey: getEnvVar("NEXT_PUBLIC_SUPABASE_ANON_KEY", requireSupabase) || "",
      serviceRoleKey: getEnvVar("SUPABASE_SERVICE_ROLE_KEY"),
    },

    azure: {
      clientId: getEnvVar("NEXT_PUBLIC_AZURE_AD_CLIENT_ID", true) || "",
      clientSecret: getEnvVar("AZURE_CLIENT_SECRET") || getEnvVar("AZURE_AD_CLIENT_SECRET"),
    },

    github: {
      pat: getEnvVar("GITHUB_PAT"),
      owner: getEnvVar("GITHUB_OWNER"),
      repo: getEnvVar("GITHUB_REPO"),
      workflowsRepo: getEnvVar("GITHUB_WORKFLOWS_REPO"),
    },

    packager: {
      mode: (getEnvVar("PACKAGER_MODE") as "github" | "local") || "github",
    },

    app: {
      url: getEnvVar("NEXT_PUBLIC_URL") || "http://localhost:3000",
      callbackSecret: getEnvVar("CALLBACK_SECRET"),
    },

    analytics: {
      enabled: Boolean(getEnvVar("NEXT_PUBLIC_PLAUSIBLE_DOMAIN")),
      plausibleDomain: getEnvVar("NEXT_PUBLIC_PLAUSIBLE_DOMAIN"),
    },

    newsletter: {
      enabled: Boolean(getEnvVar("BEEHIIV_API_KEY")),
      beehiivApiKey: getEnvVar("BEEHIIV_API_KEY"),
    },
  };
}

/**
 * Validates configuration and returns any issues
 */
export function validateConfig(config: AppConfig): string[] {
  const issues: string[] = [];

  // Database validation based on mode
  if (config.database.mode === "sqlite") {
    // SQLite mode - Supabase is optional
    if (config.packager.mode === "local" && !config.packagerAuth.apiKey) {
      issues.push("PACKAGER_API_KEY is required for local packager mode with SQLite");
    }
  } else {
    // Supabase mode - Supabase credentials required
    if (!config.supabase.url) {
      issues.push("NEXT_PUBLIC_SUPABASE_URL is required");
    }
    if (!config.supabase.anonKey) {
      issues.push("NEXT_PUBLIC_SUPABASE_ANON_KEY is required");
    }
  }

  // Required: Azure AD
  if (!config.azure.clientId) {
    issues.push("NEXT_PUBLIC_AZURE_AD_CLIENT_ID is required");
  }

  // Pipeline configuration validation
  if (config.packager.mode === "github") {
    if (!config.github.pat) {
      issues.push("GITHUB_PAT is not set - GitHub Actions packaging will not work");
    }
    if (!config.github.workflowsRepo) {
      issues.push("GITHUB_WORKFLOWS_REPO is not set - GitHub Actions packaging will not work");
    }
  } else if (config.packager.mode === "local") {
    // In local packager mode, need either PACKAGER_API_KEY (SQLite) or service role key (Supabase)
    if (config.database.mode === "supabase" && !config.supabase.serviceRoleKey) {
      issues.push("SUPABASE_SERVICE_ROLE_KEY is required for local packager mode with Supabase");
    }
    if (config.database.mode === "sqlite" && !config.packagerAuth.apiKey) {
      issues.push("PACKAGER_API_KEY is required for local packager mode with SQLite");
    }
  }

  return issues;
}

// Singleton config instance
let configInstance: AppConfig | null = null;

export function getAppConfig(): AppConfig {
  if (!configInstance) {
    configInstance = getConfig();
  }
  return configInstance;
}
