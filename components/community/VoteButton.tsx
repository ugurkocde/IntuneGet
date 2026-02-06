'use client';

import { useState } from 'react';
import { ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { useToast } from '@/hooks/use-toast';

interface VoteButtonProps {
  suggestionId: string;
  currentVotes: number;
  hasVoted: boolean;
  onVoteChange?: (newVotes: number, voted: boolean) => void;
  disabled?: boolean;
}

export function VoteButton({
  suggestionId,
  currentVotes,
  hasVoted: initialHasVoted,
  onVoteChange,
  disabled = false,
}: VoteButtonProps) {
  const [votes, setVotes] = useState(currentVotes);
  const [hasVoted, setHasVoted] = useState(initialHasVoted);
  const [isLoading, setIsLoading] = useState(false);

  const { getAccessToken, isAuthenticated } = useMicrosoftAuth();
  const { toast } = useToast();

  const handleVote = async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (!isAuthenticated) {
      toast({
        title: 'Authentication required',
        description: 'Please sign in to vote for app suggestions.',
        variant: 'destructive',
      });
      return;
    }

    if (isLoading) return;

    setIsLoading(true);

    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        toast({
          title: 'Authentication required',
          description: 'Please sign in to vote for app suggestions.',
          variant: 'destructive',
        });
        setIsLoading(false);
        return;
      }

      const method = hasVoted ? 'DELETE' : 'POST';
      const response = await fetch(`/api/community/suggestions/${suggestionId}/vote`, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update vote');
      }

      const data = await response.json();
      const newVotes = data.votes_count;
      const newHasVoted = !hasVoted;

      setVotes(newVotes);
      setHasVoted(newHasVoted);
      onVoteChange?.(newVotes, newHasVoted);
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to update vote',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <button
      onClick={handleVote}
      disabled={disabled || isLoading}
      className={cn(
        'flex flex-col items-center justify-center min-w-[48px] p-2 rounded-lg border transition-all duration-200',
        hasVoted
          ? 'bg-accent-cyan/10 border-accent-cyan/30 text-accent-cyan'
          : 'bg-black/5 border-black/10 text-text-secondary hover:border-black/20 hover:bg-black/10',
        (disabled || isLoading) && 'opacity-50 cursor-not-allowed'
      )}
      title={hasVoted ? 'Remove vote' : 'Vote for this suggestion'}
    >
      <ChevronUp
        className={cn(
          'w-5 h-5 transition-transform',
          hasVoted && 'text-accent-cyan',
          isLoading && 'animate-pulse'
        )}
      />
      <span className="text-sm font-medium">{votes}</span>
    </button>
  );
}

export default VoteButton;
