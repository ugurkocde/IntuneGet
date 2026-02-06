'use client';

import { SuggestionsClient } from '@/components/community/SuggestionsClient';

export default function DashboardAppRequestsPage() {
  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-text-primary">App Requests</h1>
        <p className="text-text-secondary mt-1">
          Request WinGet packages you want added to IntuneGet and vote on requests from other users.
        </p>
      </div>

      <SuggestionsClient />
    </div>
  );
}
