/**
 * Supabase Client Configuration
 * Server and client-side Supabase clients
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

// Environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Type for the Supabase client - using generic to allow flexibility
// until proper types are generated from the actual database
type SupabaseClientType = SupabaseClient<Database>;

// Lazy initialization to avoid build errors when env vars aren't set
let _supabase: SupabaseClientType | null = null;

// Client-side Supabase client (uses anon key with RLS)
export function getSupabaseClient(): SupabaseClientType {
  if (!_supabase) {
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Supabase URL and anon key are required');
    }
    _supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    });
  }
  return _supabase;
}

// For backwards compatibility - lazy getter
export const supabase = new Proxy({} as SupabaseClientType, {
  get(_, prop) {
    return Reflect.get(getSupabaseClient(), prop);
  },
});

// Server-side Supabase client (uses service role key, bypasses RLS)
export function createServerClient(): SupabaseClientType {
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Supabase URL and service role key are required for server-side operations');
  }

  return createClient<Database>(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

// Check if Supabase is configured
export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

// Helper to get current user
export async function getCurrentUser() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    console.error('Error getting user:', error);
    return null;
  }

  return user;
}

// Helper to get user profile with Microsoft tokens
export async function getUserProfile(userId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('user_profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) {
    console.error('Error getting user profile:', error);
    return null;
  }

  return data;
}

// Helper to update Microsoft tokens
export async function updateMicrosoftTokens(
  userId: string,
  accessToken: string,
  refreshToken: string,
  expiresAt: Date,
  tenantId?: string
) {
  const serverClient = createServerClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (serverClient as any).from('user_profiles').upsert({
    id: userId,
    microsoft_access_token: accessToken,
    microsoft_refresh_token: refreshToken,
    token_expires_at: expiresAt.toISOString(),
    intune_tenant_id: tenantId,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    console.error('Error updating Microsoft tokens:', error);
    throw error;
  }
}

// Helper to create a staged package
export async function createStagedPackage(
  userId: string,
  packageData: {
    wingetId: string;
    displayName: string;
    publisher: string;
    version: string;
    architecture: string;
    installScope: string;
    installerType: string;
    installerUrl: string;
    installerSha256: string;
    installCommand: string;
    uninstallCommand: string;
    detectionRules: unknown;
  }
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('staged_packages')
    .insert({
      user_id: userId,
      winget_id: packageData.wingetId,
      display_name: packageData.displayName,
      publisher: packageData.publisher,
      version: packageData.version,
      architecture: packageData.architecture,
      install_scope: packageData.installScope,
      installer_type: packageData.installerType,
      installer_url: packageData.installerUrl,
      installer_sha256: packageData.installerSha256,
      install_command: packageData.installCommand,
      uninstall_command: packageData.uninstallCommand,
      detection_rules: packageData.detectionRules,
      status: 'pending',
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating staged package:', error);
    throw error;
  }

  return data;
}

// Helper to create an upload job
export async function createUploadJob(userId: string, stagedPackageId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('upload_jobs')
    .insert({
      user_id: userId,
      staged_package_id: stagedPackageId,
      status: 'queued',
      progress_percent: 0,
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating upload job:', error);
    throw error;
  }

  return data;
}

// Helper to update upload job status
export async function updateUploadJobStatus(
  jobId: string,
  status: string,
  progress?: number,
  additionalData?: {
    intuneAppId?: string;
    intuneAppUrl?: string;
    errorMessage?: string;
  }
) {
  const updateData: Record<string, unknown> = {
    status,
    ...(progress !== undefined && { progress_percent: progress }),
    ...additionalData,
  };

  if (status === 'completed' || status === 'failed') {
    updateData.completed_at = new Date().toISOString();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('upload_jobs')
    .update(updateData)
    .eq('id', jobId);

  if (error) {
    console.error('Error updating upload job:', error);
    throw error;
  }
}

// Helper to get user's upload jobs
export async function getUserUploadJobs(userId: string, limit: number = 50) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('upload_jobs')
    .select(
      `
      *,
      staged_packages (
        winget_id,
        display_name,
        publisher,
        version,
        architecture
      )
    `
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Error getting upload jobs:', error);
    throw error;
  }

  return data;
}

// Helper to get app metadata (curated configurations)
export async function getAppMetadata(wingetId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('app_metadata')
    .select('*')
    .eq('winget_id', wingetId)
    .single();

  if (error && error.code !== 'PGRST116') {
    // Ignore "not found" errors
    console.error('Error getting app metadata:', error);
    return null;
  }

  return data;
}
