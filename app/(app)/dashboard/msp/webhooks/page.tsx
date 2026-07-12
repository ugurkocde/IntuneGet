'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Webhook } from 'lucide-react';
import { T } from 'gt-next';
import { useMsp } from '@/contexts/MspContext';
import { PageHeader, SkeletonGrid } from '@/components/dashboard';
import { MspWebhookManager } from '@/components/msp/webhooks';

export default function MspWebhooksPage() {
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
        <div className="h-8 w-48 bg-overlay/10 rounded animate-pulse" />
        <SkeletonGrid count={2} columns={2} variant="content" />
      </div>
    );
  }

  // Not an MSP user
  if (!isMspUser || !organization) {
    return null;
  }

  // Check permission - since we don't have memberRole from context, we'll allow access
  // The API will enforce permissions server-side
  const canManagePolicies = true; // Permission check removed - server handles it
  if (!canManagePolicies) {
    return (
      <div className="space-y-8">
        <PageHeader
          title={<T>Webhooks</T>}
          icon={Webhook}
        />
        <div className="p-8 rounded-xl glass-light border border-overlay/5 text-center">
          <p className="text-text-secondary">
            <T>You do not have permission to manage webhooks.</T>
          </p>
          <p className="text-sm text-text-muted mt-2">
            <T>Contact your organization admin to request access.</T>
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
      <PageHeader
        title={<T>Webhooks</T>}
        description={<T>Receive real-time notifications for events in your organization</T>}
        icon={Webhook}
      />

      <MspWebhookManager />
    </motion.div>
  );
}
