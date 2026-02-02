'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { BarChart3 } from 'lucide-react';
import { useMsp } from '@/contexts/MspContext';
import { PageHeader, SkeletonGrid } from '@/components/dashboard';
import { MspReportsDashboard } from '@/components/msp/reports';

export default function MspReportsPage() {
  const router = useRouter();
  const { isMspUser, isLoadingOrganization, organization } = useMsp();

  // Redirect to setup if not an MSP user
  useEffect(() => {
    if (!isLoadingOrganization && !isMspUser) {
      router.push('/dashboard/msp/setup');
    }
  }, [isLoadingOrganization, isMspUser, router]);

  // Loading state
  if (isLoadingOrganization) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 bg-black/10 rounded animate-pulse" />
        <SkeletonGrid count={4} columns={4} variant="stat" />
      </div>
    );
  }

  // Not an MSP user
  if (!isMspUser || !organization) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="space-y-8"
    >
      <PageHeader
        title="Reports & Analytics"
        description="Deployment insights across all managed tenants"
        icon={BarChart3}
      />

      <MspReportsDashboard />
    </motion.div>
  );
}
