'use client';

import type {ReactNode} from 'react';
import {useMsp} from '@/contexts/MspContext';
import {Button} from '@/components/ui/button';

export default function MspLayout({children}:{children:ReactNode}) {
  const {organizationError,hasResolvedOrganization,isLoadingOrganization,refreshOrganization}=useMsp();
  if(organizationError) return <div role="alert" className="rounded-xl border border-status-error/30 p-6"><p>{organizationError}</p><Button type="button" disabled={isLoadingOrganization} onClick={()=>void refreshOrganization()}>Retry</Button></div>;
  if(!hasResolvedOrganization) return <div role="status" className="p-6 text-text-secondary">Loading your MSP organization...</div>;
  return children;
}
