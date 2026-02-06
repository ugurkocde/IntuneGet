'use client';

import { useState } from 'react';
import { Send, Loader2, Lightbulb, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { useToast } from '@/hooks/use-toast';

interface AppSuggestionFormProps {
  onSuccess?: (suggestion: AppSuggestion) => void;
  onCancel?: () => void;
}

interface AppSuggestion {
  id: string;
  winget_id: string;
  reason: string | null;
  votes_count: number;
  status: string;
  created_at: string;
}

export function AppSuggestionForm({ onSuccess, onCancel }: AppSuggestionFormProps) {
  const [wingetId, setWingetId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { getAccessToken, isAuthenticated } = useMicrosoftAuth();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isAuthenticated) {
      toast({
        title: 'Authentication required',
        description: 'Please sign in to suggest apps.',
        variant: 'destructive',
      });
      return;
    }

    if (!wingetId.trim()) {
      setError('WinGet ID is required');
      return;
    }

    // Basic validation for WinGet ID format
    const wingetIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*\.[A-Za-z0-9][A-Za-z0-9._-]*$/;
    if (!wingetIdPattern.test(wingetId.trim())) {
      setError('Invalid WinGet ID format. Expected: Publisher.AppName (e.g., Microsoft.VisualStudioCode)');
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        toast({
          title: 'Authentication required',
          description: 'Please sign in to suggest apps.',
          variant: 'destructive',
        });
        setIsSubmitting(false);
        return;
      }

      const response = await fetch('/api/community/suggestions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          winget_id: wingetId.trim(),
          reason: null,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 409) {
          // App already suggested or exists
          setError(data.error);
        } else {
          throw new Error(data.error || 'Failed to submit suggestion');
        }
        return;
      }

      toast({
        title: 'Suggestion submitted',
        description: 'Your app suggestion has been submitted. Thank you for contributing!',
      });

      setWingetId('');
      onSuccess?.(data.suggestion);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to submit suggestion');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="p-4 bg-bg-elevated rounded-xl border border-black/10">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Lightbulb className="w-5 h-5 text-accent-cyan" />
          <h3 className="font-medium text-text-primary">Suggest an App</h3>
        </div>
        {onCancel && (
          <button
            onClick={onCancel}
            className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-black/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="wingetId"
            className="block text-sm font-medium text-text-secondary mb-1"
          >
            WinGet Package ID <span className="text-red-400">*</span>
          </label>
          <input
            id="wingetId"
            type="text"
            value={wingetId}
            onChange={(e) => setWingetId(e.target.value)}
            placeholder="e.g., Microsoft.VisualStudioCode"
            className="w-full px-3 py-2 bg-black/5 border border-black/10 rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-cyan/50 focus:ring-1 focus:ring-accent-cyan/30"
            disabled={isSubmitting}
          />
          <p className="mt-1 text-xs text-text-muted">
            Find package IDs at{' '}
            <a
              href="https://winget.run"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-cyan hover:underline"
            >
              winget.run
            </a>
          </p>
        </div>

        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="flex flex-col items-end gap-2">
          <Button
            type="submit"
            disabled={isSubmitting || !isAuthenticated}
            className="bg-accent-cyan hover:bg-accent-cyan/90 text-white"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                Submit Suggestion
              </>
            )}
          </Button>
          {!isAuthenticated && (
            <p className="text-xs text-text-muted">
              Sign in to submit a suggestion.
            </p>
          )}
        </div>
      </form>
    </div>
  );
}

export default AppSuggestionForm;
