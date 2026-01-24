/**
 * Configuration management for the packager service
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from './logger.js';

const logger = createLogger('Config');

export interface PackagerConfig {
  // Unique identifier for this packager instance
  packagerId: string;

  // Communication mode: 'supabase' (direct DB) or 'api' (HTTP API)
  mode: 'supabase' | 'api';

  // Supabase connection (required for supabase mode)
  supabase: {
    url: string;
    serviceRoleKey: string;
  };

  // API connection (required for api mode)
  api?: {
    url: string;
    key: string;
  };

  // Azure AD / Microsoft Entra ID
  azure: {
    clientId: string;
    clientSecret: string;
    tenantId?: string; // Optional default tenant
  };

  // Polling configuration
  polling: {
    interval: number; // milliseconds
    staleJobTimeout: number; // milliseconds
  };

  // Paths
  paths: {
    work: string; // Working directory for packages
    tools: string; // Tools directory (IntuneWinAppUtil, PSADT)
  };
}

function getEnvVar(key: string, required: boolean = false): string | undefined {
  const value = process.env[key];
  if (required && !value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function generatePackagerId(): string {
  const hostname = process.env.COMPUTERNAME || process.env.HOSTNAME || 'unknown';
  const shortId = uuidv4().split('-')[0];
  return `${hostname}-${shortId}`;
}

export function loadConfig(): PackagerConfig {
  // Load .env file if it exists
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    logger.debug('Loaded .env file', { path: envPath });
  }

  // Also try .env.local
  const envLocalPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envLocalPath)) {
    dotenv.config({ path: envLocalPath });
    logger.debug('Loaded .env.local file', { path: envLocalPath });
  }

  // Determine communication mode based on available config
  // If INTUNEGET_API_URL is set, use API mode; otherwise use Supabase mode
  const apiUrl = getEnvVar('INTUNEGET_API_URL');
  const apiKey = getEnvVar('PACKAGER_API_KEY');
  const mode: 'supabase' | 'api' = (apiUrl && apiKey) ? 'api' : 'supabase';

  // In Supabase mode, require Supabase credentials
  const requireSupabase = mode === 'supabase';

  const config: PackagerConfig = {
    packagerId: getEnvVar('PACKAGER_ID') || generatePackagerId(),

    mode,

    supabase: {
      url: getEnvVar('SUPABASE_URL', requireSupabase) || '',
      serviceRoleKey: getEnvVar('SUPABASE_SERVICE_ROLE_KEY', requireSupabase) || '',
    },

    api: mode === 'api' ? {
      url: apiUrl!,
      key: apiKey!,
    } : undefined,

    azure: {
      clientId: getEnvVar('AZURE_CLIENT_ID', true)!,
      clientSecret: getEnvVar('AZURE_CLIENT_SECRET', true)!,
      tenantId: getEnvVar('AZURE_TENANT_ID'),
    },

    polling: {
      interval: parseInt(getEnvVar('POLL_INTERVAL') || '5000', 10),
      staleJobTimeout: parseInt(getEnvVar('STALE_JOB_TIMEOUT') || '300000', 10), // 5 minutes
    },

    paths: {
      work: getEnvVar('WORK_DIR') || path.resolve(process.cwd(), 'work'),
      tools: getEnvVar('TOOLS_DIR') || path.resolve(process.cwd(), 'tools'),
    },
  };

  return config;
}

export function validateConfig(config: PackagerConfig): string[] {
  const issues: string[] = [];

  // Validate mode-specific settings
  if (config.mode === 'supabase') {
    if (!config.supabase.url || !config.supabase.url.startsWith('https://')) {
      issues.push('SUPABASE_URL must be a valid HTTPS URL');
    }
    if (!config.supabase.serviceRoleKey) {
      issues.push('SUPABASE_SERVICE_ROLE_KEY is required for Supabase mode');
    }
  } else if (config.mode === 'api') {
    if (!config.api?.url) {
      issues.push('INTUNEGET_API_URL is required for API mode');
    }
    if (!config.api?.key) {
      issues.push('PACKAGER_API_KEY is required for API mode');
    }
  }

  // Validate Azure
  if (!config.azure.clientId.match(/^[0-9a-f-]{36}$/i)) {
    issues.push('AZURE_CLIENT_ID must be a valid GUID');
  }

  // Validate polling
  if (config.polling.interval < 1000) {
    issues.push('POLL_INTERVAL must be at least 1000ms');
  }

  return issues;
}

export function printConfig(config: PackagerConfig): void {
  logger.info('Packager configuration:');
  logger.info(`  Packager ID: ${config.packagerId}`);
  logger.info(`  Communication Mode: ${config.mode}`);

  if (config.mode === 'supabase') {
    logger.info(`  Supabase URL: ${config.supabase.url}`);
  } else {
    logger.info(`  API URL: ${config.api?.url}`);
  }

  logger.info(`  Azure Client ID: ${config.azure.clientId}`);
  logger.info(`  Poll Interval: ${config.polling.interval}ms`);
  logger.info(`  Stale Job Timeout: ${config.polling.staleJobTimeout}ms`);
  logger.info(`  Work Directory: ${config.paths.work}`);
  logger.info(`  Tools Directory: ${config.paths.tools}`);
}
