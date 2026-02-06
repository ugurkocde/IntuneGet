'use client';

import { useState, useCallback } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AppSuggestionForm } from './AppSuggestionForm';
import { SuggestionsList } from './SuggestionsList';

export function SuggestionsClient() {
  const [showForm, setShowForm] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleSuccess = useCallback(() => {
    setShowForm(false);
    setRefreshKey((k) => k + 1);
  }, []);

  return (
    <div className="space-y-6">
      {showForm ? (
        <AppSuggestionForm
          onSuccess={handleSuccess}
          onCancel={() => setShowForm(false)}
        />
      ) : (
        <div className="flex justify-end">
          <Button
            onClick={() => setShowForm(true)}
            className="bg-accent-cyan hover:bg-accent-cyan/90 text-white"
          >
            <Plus className="w-4 h-4" />
            Suggest an App
          </Button>
        </div>
      )}

      <SuggestionsList key={refreshKey} showFilters />
    </div>
  );
}
