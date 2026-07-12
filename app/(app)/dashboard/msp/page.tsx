'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion, useReducedMotion } from 'framer-motion';
import {
  Building2,
  Plus,
  ArrowRight,
  Settings,
} from 'lucide-react';
import { T } from 'gt-next';
import { Button } from '@/components/ui/button';
import { useMsp } from '@/contexts/MspContext';
import { MspStatsOverview, CrossTenantJobsTable, TenantCard } from '@/components/msp';
import { PageHeader, SkeletonGrid } from '@/components/dashboard';

export default function MspDashboardPage() {
  const router = useRouter();
  const prefersReducedMotion = useReducedMotion();
  const {
    organization,
    stats,
    isMspUser,
    isLoadingOrganization,
    managedTenants,
    isLoadingTenants,
    selectedTenantId,
    selectTenant,
  } = useMsp();

  // Redirect to setup if not an MSP user
  useEffect(() => {
    if (!isLoadingOrganization && !isMspUser) {
      router.push('/dashboard/msp/setup');
    }
  }, [isLoadingOrganization, isMspUser, router]);

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

  // Loading state
  if (isLoadingOrganization) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 bg-overlay/10 rounded animate-pulse" />
        <SkeletonGrid count={4} columns={4} variant="stat" />
      </div>
    );
  }

  // Not an MSP user
  if (!isMspUser || !organization) {
    return null;
  }

  // Get active and pending tenants
  const activeTenants = managedTenants.filter(
    t => t.is_active && t.consent_status === 'granted' && t.tenant_id
  );
  const pendingTenants = managedTenants.filter(
    t => t.is_active && t.consent_status === 'pending'
  );

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-8"
    >
      {/* Header */}
      <PageHeader
        title={organization.name}
        description={<T>MSP Dashboard</T>}
        gradient
        gradientColors="mixed"
        actions={
          <Link href="/dashboard/msp/tenants/add">
            <Button className="bg-gradient-to-r from-accent-cyan to-accent-violet text-bg-elevated hover:opacity-90">
              <Plus className="w-4 h-4 mr-2" />
              <T>Add Customer</T>
            </Button>
          </Link>
        }
      />

      {/* Stats Overview */}
      <motion.div variants={itemVariants}>
        <MspStatsOverview stats={stats} isLoading={isLoadingOrganization} />
      </motion.div>

      {/* Main Content Grid */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Tenants Section */}
        <motion.div variants={itemVariants} className="lg:col-span-1 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium text-text-primary"><T>Managed Tenants</T></h2>
            <Link
              href="/dashboard/msp/tenants"
              className="text-sm text-accent-cyan hover:text-accent-cyan-bright transition-colors"
            >
              <T>View all</T>
              <ArrowRight className="w-4 h-4 inline-block ml-1" />
            </Link>
          </div>

          <div className="space-y-3">
            {isLoadingTenants && activeTenants.length === 0 && (
              <div className="space-y-3">
                {[1, 2].map((i) => (
                  <div key={i} className="h-24 glass-light rounded-xl border border-overlay/5 animate-pulse" />
                ))}
              </div>
            )}

            {!isLoadingTenants && activeTenants.length === 0 && pendingTenants.length === 0 && (
              <div className="p-6 rounded-xl glass-light border border-overlay/5 text-center">
                <Building2 className="w-8 h-8 text-text-muted mx-auto mb-3" />
                <p className="text-sm text-text-secondary mb-3"><T>No customer tenants yet</T></p>
                <Link href="/dashboard/msp/tenants/add">
                  <Button size="sm" variant="outline" className="border-black/20 text-text-primary hover:bg-overlay/5">
                    <Plus className="w-4 h-4 mr-2" />
                    <T>Add first customer</T>
                  </Button>
                </Link>
              </div>
            )}

            {/* Show up to 3 active tenants */}
            {activeTenants.slice(0, 3).map((tenant, index) => (
              <motion.div
                key={tenant.id}
                variants={itemVariants}
                custom={index}
              >
                <TenantCard
                  tenant={tenant}
                  isSelected={selectedTenantId === tenant.tenant_id}
                  onSelect={selectTenant}
                />
              </motion.div>
            ))}

            {/* Show pending tenants if any */}
            {pendingTenants.length > 0 && (
              <>
                <div className="text-xs text-text-muted uppercase tracking-wider px-1 mt-4">
                  <T>Pending Consent ({pendingTenants.length})</T>
                </div>
                {pendingTenants.slice(0, 2).map((tenant, index) => (
                  <motion.div
                    key={tenant.id}
                    variants={itemVariants}
                    custom={index + activeTenants.length}
                  >
                    <TenantCard key={tenant.id} tenant={tenant} />
                  </motion.div>
                ))}
              </>
            )}

            {/* Show "View more" if there are more tenants */}
            {(activeTenants.length > 3 || pendingTenants.length > 2) && (
              <Link
                href="/dashboard/msp/tenants"
                className="block p-3 text-center text-sm text-text-secondary hover:text-text-primary rounded-lg bg-overlay/5 hover:bg-overlay/10 transition-colors border border-overlay/5"
              >
                <T>View all {managedTenants.length} tenants</T>
              </Link>
            )}
          </div>
        </motion.div>

        {/* Jobs Section */}
        <motion.div variants={itemVariants} className="lg:col-span-2">
          <CrossTenantJobsTable />
        </motion.div>
      </div>
    </motion.div>
  );
}
