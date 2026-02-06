'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import {
  Building2,
  LogOut,
  CheckCircle2,
  ExternalLink,
  BarChart3,
  Calendar,
  Shield,
  Copy,
  Check,
  Zap,
  TrendingUp,
  Activity,
  Timer,
  Fingerprint,
  Globe,
  Settings,
  Camera,
  Loader2,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { useDashboardStats } from '@/hooks/useAnalytics';
import { PageHeader } from '@/components/dashboard';
import { AnimatedStatCard, StatCardGrid } from '@/components/dashboard/AnimatedStatCard';
import { useProfileStore } from '@/stores/profile-store';
import { cn } from '@/lib/utils';

export default function AccountPage() {
  const { user, signOut, getTokenExpiryTime, getAccessToken } = useMicrosoftAuth();
  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const prefersReducedMotion = useReducedMotion();
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [tokenExpiry, setTokenExpiry] = useState<number | null>(null);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { profileImage, uploadProfileImage, removeProfileImage } = useProfileStore();

  useEffect(() => {
    const updateExpiry = async () => {
      await getAccessToken();
      setTokenExpiry(getTokenExpiryTime());
    };
    updateExpiry();
    const interval = setInterval(updateExpiry, 60000);
    return () => clearInterval(interval);
  }, [getAccessToken, getTokenExpiryTime]);

  const handleSignOut = async () => {
    await signOut();
  };

  const processImage = useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
      if (!validTypes.includes(file.type)) {
        reject(new Error('Invalid file type. Use JPEG, PNG, or WebP.'));
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const size = 256;
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Could not process image.'));
            return;
          }

          // Center crop: use the smaller dimension to determine scale
          const scale = Math.max(size / img.width, size / img.height);
          const scaledW = img.width * scale;
          const scaledH = img.height * scale;
          const offsetX = (size - scaledW) / 2;
          const offsetY = (size - scaledH) / 2;

          ctx.drawImage(img, offsetX, offsetY, scaledW, scaledH);

          const base64 = canvas.toDataURL('image/jpeg', 0.85);
          if (base64.length > 200 * 1024) {
            reject(new Error('Processed image is too large. Try a smaller image.'));
            return;
          }
          resolve(base64);
        };
        img.onerror = () => reject(new Error('Failed to load image.'));
        img.src = e.target?.result as string;
      };
      reader.onerror = () => reject(new Error('Failed to read file.'));
      reader.readAsDataURL(file);
    });
  }, []);

  const handleImageSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset input so the same file can be re-selected
    e.target.value = '';

    setImageError(null);
    setImageUploading(true);
    try {
      const base64 = await processImage(file);
      const token = await getAccessToken();
      if (!token) {
        setImageError('Authentication expired. Please refresh.');
        return;
      }
      await uploadProfileImage(token, base64);
    } catch (err) {
      setImageError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setImageUploading(false);
    }
  }, [processImage, getAccessToken, uploadProfileImage]);

  const handleRemoveImage = useCallback(async () => {
    setImageError(null);
    setImageUploading(true);
    try {
      const token = await getAccessToken();
      if (!token) {
        setImageError('Authentication expired. Please refresh.');
        return;
      }
      await removeProfileImage(token);
    } catch {
      setImageError('Failed to remove image.');
    } finally {
      setImageUploading(false);
    }
  }, [getAccessToken, removeProfileImage]);

  const copyToClipboard = async (text: string, field: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

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

  const successRate = stats
    ? stats.totalDeployed + stats.failed > 0
      ? Math.round((stats.totalDeployed / (stats.totalDeployed + stats.failed)) * 100)
      : 100
    : 0;

  const getTokenStatus = () => {
    if (tokenExpiry === null) return { label: 'Unknown', bg: 'bg-black/5', text: 'text-text-muted', dot: 'bg-text-muted' };
    if (tokenExpiry > 30) return { label: 'Active', bg: 'bg-status-success/10', text: 'text-status-success', dot: 'bg-status-success' };
    if (tokenExpiry > 5) return { label: 'Expiring Soon', bg: 'bg-status-warning/10', text: 'text-status-warning', dot: 'bg-status-warning' };
    return { label: 'Expiring', bg: 'bg-status-error/10', text: 'text-status-error', dot: 'bg-status-error' };
  };

  const tokenStatus = getTokenStatus();

  const initials = user?.name
    ? user.name.split(' ').map(n => n.charAt(0)).join('').slice(0, 2).toUpperCase()
    : user?.email?.charAt(0).toUpperCase() || 'U';

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Account"
        description="Your profile, usage statistics, and session details"
        gradient
        gradientColors="mixed"
        actions={
          <Link href="/dashboard/settings">
            <Button variant="outline" size="sm" className="gap-2">
              <Settings className="w-4 h-4" />
              Settings
            </Button>
          </Link>
        }
      />

      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="space-y-6"
      >
        {/* Profile Hero Card */}
        <motion.section
          variants={itemVariants}
          className="glass-light rounded-xl border border-black/5 hover:border-accent-cyan/20 transition-colors relative overflow-hidden"
        >
          {/* Decorative header band */}
          <div className="h-28 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-accent-cyan/12 via-accent-violet/8 to-accent-cyan/15" />
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-accent-violet/6 to-transparent" />
            <div className="absolute inset-0 bg-dots-light opacity-30" />
            <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-white to-transparent" />
          </div>

          <div className="px-6 pb-6 -mt-12 relative">
            <div className="flex flex-col sm:flex-row sm:items-end gap-4 mb-6">
              {/* Avatar with upload */}
              <div className="relative flex-shrink-0">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleImageSelect}
                  className="hidden"
                />
                <div className="absolute -inset-1 bg-gradient-to-br from-accent-cyan via-accent-violet to-accent-cyan rounded-2xl opacity-60 blur-sm" />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={imageUploading}
                  className="relative w-20 h-20 rounded-2xl bg-bg-elevated flex items-center justify-center border-2 border-white shadow-soft-md group cursor-pointer overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/50 focus-visible:ring-offset-2"
                >
                  {profileImage ? (
                    <img
                      src={profileImage}
                      alt="Profile"
                      className="w-full h-full object-cover rounded-xl"
                      onError={() => useProfileStore.getState().setProfileImage(null)}
                    />
                  ) : (
                    <span className="text-xl font-bold text-text-primary tracking-tight">
                      {initials}
                    </span>
                  )}
                  {/* Hover overlay */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center rounded-xl">
                    {imageUploading ? (
                      <Loader2 className="w-5 h-5 text-white animate-spin" />
                    ) : (
                      <Camera className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                    )}
                  </div>
                </button>
                <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 bg-status-success rounded-full border-[2.5px] border-white" />
                {profileImage && !imageUploading && (
                  <button
                    onClick={handleRemoveImage}
                    className="absolute -top-1 -right-1 w-5 h-5 bg-bg-elevated border border-black/10 rounded-full flex items-center justify-center hover:bg-status-error hover:text-white hover:border-status-error transition-colors z-10"
                    title="Remove photo"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Name + Email */}
              <div className="flex-1 min-w-0 pb-1">
                <h2 className="text-xl font-bold text-text-primary truncate">
                  {user?.name || 'User'}
                </h2>
                <p className="text-sm text-text-secondary truncate">
                  {user?.email || 'No email'}
                </p>
              </div>

              {/* Quick token badge */}
              <div className="flex-shrink-0 pb-1">
                <span className={cn(
                  'inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium',
                  tokenStatus.bg,
                  tokenStatus.text
                )}>
                  <span className={cn('w-1.5 h-1.5 rounded-full', tokenStatus.dot)} />
                  {tokenStatus.label}
                  {tokenExpiry !== null && tokenExpiry > 0 && (
                    <span className="text-text-muted font-normal">
                      {tokenExpiry}m
                    </span>
                  )}
                </span>
              </div>
            </div>

            {/* Image upload error */}
            {imageError && (
              <div className="mb-4 px-3 py-2 rounded-lg bg-status-error/10 text-status-error text-xs font-medium flex items-center justify-between">
                <span>{imageError}</span>
                <button onClick={() => setImageError(null)} className="ml-2 hover:opacity-70">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Identity fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
              <IdentityField
                icon={Fingerprint}
                label="Account ID"
                value={user?.id || 'Not available'}
                mono
                truncate
                copyable
                onCopy={(val) => copyToClipboard(val, 'id')}
                copied={copiedField === 'id'}
              />
              <IdentityField
                icon={Globe}
                label="Auth Provider"
                value="Microsoft Entra ID"
              />
            </div>
          </div>
        </motion.section>

        {/* Usage Statistics */}
        <motion.section variants={itemVariants}>
          <SectionLabel icon={BarChart3} iconColor="text-accent-violet" bgColor="bg-accent-violet/10" label="Usage Statistics" />
          <StatCardGrid columns={4}>
            <AnimatedStatCard
              title="Total Deployed"
              value={stats?.totalDeployed ?? 0}
              icon={Zap}
              color="cyan"
              loading={statsLoading}
              description="All-time"
              delay={0}
            />
            <AnimatedStatCard
              title="This Month"
              value={stats?.thisMonth ?? 0}
              icon={Calendar}
              color="violet"
              loading={statsLoading}
              description="Current month"
              delay={0.05}
            />
            <AnimatedStatCard
              title="Success Rate"
              value={successRate}
              valueType="percentage"
              icon={TrendingUp}
              color="success"
              loading={statsLoading}
              description="Deployments"
              delay={0.1}
            />
            <AnimatedStatCard
              title="Pending"
              value={stats?.pending ?? 0}
              icon={Activity}
              color={stats?.pending && stats.pending > 0 ? 'warning' : 'neutral'}
              loading={statsLoading}
              description="In progress"
              delay={0.15}
            />
          </StatCardGrid>
        </motion.section>

        {/* Tenant & Session - Side by Side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Tenant Details */}
          <motion.section
            variants={itemVariants}
            className="glass-light rounded-xl p-6 border border-black/5 hover:border-accent-violet/20 transition-colors flex flex-col"
          >
            <SectionLabel icon={Building2} iconColor="text-accent-violet" bgColor="bg-accent-violet/10" label="Tenant" inline />

            <div className="space-y-4 mt-5 flex-1">
              <div className="flex items-center justify-between">
                <span className="text-sm text-text-secondary">Status</span>
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-status-success" />
                  <span className="text-sm font-medium text-status-success">Connected</span>
                </div>
              </div>

              <div className="h-px bg-black/5" />

              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-text-secondary">Tenant ID</span>
                  {user?.tenantId && user.tenantId !== 'Not available' && (
                    <button
                      onClick={() => copyToClipboard(user.tenantId, 'tenantId')}
                      className="p-1 rounded hover:bg-black/5 text-text-muted hover:text-text-primary transition-colors"
                      title="Copy to clipboard"
                    >
                      <AnimatePresence mode="wait">
                        {copiedField === 'tenantId' ? (
                          <motion.div key="check" initial={{ scale: 0.5 }} animate={{ scale: 1 }} exit={{ scale: 0.5 }}>
                            <Check className="w-3.5 h-3.5 text-status-success" />
                          </motion.div>
                        ) : (
                          <motion.div key="copy" initial={{ scale: 0.5 }} animate={{ scale: 1 }} exit={{ scale: 0.5 }}>
                            <Copy className="w-3.5 h-3.5" />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </button>
                  )}
                </div>
                <p className="font-mono text-xs text-text-primary truncate">
                  {user?.tenantId || 'Not available'}
                </p>
              </div>

              <div className="h-px bg-black/5" />

              <a
                href="https://intune.microsoft.com"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between group py-1"
              >
                <span className="text-sm text-text-secondary group-hover:text-accent-cyan transition-colors">Intune Portal</span>
                <span className="flex items-center gap-1.5 text-sm text-accent-cyan group-hover:text-accent-cyan-bright transition-colors">
                  Open
                  <ExternalLink className="w-3.5 h-3.5" />
                </span>
              </a>
            </div>
          </motion.section>

          {/* Session */}
          <motion.section
            variants={itemVariants}
            className="glass-light rounded-xl p-6 border border-black/5 hover:border-accent-cyan/20 transition-colors flex flex-col"
          >
            <SectionLabel icon={Shield} iconColor="text-accent-cyan" bgColor="bg-accent-cyan/10" label="Session" inline />

            <div className="space-y-4 mt-5 flex-1 flex flex-col">
              <div>
                <span className="text-sm text-text-secondary">Token Status</span>
                <div className="flex items-center gap-2.5 mt-2">
                  <span className={cn(
                    'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium',
                    tokenStatus.bg,
                    tokenStatus.text
                  )}>
                    <Timer className="w-3 h-3" />
                    {tokenStatus.label}
                  </span>
                  {tokenExpiry !== null && (
                    <span className="text-text-muted text-sm">
                      {tokenExpiry > 0 ? `${tokenExpiry} min remaining` : 'Expired'}
                    </span>
                  )}
                </div>
              </div>

              <div className="h-px bg-black/5" />

              <div className="flex items-center justify-between">
                <span className="text-sm text-text-secondary">Provider</span>
                <span className="text-sm font-medium text-text-primary">Microsoft Entra ID</span>
              </div>

              <div className="h-px bg-black/5" />

              <div className="flex items-center justify-between">
                <span className="text-sm text-text-secondary">Scopes</span>
                <span className="text-xs font-mono text-text-muted">DeviceManagement*</span>
              </div>

              <div className="h-px bg-black/5" />

              {/* Sign Out inline */}
              <div className="pt-1 mt-auto">
                <AnimatePresence mode="wait">
                  {showSignOutConfirm ? (
                    <motion.div
                      key="confirm"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <p className="text-xs text-text-secondary mb-3">
                        This will disconnect your Microsoft account. You will need to sign in again to deploy.
                      </p>
                      <div className="flex items-center gap-2">
                        <Button
                          onClick={handleSignOut}
                          size="sm"
                          className="bg-status-error hover:bg-status-error/90 text-white border-0 gap-1.5"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                          Confirm Sign Out
                        </Button>
                        <Button
                          onClick={() => setShowSignOutConfirm(false)}
                          variant="ghost"
                          size="sm"
                          className="text-text-secondary"
                        >
                          Cancel
                        </Button>
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div key="trigger" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      <button
                        onClick={() => setShowSignOutConfirm(true)}
                        className="flex items-center gap-2 text-sm text-text-muted hover:text-status-error transition-colors group"
                      >
                        <LogOut className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                        Sign out of IntuneGet
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </motion.section>
        </div>
      </motion.div>
    </div>
  );
}

function SectionLabel({ icon: Icon, iconColor, bgColor, label, inline }: {
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  bgColor: string;
  label: string;
  inline?: boolean;
}) {
  return (
    <div className={cn('flex items-center gap-2.5', !inline && 'mb-4')}>
      <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center', bgColor)}>
        <Icon className={cn('w-4 h-4', iconColor)} />
      </div>
      <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wide">{label}</h2>
    </div>
  );
}

function IdentityField({
  icon: Icon,
  label,
  value,
  mono,
  truncate,
  copyable,
  onCopy,
  copied,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  mono?: boolean;
  truncate?: boolean;
  copyable?: boolean;
  onCopy?: (value: string) => void;
  copied?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 py-3 border-t border-black/5">
      <Icon className="w-4 h-4 text-text-muted flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-text-muted">{label}</p>
        <p className={cn(
          'text-sm text-text-primary mt-0.5',
          mono && 'font-mono text-xs',
          truncate && 'truncate'
        )}>
          {value}
        </p>
      </div>
      {copyable && onCopy && value && value !== 'Not available' && (
        <button
          onClick={() => onCopy(value)}
          className="flex-shrink-0 p-1.5 rounded-md hover:bg-black/5 text-text-muted hover:text-text-primary transition-colors"
          title="Copy to clipboard"
        >
          <AnimatePresence mode="wait">
            {copied ? (
              <motion.div key="check" initial={{ scale: 0.5 }} animate={{ scale: 1 }} exit={{ scale: 0.5 }}>
                <Check className="w-3.5 h-3.5 text-status-success" />
              </motion.div>
            ) : (
              <motion.div key="copy" initial={{ scale: 0.5 }} animate={{ scale: 1 }} exit={{ scale: 0.5 }}>
                <Copy className="w-3.5 h-3.5" />
              </motion.div>
            )}
          </AnimatePresence>
        </button>
      )}
    </div>
  );
}
