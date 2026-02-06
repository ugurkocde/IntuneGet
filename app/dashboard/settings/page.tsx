'use client';

import { useState, useCallback } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import {
  User,
  Building2,
  Shield,
  CheckCircle2,
  ExternalLink,
  Loader2,
  HelpCircle,
  XCircle,
  Bell,
  FileDown,
  Database,
  Settings,
  Copy,
  Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { PageHeader } from '@/components/dashboard';
import { NotificationSettings } from '@/components/settings/NotificationSettings';
import { WebhookManager } from '@/components/settings/WebhookManager';
import { cn } from '@/lib/utils';

type SettingsTab = 'general' | 'permissions' | 'notifications' | 'exports' | 'data';

interface PermissionStatusState {
  checked: boolean;
  checking: boolean;
  lastChecked?: Date;
  permissions: {
    deviceManagementApps: boolean | null;
    userRead: boolean | null;
    groupRead: boolean | null;
    deviceManagementManagedDevices: boolean | null;
  };
}

const SETTINGS_TABS: Array<{
  id: SettingsTab;
  label: string;
  icon: typeof Settings;
  description: string;
}> = [
  { id: 'general', label: 'General', icon: User, description: 'Account and connection' },
  { id: 'permissions', label: 'Permissions', icon: Shield, description: 'API access control' },
  { id: 'notifications', label: 'Notifications', icon: Bell, description: 'Email and webhooks' },
  { id: 'exports', label: 'Export', icon: FileDown, description: 'Export preferences' },
  { id: 'data', label: 'Data', icon: Database, description: 'Data management' },
];

export default function SettingsPage() {
  const { user, getAccessToken, requestAdminConsent } = useMicrosoftAuth();
  const prefersReducedMotion = useReducedMotion();
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [isChecking, setIsChecking] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatusState | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const handleCheckPermissions = async () => {
    setIsChecking(true);
    setPermissionStatus(prev => prev ? { ...prev, checking: true } : null);

    try {
      const token = await getAccessToken();
      if (!token) {
        setPermissionStatus({
          checked: true,
          checking: false,
          lastChecked: new Date(),
          permissions: {
            deviceManagementApps: null,
            userRead: null,
            groupRead: null,
            deviceManagementManagedDevices: null,
          },
        });
        return;
      }

      const response = await fetch('/api/auth/verify-consent', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      const result = await response.json();

      setPermissionStatus({
        checked: true,
        checking: false,
        lastChecked: new Date(),
        permissions: {
          deviceManagementApps: result.permissions?.deviceManagementApps ?? (result.verified ? true : null),
          userRead: result.permissions?.userRead ?? true,
          groupRead: result.permissions?.groupRead ?? null,
          deviceManagementManagedDevices: result.permissions?.deviceManagementManagedDevices ?? null,
        },
      });
    } catch (error) {
      console.error('Error checking permissions:', error);
      setPermissionStatus({
        checked: true,
        checking: false,
        lastChecked: new Date(),
        permissions: {
          deviceManagementApps: null,
          userRead: null,
          groupRead: null,
          deviceManagementManagedDevices: null,
        },
      });
    } finally {
      setIsChecking(false);
    }
  };

  const handleGrantConsent = () => {
    requestAdminConsent();
  };

  const copyToClipboard = useCallback((text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  }, []);

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: prefersReducedMotion ? {} : {
        staggerChildren: 0.08,
        delayChildren: 0.05
      }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: prefersReducedMotion ? 0 : 16 },
    visible: {
      opacity: 1,
      y: 0,
      transition: prefersReducedMotion ? { duration: 0.2 } : {
        duration: 0.45,
        ease: [0.25, 0.46, 0.45, 0.94] as const
      }
    }
  };

  const panelVariants = {
    hidden: { opacity: 0, x: prefersReducedMotion ? 0 : 12 },
    visible: {
      opacity: 1,
      x: 0,
      transition: prefersReducedMotion ? { duration: 0.15 } : {
        duration: 0.35,
        ease: [0.25, 0.46, 0.45, 0.94] as const
      }
    },
    exit: {
      opacity: 0,
      x: prefersReducedMotion ? 0 : -12,
      transition: { duration: 0.2 }
    }
  };

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Settings"
        description="Manage your account, permissions, and preferences"
        icon={Settings}
        gradient
        gradientColors="mixed"
      />

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Vertical tab navigation */}
        <motion.nav
          initial={{ opacity: 0, x: prefersReducedMotion ? 0 : -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={prefersReducedMotion ? { duration: 0.2 } : { duration: 0.4 }}
          className="lg:w-56 flex-shrink-0"
        >
          <div className="glass-light rounded-xl border border-black/5 p-2 lg:sticky lg:top-24">
            {/* Mobile: horizontal scroll, Desktop: vertical stack */}
            <div className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible pb-1 lg:pb-0 -mx-1 px-1 lg:mx-0 lg:px-0">
              {SETTINGS_TABS.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all relative flex-shrink-0',
                      'lg:w-full',
                      isActive
                        ? 'bg-accent-cyan/10 text-accent-cyan'
                        : 'text-text-secondary hover:text-text-primary hover:bg-black/[0.03]'
                    )}
                  >
                    {isActive && (
                      <motion.div
                        layoutId="settings-tab-indicator"
                        className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-accent-cyan rounded-full hidden lg:block"
                        transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                      />
                    )}
                    <Icon className={cn(
                      'w-4 h-4 flex-shrink-0',
                      isActive ? 'text-accent-cyan' : 'text-text-muted'
                    )} />
                    <div className="min-w-0">
                      <p className={cn(
                        'text-sm font-medium whitespace-nowrap',
                        isActive && 'text-accent-cyan'
                      )}>
                        {tab.label}
                      </p>
                      <p className="text-xs text-text-muted hidden lg:block truncate">
                        {tab.description}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </motion.nav>

        {/* Content area */}
        <div className="flex-1 min-w-0">
          <AnimatePresence mode="wait">
            {activeTab === 'general' && (
              <motion.div
                key="general"
                variants={panelVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
              >
                <motion.div
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  className="space-y-6"
                >
                  {/* Account card */}
                  <motion.section
                    variants={itemVariants}
                    className="glass-light rounded-xl p-6 border border-black/5 hover:border-accent-cyan/20 transition-colors"
                  >
                    <div className="flex items-center gap-3 mb-6">
                      <div className="w-10 h-10 rounded-lg bg-accent-cyan/10 flex items-center justify-center">
                        <User className="w-5 h-5 text-accent-cyan" />
                      </div>
                      <div>
                        <h2 className="text-lg font-semibold text-text-primary">Account</h2>
                        <p className="text-sm text-text-muted">Your profile information</p>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <SettingRow label="Name" value={user?.name || 'Not provided'} />
                      <SettingRow label="Email" value={user?.email || 'Not provided'} />
                      <SettingRow
                        label="Authentication Provider"
                        value="Microsoft Entra ID"
                        noBorder
                      />
                    </div>
                  </motion.section>

                  {/* Intune connection card */}
                  <motion.section
                    variants={itemVariants}
                    className="glass-light rounded-xl p-6 border border-black/5 hover:border-accent-violet/20 transition-colors"
                  >
                    <div className="flex items-center gap-3 mb-6">
                      <div className="w-10 h-10 rounded-lg bg-accent-violet/10 flex items-center justify-center">
                        <Building2 className="w-5 h-5 text-accent-violet" />
                      </div>
                      <div>
                        <h2 className="text-lg font-semibold text-text-primary">Intune Connection</h2>
                        <p className="text-sm text-text-muted">Tenant configuration and status</p>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center justify-between py-3 border-b border-black/5">
                        <div>
                          <p className="text-text-secondary text-sm">Status</p>
                          <div className="flex items-center gap-2 mt-1">
                            <div className="w-2 h-2 rounded-full bg-status-success animate-pulse" />
                            <p className="text-status-success font-medium text-sm">Connected</p>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between py-3 border-b border-black/5">
                        <div>
                          <p className="text-text-secondary text-sm">Tenant ID</p>
                          <p className="text-text-primary mt-0.5 font-mono text-sm">
                            {user?.tenantId || 'Not available'}
                          </p>
                        </div>
                        {user?.tenantId && (
                          <button
                            onClick={() => copyToClipboard(user.tenantId!, 'tenantId')}
                            className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-black/5 transition-colors"
                            title="Copy Tenant ID"
                          >
                            {copiedField === 'tenantId' ? (
                              <Check className="w-4 h-4 text-status-success" />
                            ) : (
                              <Copy className="w-4 h-4" />
                            )}
                          </button>
                        )}
                      </div>

                      <div className="flex items-center justify-between py-3">
                        <div>
                          <p className="text-text-secondary text-sm">Intune Portal</p>
                          <a
                            href="https://intune.microsoft.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 text-accent-cyan hover:text-accent-cyan-bright transition-colors mt-1 text-sm"
                          >
                            Open Intune Portal
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      </div>
                    </div>
                  </motion.section>
                </motion.div>
              </motion.div>
            )}

            {activeTab === 'permissions' && (
              <motion.div
                key="permissions"
                variants={panelVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
              >
                <motion.div
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  className="space-y-6"
                >
                  <motion.section
                    variants={itemVariants}
                    className="glass-light rounded-xl p-6 border border-black/5"
                  >
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 sm:gap-0 mb-6">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-accent-cyan/10 flex items-center justify-center">
                          <Shield className="w-5 h-5 text-accent-cyan" />
                        </div>
                        <div>
                          <h2 className="text-lg font-semibold text-text-primary">API Permissions</h2>
                          <p className="text-sm text-text-muted">Required Microsoft Graph permissions</p>
                        </div>
                      </div>
                      <Button
                        onClick={handleCheckPermissions}
                        disabled={isChecking}
                        variant="outline"
                        size="sm"
                        className="border-black/10 hover:border-accent-cyan/50 w-full sm:w-auto"
                      >
                        {isChecking ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <Shield className="w-4 h-4 mr-2" />
                        )}
                        {isChecking ? 'Checking...' : 'Check Permissions'}
                      </Button>
                    </div>

                    <p className="text-text-secondary text-sm mb-4">
                      IntuneGet requires the following permissions to deploy applications:
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <PermissionItem
                        name="DeviceManagementApps.ReadWrite.All"
                        description="Read and write Intune applications"
                        granted={permissionStatus?.permissions.deviceManagementApps ?? null}
                        checking={isChecking}
                      />
                      <PermissionItem
                        name="DeviceManagementManagedDevices.Read.All"
                        description="Read discovered apps from managed devices"
                        granted={permissionStatus?.permissions.deviceManagementManagedDevices ?? null}
                        checking={isChecking}
                      />
                      <PermissionItem
                        name="User.Read"
                        description="Read your profile information"
                        granted={permissionStatus?.permissions.userRead ?? null}
                        checking={isChecking}
                      />
                      <PermissionItem
                        name="Group.Read.All"
                        description="Read group memberships for app assignment"
                        granted={permissionStatus?.permissions.groupRead ?? null}
                        checking={isChecking}
                      />
                    </div>

                    {permissionStatus?.lastChecked && (
                      <p className="text-xs text-text-muted mt-3">
                        Last checked: {permissionStatus.lastChecked.toLocaleString()}
                      </p>
                    )}

                    {permissionStatus?.permissions.deviceManagementApps === false && (
                      <div className="mt-4 p-3 bg-status-warning/10 border border-status-warning/20 rounded-lg">
                        <p className="text-sm text-status-warning mb-2">
                          Intune permission is missing. A Global Administrator needs to re-grant consent.
                        </p>
                        <Button
                          onClick={handleGrantConsent}
                          size="sm"
                          className="bg-status-warning hover:bg-status-warning/90 text-white"
                        >
                          Re-grant Admin Consent
                        </Button>
                      </div>
                    )}

                    {permissionStatus?.permissions.deviceManagementManagedDevices === false && (
                      <div className="mt-4 p-3 bg-status-warning/10 border border-status-warning/20 rounded-lg">
                        <p className="text-sm text-status-warning mb-2">
                          Discovered Apps permission is missing. The Discovered Apps feature requires this permission. A Global Administrator needs to re-grant consent.
                        </p>
                        <Button
                          onClick={handleGrantConsent}
                          size="sm"
                          className="bg-status-warning hover:bg-status-warning/90 text-white"
                        >
                          Re-grant Admin Consent
                        </Button>
                      </div>
                    )}

                    <div className="mt-6 p-4 bg-bg-surface rounded-lg border border-black/5">
                      <p className="text-text-secondary text-sm">
                        To modify permissions, visit your{' '}
                        <a
                          href="https://portal.azure.com/#view/Microsoft_AAD_IAM/StartboardApplicationsMenuBlade/~/AppAppsPreview"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent-cyan hover:text-accent-cyan-bright transition-colors font-medium"
                        >
                          Entra ID Enterprise Applications
                        </a>{' '}
                        page.
                      </p>
                    </div>
                  </motion.section>
                </motion.div>
              </motion.div>
            )}

            {activeTab === 'notifications' && (
              <motion.div
                key="notifications"
                variants={panelVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
              >
                <motion.div
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  className="space-y-6"
                >
                  <motion.div variants={itemVariants}>
                    <NotificationSettings />
                  </motion.div>
                  <motion.div variants={itemVariants}>
                    <WebhookManager />
                  </motion.div>
                </motion.div>
              </motion.div>
            )}

            {activeTab === 'exports' && (
              <motion.div
                key="exports"
                variants={panelVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
              >
                <motion.div
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  className="space-y-6"
                >
                  <motion.section
                    variants={itemVariants}
                    className="glass-light rounded-xl p-6 border border-black/5"
                  >
                    <div className="flex items-center gap-3 mb-6">
                      <div className="w-10 h-10 rounded-lg bg-accent-cyan/10 flex items-center justify-center">
                        <FileDown className="w-5 h-5 text-accent-cyan" />
                      </div>
                      <div>
                        <h2 className="text-lg font-semibold text-text-primary">Export Preferences</h2>
                        <p className="text-sm text-text-muted">Configure default export settings</p>
                      </div>
                    </div>

                    <ExportPreferencesSection />
                  </motion.section>
                </motion.div>
              </motion.div>
            )}

            {activeTab === 'data' && (
              <motion.div
                key="data"
                variants={panelVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
              >
                <motion.div
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  className="space-y-6"
                >
                  <motion.section
                    variants={itemVariants}
                    className="glass-light rounded-xl p-6 border border-black/5"
                  >
                    <div className="flex items-center gap-3 mb-6">
                      <div className="w-10 h-10 rounded-lg bg-accent-violet/10 flex items-center justify-center">
                        <Database className="w-5 h-5 text-accent-violet" />
                      </div>
                      <div>
                        <h2 className="text-lg font-semibold text-text-primary">Data Management</h2>
                        <p className="text-sm text-text-muted">Cache, sync, and storage settings</p>
                      </div>
                    </div>

                    <DataManagementSection />
                  </motion.section>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

/* ─── Sub-components ─── */

function SettingRow({
  label,
  value,
  mono,
  noBorder,
}: {
  label: string;
  value: string;
  mono?: boolean;
  noBorder?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between py-3',
        !noBorder && 'border-b border-black/5'
      )}
    >
      <div>
        <p className="text-text-secondary text-sm">{label}</p>
        <p className={cn('text-text-primary mt-0.5', mono && 'font-mono text-sm')}>
          {value}
        </p>
      </div>
    </div>
  );
}

function PermissionItem({
  name,
  description,
  granted,
  checking,
}: {
  name: string;
  description: string;
  granted: boolean | null;
  checking?: boolean;
}) {
  const renderIcon = () => {
    if (checking) {
      return <Loader2 className="w-5 h-5 text-text-secondary flex-shrink-0 mt-0.5 animate-spin" />;
    }
    if (granted === true) {
      return <CheckCircle2 className="w-5 h-5 text-status-success flex-shrink-0 mt-0.5" />;
    }
    if (granted === false) {
      return <XCircle className="w-5 h-5 text-status-error flex-shrink-0 mt-0.5" />;
    }
    return <HelpCircle className="w-5 h-5 text-text-muted flex-shrink-0 mt-0.5" />;
  };

  const renderStatus = () => {
    if (checking) {
      return <span className="text-text-secondary text-xs ml-2">Checking...</span>;
    }
    if (granted === true) {
      return <span className="text-status-success text-xs ml-2">Granted</span>;
    }
    if (granted === false) {
      return <span className="text-status-error text-xs ml-2">Missing</span>;
    }
    return <span className="text-text-muted text-xs ml-2">Not checked</span>;
  };

  return (
    <div className={cn(
      "flex items-start gap-3 p-4 bg-bg-elevated rounded-lg border transition-colors",
      granted === false
        ? "border-status-error/30 hover:border-status-error/50"
        : "border-black/5 hover:border-black/10"
    )}>
      {renderIcon()}
      <div className="flex-1 min-w-0">
        <div className="flex items-center flex-wrap gap-1">
          <p className="text-text-primary font-mono text-xs">{name}</p>
          {renderStatus()}
        </div>
        <p className="text-text-muted text-sm mt-0.5">{description}</p>
      </div>
    </div>
  );
}

function ExportPreferencesSection() {
  const [exportFormat, setExportFormat] = useState<'csv' | 'json' | 'xlsx'>('csv');
  const [includeIcons, setIncludeIcons] = useState(true);
  const [includeMetadata, setIncludeMetadata] = useState(true);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Format selection */}
      <div>
        <p className="text-text-primary font-medium mb-2">Default Export Format</p>
        <div className="flex gap-2">
          {(['csv', 'json', 'xlsx'] as const).map((format) => (
            <button
              key={format}
              onClick={() => setExportFormat(format)}
              className={cn(
                'px-4 py-2 rounded-lg border text-sm transition-all uppercase tracking-wide',
                exportFormat === format
                  ? 'bg-accent-cyan/10 border-accent-cyan/50 text-accent-cyan font-medium'
                  : 'bg-bg-elevated border-black/10 text-text-secondary hover:border-black/20'
              )}
            >
              {format}
            </button>
          ))}
        </div>
        <p className="text-xs text-text-muted mt-2">
          {exportFormat === 'csv' && 'Comma-separated values, compatible with Excel and Google Sheets'}
          {exportFormat === 'json' && 'Structured JSON format, ideal for programmatic processing'}
          {exportFormat === 'xlsx' && 'Native Excel format with formatting and multiple sheets'}
        </p>
      </div>

      {/* Include icons toggle */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-text-primary font-medium">Include Application Icons</p>
          <p className="text-sm text-text-secondary">Embed base64-encoded icons in export files</p>
        </div>
        <ToggleSwitch
          checked={includeIcons}
          onChange={setIncludeIcons}
        />
      </div>

      {/* Include metadata toggle */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-text-primary font-medium">Include Metadata</p>
          <p className="text-sm text-text-secondary">Add deployment dates, version history, and assignment info</p>
        </div>
        <ToggleSwitch
          checked={includeMetadata}
          onChange={setIncludeMetadata}
        />
      </div>

      <div className="pt-2">
        <Button
          onClick={handleSave}
          className="bg-accent-cyan hover:bg-accent-cyan-bright text-white"
        >
          {saved ? (
            <>
              <CheckCircle2 className="w-4 h-4 mr-2" />
              Saved
            </>
          ) : (
            'Save Preferences'
          )}
        </Button>
      </div>
    </div>
  );
}

function DataManagementSection() {
  const [isClearing, setIsClearing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);

  const handleClearCache = async () => {
    setIsClearing(true);
    // Simulate cache clearing
    await new Promise(resolve => setTimeout(resolve, 1500));
    setIsClearing(false);
  };

  const handleForceSync = async () => {
    setIsSyncing(true);
    // Simulate sync
    await new Promise(resolve => setTimeout(resolve, 2000));
    setLastSync(new Date().toLocaleString());
    setIsSyncing(false);
  };

  return (
    <div className="space-y-6">
      {/* Cache management */}
      <div className="p-4 bg-bg-elevated rounded-lg border border-black/5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-text-primary font-medium">Application Cache</p>
            <p className="text-sm text-text-secondary">
              Cached application data speeds up loading times
            </p>
          </div>
          <Button
            onClick={handleClearCache}
            disabled={isClearing}
            variant="outline"
            size="sm"
            className="border-black/10 hover:border-accent-cyan/50"
          >
            {isClearing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Clearing...
              </>
            ) : (
              'Clear Cache'
            )}
          </Button>
        </div>
      </div>

      {/* Force sync */}
      <div className="p-4 bg-bg-elevated rounded-lg border border-black/5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-text-primary font-medium">Force Sync</p>
            <p className="text-sm text-text-secondary">
              Re-fetch all application data from Intune
            </p>
            {lastSync && (
              <p className="text-xs text-text-muted mt-1">Last synced: {lastSync}</p>
            )}
          </div>
          <Button
            onClick={handleForceSync}
            disabled={isSyncing}
            variant="outline"
            size="sm"
            className="border-black/10 hover:border-accent-cyan/50"
          >
            {isSyncing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Syncing...
              </>
            ) : (
              'Sync Now'
            )}
          </Button>
        </div>
      </div>

      {/* Auto-refresh interval */}
      <div>
        <p className="text-text-primary font-medium mb-2">Auto-Refresh Interval</p>
        <p className="text-sm text-text-secondary mb-3">
          How often IntuneGet checks for new application data
        </p>
        <AutoRefreshSelector />
      </div>

      {/* Storage info */}
      <div className="p-4 bg-bg-surface rounded-lg border border-black/5">
        <p className="text-text-secondary text-sm">
          All application data is stored locally in your browser. No data is sent to
          third-party servers. To delete all stored data, clear your browser cache or
          use the Clear Cache option above.
        </p>
      </div>
    </div>
  );
}

function AutoRefreshSelector() {
  const [refreshInterval, setRefreshInterval] = useState<'5' | '15' | '30' | '60'>('15');

  const options = [
    { value: '5' as const, label: '5 min' },
    { value: '15' as const, label: '15 min' },
    { value: '30' as const, label: '30 min' },
    { value: '60' as const, label: '1 hour' },
  ];

  return (
    <div className="flex gap-2">
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => setRefreshInterval(option.value)}
          className={cn(
            'px-4 py-2 rounded-lg border text-sm transition-all',
            refreshInterval === option.value
              ? 'bg-accent-cyan/10 border-accent-cyan/50 text-accent-cyan font-medium'
              : 'bg-bg-elevated border-black/10 text-text-secondary hover:border-black/20'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ToggleSwitch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="relative inline-flex items-center cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="sr-only peer"
      />
      <div className={cn(
        "w-11 h-6 rounded-full transition-colors",
        "bg-black/10 peer-checked:bg-accent-cyan",
        "peer-focus:ring-2 peer-focus:ring-accent-cyan/20",
        "peer-disabled:opacity-50 peer-disabled:cursor-not-allowed",
        "after:content-[''] after:absolute after:top-[2px] after:left-[2px]",
        "after:bg-white after:rounded-full after:h-5 after:w-5",
        "after:transition-transform peer-checked:after:translate-x-5",
        "after:shadow-sm"
      )} />
    </label>
  );
}
