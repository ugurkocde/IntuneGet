/**
 * MSP (Managed Service Provider) Types
 * Types for managing multiple customer Intune tenants
 */

// ============================================
// Database Entity Types
// ============================================

/**
 * MSP Organization - represents an MSP company
 */
export interface MspOrganization {
  id: string;
  name: string;
  slug: string;
  primary_tenant_id: string;
  created_by_user_id: string;
  created_by_email: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Input for creating a new MSP organization
 */
export interface MspOrganizationCreate {
  name: string;
  slug?: string;
}

/**
 * Organization statistics from the view
 */
export interface MspOrganizationStats {
  organization_id: string;
  organization_name: string;
  slug: string;
  is_active: boolean;
  total_tenants: number;
  active_tenants: number;
  pending_tenants: number;
  total_members: number;
  total_jobs: number;
  completed_jobs: number;
  created_at: string;
  updated_at: string;
}

/**
 * Consent status for a managed tenant
 */
export type ConsentStatus = 'pending' | 'granted' | 'revoked';

/**
 * MSP Managed Tenant - a customer tenant managed by the MSP
 */
export interface MspManagedTenant {
  id: string;
  msp_organization_id: string;
  tenant_id: string | null;
  tenant_name: string | null;
  display_name: string;
  consent_status: ConsentStatus;
  consent_granted_at: string | null;
  consented_by_email: string | null;
  added_by_user_id: string;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Input for adding a new managed tenant
 */
export interface MspManagedTenantCreate {
  display_name: string;
  notes?: string;
}

/**
 * Managed tenant with computed stats
 */
export interface MspManagedTenantWithStats extends MspManagedTenant {
  total_jobs?: number;
  completed_jobs?: number;
  failed_jobs?: number;
  last_job_at?: string | null;
}

/**
 * MSP User Membership - a user belonging to an MSP organization
 */
export interface MspUserMembership {
  id: string;
  msp_organization_id: string;
  user_id: string;
  user_email: string;
  user_name: string | null;
  user_tenant_id: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================
// API Request/Response Types
// ============================================

/**
 * Response from GET /api/msp/organization
 */
export interface GetOrganizationResponse {
  organization: MspOrganization | null;
  stats: MspOrganizationStats | null;
  isMspUser: boolean;
}

/**
 * Request body for POST /api/msp/organization
 */
export interface CreateOrganizationRequest {
  name: string;
  slug?: string;
}

/**
 * Response from POST /api/msp/organization
 */
export interface CreateOrganizationResponse {
  organization: MspOrganization;
  membership: MspUserMembership;
}

/**
 * Response from GET /api/msp/tenants
 */
export interface GetTenantsResponse {
  tenants: MspManagedTenantWithStats[];
}

/**
 * Request body for POST /api/msp/tenants
 */
export interface AddTenantRequest {
  display_name: string;
  notes?: string;
}

/**
 * Response from POST /api/msp/tenants
 */
export interface AddTenantResponse {
  tenant: MspManagedTenant;
  consentUrl: string;
}

/**
 * Request body for DELETE /api/msp/tenants
 */
export interface RemoveTenantRequest {
  tenantId: string;
}

/**
 * Response from the consent callback
 */
export interface ConsentCallbackResponse {
  success: boolean;
  tenant?: MspManagedTenant;
  error?: string;
}

/**
 * Response from GET /api/msp/jobs
 */
export interface GetMspJobsResponse {
  jobs: MspJob[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/**
 * A packaging job with tenant context
 */
export interface MspJob {
  id: string;
  tenant_id: string;
  tenant_display_name: string;
  winget_id: string;
  display_name: string;
  publisher: string | null;
  version: string;
  status: string;
  status_message: string | null;
  progress_percent: number;
  error_message: string | null;
  intune_app_id: string | null;
  intune_app_url: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

// ============================================
// React Context Types
// ============================================

/**
 * State shape for the MSP context
 */
export interface MspContextState {
  // Organization
  organization: MspOrganization | null;
  stats: MspOrganizationStats | null;
  isMspUser: boolean;
  isLoadingOrganization: boolean;

  // Managed tenants
  managedTenants: MspManagedTenantWithStats[];
  isLoadingTenants: boolean;

  // Selected tenant for operations
  selectedTenantId: string | null;
  selectedTenant: MspManagedTenantWithStats | null;
}

/**
 * Actions available in the MSP context
 */
export interface MspContextActions {
  // Organization actions
  refreshOrganization: () => Promise<void>;
  createOrganization: (data: CreateOrganizationRequest) => Promise<MspOrganization>;

  // Tenant actions
  refreshTenants: () => Promise<void>;
  addTenant: (data: AddTenantRequest) => Promise<AddTenantResponse>;
  removeTenant: (tenantRecordId: string) => Promise<void>;

  // Selection actions
  selectTenant: (tenantId: string | null) => void;
  clearSelection: () => void;
}

/**
 * Combined context value
 */
export interface MspContextValue extends MspContextState, MspContextActions {}

// ============================================
// UI Component Props Types
// ============================================

/**
 * Props for TenantSwitcher component
 */
export interface TenantSwitcherProps {
  className?: string;
}

/**
 * Props for TenantCard component
 */
export interface TenantCardProps {
  tenant: MspManagedTenantWithStats;
  onSelect?: (tenantId: string) => void;
  onRemove?: (tenantId: string) => void;
  isSelected?: boolean;
}

/**
 * Props for AddTenantFlow component
 */
export interface AddTenantFlowProps {
  onComplete?: (tenant: MspManagedTenant) => void;
  onCancel?: () => void;
}

/**
 * Props for ConsentUrlGenerator component
 */
export interface ConsentUrlGeneratorProps {
  tenantRecordId: string;
  consentUrl: string;
  onClose?: () => void;
}

/**
 * Props for CrossTenantJobsTable component
 */
export interface CrossTenantJobsTableProps {
  jobs?: MspJob[];
  isLoading?: boolean;
  onRefresh?: () => void;
}

/**
 * Props for MspStatsOverview component
 */
export interface MspStatsOverviewProps {
  stats: MspOrganizationStats | null;
  isLoading?: boolean;
}

// ============================================
// Utility Types
// ============================================

/**
 * Helper to convert URL slug
 */
export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
}

/**
 * Check if a tenant has active consent
 */
export function isTenantActive(tenant: MspManagedTenant): boolean {
  return tenant.is_active && tenant.consent_status === 'granted' && !!tenant.tenant_id;
}

/**
 * Get consent status display text
 */
export function getConsentStatusDisplay(status: ConsentStatus): string {
  switch (status) {
    case 'pending':
      return 'Pending Consent';
    case 'granted':
      return 'Active';
    case 'revoked':
      return 'Consent Revoked';
    default:
      return 'Unknown';
  }
}

/**
 * Get consent status color class
 */
export function getConsentStatusColor(status: ConsentStatus): string {
  switch (status) {
    case 'pending':
      return 'text-yellow-500';
    case 'granted':
      return 'text-green-500';
    case 'revoked':
      return 'text-red-500';
    default:
      return 'text-zinc-500';
  }
}
