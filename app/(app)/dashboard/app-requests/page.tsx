'use client';

import { T } from 'gt-next';
import { SuggestionsClient } from '@/components/community/SuggestionsClient';
import { PageHeader } from '@/components/dashboard';

export default function DashboardAppRequestsPage() {
  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title={<T>App Requests</T>}
        description={<T>Request WinGet packages you want added to IntuneGet and vote on requests from other users.</T>}
        gradient
        gradientColors="cyan"
      />

      <SuggestionsClient />
    </div>
  );
}
