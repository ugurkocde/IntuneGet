'use client';

import { motion, useReducedMotion } from 'framer-motion';
import {
  User,
  Building2,
  Shield,
  LogOut,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { PageHeader, SectionTransition } from '@/components/dashboard';
import { cn } from '@/lib/utils';

export default function SettingsPage() {
  const { user, signOut } = useMicrosoftAuth();
  const prefersReducedMotion = useReducedMotion();

  const handleSignOut = async () => {
    await signOut();
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
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-lg bg-accent-cyan/10 flex items-center justify-center">
              <Shield className="w-5 h-5 text-accent-cyan" />
            </div>
            <h2 className="text-lg font-semibold text-white">API Permissions</h2>
          </div>

          <p className="text-zinc-400 text-sm mb-4">
            IntuneGet requires the following permissions to deploy applications:
          </p>

          <div className="space-y-3">
            <PermissionItem
              name="DeviceManagementApps.ReadWrite.All"
              description="Read and write Intune applications"
              granted
            />
            <PermissionItem
              name="User.Read"
              description="Read your profile information"
              granted
            />
            <PermissionItem
              name="Group.Read.All"
              description="Read group memberships for app assignment"
              granted
            />
          </div>

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
}: {
  name: string;
  description: string;
  granted: boolean;
}) {
  return (
    <div className="flex items-start gap-3 p-3 bg-bg-elevated rounded-lg border border-white/5">
      {granted ? (
        <CheckCircle2 className="w-5 h-5 text-status-success flex-shrink-0 mt-0.5" />
      ) : (
        <AlertCircle className="w-5 h-5 text-status-warning flex-shrink-0 mt-0.5" />
      )}
      <div>
        <p className="text-white font-mono text-sm">{name}</p>
        <p className="text-zinc-500 text-sm mt-0.5">{description}</p>
      </div>
    </div>
  );
}
