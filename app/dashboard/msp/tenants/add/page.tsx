'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useMsp } from '@/contexts/MspContext';
import { AddTenantFlow } from '@/components/msp';

export default function AddTenantPage() {
  const router = useRouter();
  const { isMspUser, isLoadingOrganization } = useMsp();

  // Redirect to setup if not an MSP user
  useEffect(() => {
    if (!isLoadingOrganization && !isMspUser) {
      router.push('/dashboard/msp/setup');
    }
  }, [isLoadingOrganization, isMspUser, router]);

  // Loading state
  if (isLoadingOrganization) {
    return (
      <div className="max-w-lg mx-auto space-y-6">
        <div className="h-6 w-32 bg-black/10 rounded animate-pulse" />
        <div className="h-64 bg-black/5 rounded-xl animate-pulse" />
      </div>
    );
  }

  // Not an MSP user
  if (!isMspUser) {
    return null;
  }

  const handleComplete = () => {
    router.push('/dashboard/msp/tenants');
  };

  const handleCancel = () => {
    router.push('/dashboard/msp/tenants');
  };

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href="/dashboard/msp/tenants"
        className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-text-primary transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Tenants
      </Link>

      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-text-primary">Add Customer Tenant</h1>
        <p className="text-text-muted mt-1">
          Set up a new customer tenant for management
        </p>
      </div>

      {/* Add Tenant Flow */}
      <AddTenantFlow
        onComplete={handleComplete}
        onCancel={handleCancel}
      />
    </div>
  );
}
