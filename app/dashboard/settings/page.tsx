'use client';

import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  User,
  Building2,
  Shield,
  LogOut,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Loader2,
  HelpCircle,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { PageHeader, SectionTransition } from '@/components/dashboard';
import { cn } from '@/lib/utils';

interface PermissionStatusState {
  checked: boolean;
  checking: boolean;
  lastChecked?: Date;
  permissions: {
    deviceManagementApps: boolean | null;
    userRead: boolean | null;
    groupRead: boolean | null;
  };
}

export default function SettingsPage() {
  const { user, signOut, getAccessToken, requestAdminConsent } = useMicrosoftAuth();
  const prefersReducedMotion = useReducedMotion();
  const [isChecking, setIsChecking] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatusState | null>(null);

  const handleSignOut = async () => {
    await signOut();
  };

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
        },
      });
    } finally {
      setIsChecking(false);
    }
  };

  const handleGrantConsent = () => {
    requestAdminConsent();
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: prefersReducedMotion ? {} : {
        staggerChildren: 0.1,
        delayChildren: 0.1
      }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: prefersReducedMotion ? 0 : 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: prefersReducedMotion ? { duration: 0.2 } : {
        duration: 0.5,
        ease: [0.25, 0.46, 0.45, 0.94] as const
      }
    }
  };

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Settings"
        description="Manage your account and Intune connection"
        gradient
        gradientColors="mixed"
      />

      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="space-y-6"
      >
        {/* Account section */}
        <motion.section
          variants={itemVariants}
          className="glass-dark rounded-xl p-6 border border-white/5 hover:border-accent-cyan/20 transition-colors"
        >
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-lg bg-accent-cyan/10 flex items-center justify-center">
              <User className="w-5 h-5 text-accent-cyan" />
            </div>
            <h2 className="text-lg font-semibold text-white">Account</h2>
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

        {/* Intune connection section */}
        <motion.section
          variants={itemVariants}
          className="glass-dark rounded-xl p-6 border border-white/5 hover:border-accent-cyan/20 transition-colors"
        >
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-lg bg-accent-violet/10 flex items-center justify-center">
              <Building2 className="w-5 h-5 text-accent-violet" />
            </div>
            <h2 className="text-lg font-semibold text-white">Intune Connection</h2>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between py-3 border-b border-white/5">
              <div>
                <p className="text-zinc-400 text-sm">Status</p>
                <div className="flex items-center gap-2 mt-1">
                  <CheckCircle2 className="w-4 h-4 text-status-success" />
                  <p className="text-status-success">Connected</p>
                </div>
              </div>
            </div>

            <SettingRow
              label="Tenant ID"
              value={user?.tenantId || 'Not available'}
              mono
            />

            <div className="flex items-center justify-between py-3">
              <div>
                <p className="text-zinc-400 text-sm">Intune Portal</p>
                <a
                  href="https://intune.microsoft.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-accent-cyan hover:text-accent-cyan-bright transition-colors mt-1"
                >
                  Open Intune Portal
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            </div>
          </div>
        </motion.section>

        {/* Permissions section */}
        <motion.section
          variants={itemVariants}
          className="glass-dark rounded-xl p-6 border border-white/5 hover:border-accent-cyan/20 transition-colors"
        >
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 sm:gap-0 mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-accent-cyan/10 flex items-center justify-center">
                <Shield className="w-5 h-5 text-accent-cyan" />
              </div>
              <h2 className="text-lg font-semibold text-white">API Permissions</h2>
            </div>
            <Button
              onClick={handleCheckPermissions}
              disabled={isChecking}
              variant="outline"
              size="sm"
              className="border-white/10 hover:border-accent-cyan/50 w-full sm:w-auto"
            >
              {isChecking ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Shield className="w-4 h-4 mr-2" />
              )}
              {isChecking ? 'Checking...' : 'Check Permissions'}
            </Button>
          </div>

          <p className="text-zinc-400 text-sm mb-4">
            IntuneGet requires the following permissions to deploy applications:
          </p>

          <div className="space-y-3">
            <PermissionItem
              name="DeviceManagementApps.ReadWrite.All"
              description="Read and write Intune applications"
              granted={permissionStatus?.permissions.deviceManagementApps ?? null}
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
            <p className="text-xs text-zinc-500 mt-3">
              Last checked: {permissionStatus.lastChecked.toLocaleString()}
            </p>
          )}

          {permissionStatus?.permissions.deviceManagementApps === false && (
            <div className="mt-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
              <p className="text-sm text-amber-400 mb-2">
                Intune permission is missing. A Global Administrator needs to re-grant consent.
              </p>
              <Button
                onClick={handleGrantConsent}
                size="sm"
                className="bg-amber-500 hover:bg-amber-600 text-black"
              >
                Re-grant Admin Consent
              </Button>
            </div>
          )}

          <div className="mt-6 p-4 bg-bg-elevated rounded-lg border border-white/5">
            <p className="text-zinc-400 text-sm">
              To modify permissions, visit your{' '}
              <a
                href="https://portal.azure.com/#view/Microsoft_AAD_IAM/StartboardApplicationsMenuBlade/~/AppAppsPreview"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-cyan hover:text-accent-cyan-bright transition-colors"
              >
                Entra ID Enterprise Applications
              </a>{' '}
              page.
            </p>
          </div>
        </motion.section>

        {/* Danger zone */}
        <motion.section
          variants={itemVariants}
          className="rounded-xl p-6 border border-status-error/20 bg-status-error/5 hover:border-status-error/30 transition-colors"
        >
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-lg bg-status-error/10 flex items-center justify-center">
              <AlertCircle className="w-5 h-5 text-status-error" />
            </div>
            <h2 className="text-lg font-semibold text-white">Sign Out</h2>
          </div>

          <p className="text-zinc-400 text-sm mb-4">
            Signing out will disconnect your Microsoft account from IntuneGet. You
            will need to sign in again to deploy applications.
          </p>

          <Button
            onClick={handleSignOut}
            variant="outline"
            className="border-status-error/30 text-status-error hover:bg-status-error/10 hover:border-status-error/50"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Sign Out
          </Button>
        </motion.section>
      </motion.div>
    </div>
  );
}

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
        !noBorder && 'border-b border-white/5'
      )}
    >
      <div>
        <p className="text-zinc-400 text-sm">{label}</p>
        <p className={cn('text-white mt-0.5', mono && 'font-mono text-sm')}>
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
      return <Loader2 className="w-5 h-5 text-zinc-400 flex-shrink-0 mt-0.5 animate-spin" />;
    }
    if (granted === true) {
      return <CheckCircle2 className="w-5 h-5 text-status-success flex-shrink-0 mt-0.5" />;
    }
    if (granted === false) {
      return <XCircle className="w-5 h-5 text-status-error flex-shrink-0 mt-0.5" />;
    }
    return <HelpCircle className="w-5 h-5 text-zinc-500 flex-shrink-0 mt-0.5" />;
  };

  const renderStatus = () => {
    if (checking) {
      return <span className="text-zinc-400 text-xs ml-2">Checking...</span>;
    }
    if (granted === true) {
      return <span className="text-status-success text-xs ml-2">Granted</span>;
    }
    if (granted === false) {
      return <span className="text-status-error text-xs ml-2">Missing</span>;
    }
    return <span className="text-zinc-500 text-xs ml-2">Not checked</span>;
  };

  return (
    <div className={cn(
      "flex items-start gap-3 p-3 bg-bg-elevated rounded-lg border",
      granted === false ? "border-status-error/30" : "border-white/5"
    )}>
      {renderIcon()}
      <div className="flex-1">
        <div className="flex items-center">
          <p className="text-white font-mono text-sm">{name}</p>
          {renderStatus()}
        </div>
        <p className="text-zinc-500 text-sm mt-0.5">{description}</p>
      </div>
    </div>
  );
}
