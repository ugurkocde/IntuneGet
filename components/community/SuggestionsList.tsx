'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Package, Clock, CheckCircle2, XCircle, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { VoteButton } from './VoteButton';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';

interface Suggestion {
  id: string;
  winget_id: string;
  suggested_by_email: string;
  reason: string | null;
  votes_count: number;
  status: 'pending' | 'approved' | 'rejected' | 'implemented';
  created_at: string;
}

interface SuggestionsListProps {
  status?: 'pending' | 'approved' | 'rejected' | 'implemented' | 'all';
  sort?: 'votes' | 'newest' | 'oldest';
  limit?: number;
  showFilters?: boolean;
  onSuggestionClick?: (suggestion: Suggestion) => void;
}

const statusConfig = {
  pending: {
    label: 'Pending',
    icon: Clock,
    color: 'text-yellow-500',
    bgColor: 'bg-yellow-500/10',
  },
  approved: {
    label: 'Approved',
    icon: CheckCircle2,
    color: 'text-green-500',
    bgColor: 'bg-green-500/10',
  },
  rejected: {
    label: 'Rejected',
    icon: XCircle,
    color: 'text-red-500',
    bgColor: 'bg-red-500/10',
  },
  implemented: {
    label: 'Implemented',
    icon: Sparkles,
    color: 'text-accent-cyan',
    bgColor: 'bg-accent-cyan/10',
  },
};

export function SuggestionsList({
  status: initialStatus = 'pending',
  sort: initialSort = 'votes',
  limit = 20,
  showFilters = true,
  onSuggestionClick,
}: SuggestionsListProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [userVotes, setUserVotes] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState(initialStatus);
  const [sort, setSort] = useState(initialSort);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const { getAccessToken } = useMicrosoftAuth();

  const fetchSuggestions = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        status,
        sort,
        page: page.toString(),
        limit: limit.toString(),
      });

      const headers: HeadersInit = {};
      const accessToken = await getAccessToken();
      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
      }

      const response = await fetch(`/api/community/suggestions?${params}`, {
        headers,
      });

      if (!response.ok) {
        throw new Error('Failed to fetch suggestions');
      }

      const data = await response.json();
      setSuggestions(data.suggestions);
      setUserVotes(data.userVotes || []);
      setTotalPages(data.pagination.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  }, [status, sort, page, limit, getAccessToken]);

  useEffect(() => {
    fetchSuggestions();
  }, [fetchSuggestions]);

  const handleVoteChange = (suggestionId: string, newVotes: number, voted: boolean) => {
    setSuggestions((prev) =>
      prev.map((s) =>
        s.id === suggestionId ? { ...s, votes_count: newVotes } : s
      )
    );
    setUserVotes((prev) =>
      voted
        ? [...prev, suggestionId]
        : prev.filter((id) => id !== suggestionId)
    );
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
    });
  };

  const getStatusBadge = (suggestionStatus: Suggestion['status']) => {
    const config = statusConfig[suggestionStatus];
    const Icon = config.icon;

    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full',
          config.bgColor,
          config.color
        )}
      >
        <Icon className="w-3 h-3" />
        {config.label}
      </span>
    );
  };

  if (error) {
    return (
      <div className="p-6 text-center text-text-muted">
        <p>Error loading suggestions: {error}</p>
        <button
          onClick={fetchSuggestions}
          className="mt-2 text-accent-cyan hover:underline"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {showFilters && (
        <div className="flex flex-wrap items-center gap-4 p-4 bg-black/5 rounded-xl">
          <div className="flex items-center gap-2">
            <label className="text-sm text-text-secondary">Status:</label>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as typeof status);
                setPage(1);
              }}
              className="px-3 py-1.5 bg-bg-elevated border border-black/10 rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent-cyan/50"
            >
              <option value="all">All</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="implemented">Implemented</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-sm text-text-secondary">Sort by:</label>
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value as typeof sort);
                setPage(1);
              }}
              className="px-3 py-1.5 bg-bg-elevated border border-black/10 rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent-cyan/50"
            >
              <option value="votes">Most Votes</option>
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
            </select>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center p-8">
          <Loader2 className="w-6 h-6 animate-spin text-accent-cyan" />
        </div>
      ) : suggestions.length === 0 ? (
        <div className="p-8 text-center text-text-muted">
          <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>No suggestions found</p>
          {status !== 'all' && (
            <button
              onClick={() => setStatus('all')}
              className="mt-2 text-accent-cyan hover:underline text-sm"
            >
              View all suggestions
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {suggestions.map((suggestion) => (
              <div
                key={suggestion.id}
                className={cn(
                  'flex gap-4 p-4 bg-bg-elevated rounded-xl border border-black/10 transition-all duration-200',
                  onSuggestionClick && 'cursor-pointer hover:border-black/20'
                )}
                onClick={() => onSuggestionClick?.(suggestion)}
              >
                <VoteButton
                  suggestionId={suggestion.id}
                  currentVotes={suggestion.votes_count}
                  hasVoted={userVotes.includes(suggestion.id)}
                  onVoteChange={(newVotes, voted) =>
                    handleVoteChange(suggestion.id, newVotes, voted)
                  }
                  disabled={suggestion.status !== 'pending'}
                />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="text-sm font-mono text-accent-cyan bg-accent-cyan/10 px-2 py-0.5 rounded">
                      {suggestion.winget_id}
                    </code>
                    {getStatusBadge(suggestion.status)}
                  </div>

                  {suggestion.reason && (
                    <p className="mt-2 text-sm text-text-secondary line-clamp-2">
                      {suggestion.reason}
                    </p>
                  )}

                  <div className="flex items-center gap-3 mt-2 text-xs text-text-muted">
                    <span>Suggested by {suggestion.suggested_by_email.split('@')[0]}</span>
                    <span>{formatDate(suggestion.created_at)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-4">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 text-sm border border-black/10 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-black/5"
              >
                Previous
              </button>
              <span className="text-sm text-text-muted">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 text-sm border border-black/10 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-black/5"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default SuggestionsList;
