'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { TeamManagement } from '@/components/msp/TeamManagement';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { useMspOptional } from '@/hooks/useMspOptional';
import { Loader2 } from 'lucide-react';

export default function MspTeamPage() {
  const router = useRouter();
  const { isAuthenticated } = useMicrosoftAuth();
  const { organization, isLoadingOrganization, isMspUser } = useMspOptional();

  // Redirect if not authenticated or not an MSP user
  useEffect(() => {
    if (!isLoadingOrganization && !isAuthenticated) {
      router.push('/');
      return;
    }

    if (!isLoadingOrganization && !isMspUser) {
      router.push('/dashboard/msp');
    }
  }, [isAuthenticated, isLoadingOrganization, isMspUser, router]);

  if (isLoadingOrganization) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-accent-cyan" />
      </div>
    );
  }

  if (!isMspUser || !organization) {
    return null; // Redirecting
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-text-primary">{organization.name}</h1>
        <p className="text-text-muted">Manage your team members and invitations</p>
      </div>

      <TeamManagement />
    </div>
  );
}
