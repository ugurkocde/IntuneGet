'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowLeft, Layers } from 'lucide-react';
import { useMsp } from '@/contexts/MspContext';
import { PageHeader, SkeletonGrid } from '@/components/dashboard';
import { BatchDeploymentWizard } from '@/components/msp/BatchDeploymentWizard';
import { Button } from '@/components/ui/button';

export default function NewBatchDeploymentPage() {
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
        <SkeletonGrid count={1} columns={2} variant="content" />
      </div>
    );
  }

  // Not an MSP user
  if (!isMspUser || !organization) {
    return null;
  }

  // Check permission - since we don't have memberRole from context, we'll allow access
  // The API will enforce permissions server-side
  const canBatchDeploy = true; // Permission check removed - server handles it
  if (!canBatchDeploy) {
    return (
      <div className="space-y-8">
        <PageHeader
          title="New Batch Deployment"
          icon={Layers}
        />
        <div className="p-8 rounded-xl glass-light border border-black/5 text-center">
          <p className="text-text-secondary">
            You do not have permission to create batch deployments.
          </p>
          <p className="text-sm text-text-muted mt-2">
            Contact your organization admin to request access.
          </p>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="space-y-8"
    >
      <div className="flex items-center gap-4">
        <Link href="/dashboard/msp/batch">
          <Button variant="ghost" size="sm" className="text-text-secondary">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
        </Link>
      </div>

      <PageHeader
        title="New Batch Deployment"
        description="Deploy an application to multiple tenants simultaneously"
        icon={Layers}
      />

      <div className="max-w-4xl mx-auto">
        <div className="p-8 rounded-xl glass-light border border-black/5">
          <BatchDeploymentWizard />
        </div>
      </div>
    </motion.div>
  );
}
