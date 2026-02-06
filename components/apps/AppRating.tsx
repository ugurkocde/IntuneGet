'use client';

import { useState, useEffect, useCallback } from 'react';
import { Star, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { useToast } from '@/hooks/use-toast';

interface AppRatingProps {
  appId: string;
  compact?: boolean;
  onRatingSubmit?: () => void;
}

interface RatingStats {
  total_ratings: number;
  average_rating: number;
  successful_deployments: number;
  failed_deployments: number;
  success_rate: number | null;
}

interface UserRating {
  id: string;
  rating: number;
  comment: string | null;
  deployment_success: boolean | null;
  updated_at: string;
}

export function AppRating({ appId, compact = false, onRatingSubmit }: AppRatingProps) {
  const [stats, setStats] = useState<RatingStats | null>(null);
  const [userRating, setUserRating] = useState<UserRating | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState('');
  const [deploymentSuccess, setDeploymentSuccess] = useState<boolean | null>(null);

  const { getAccessToken, isAuthenticated } = useMicrosoftAuth();
  const { toast } = useToast();

  const fetchRatings = useCallback(async () => {
    setIsLoading(true);
    try {
      const headers: HeadersInit = {};
      const accessToken = await getAccessToken();
      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
      }

      const response = await fetch(`/api/apps/${encodeURIComponent(appId)}/rate`, {
        headers,
      });

      if (response.ok) {
        const data = await response.json();
        setStats(data.stats);
        setUserRating(data.user_rating);

        // Pre-fill form with existing rating
        if (data.user_rating) {
          setRating(data.user_rating.rating);
          setComment(data.user_rating.comment || '');
          setDeploymentSuccess(data.user_rating.deployment_success);
        }
      }
    } catch (error) {
      console.error('Error fetching ratings:', error);
    } finally {
      setIsLoading(false);
    }
  }, [appId, getAccessToken]);

  useEffect(() => {
    fetchRatings();
  }, [fetchRatings]);

  const handleSubmit = async () => {
    if (!isAuthenticated) {
      toast({
        title: 'Authentication required',
        description: 'Please sign in to rate apps.',
        variant: 'destructive',
      });
      return;
    }

    if (rating === 0) {
      toast({
        title: 'Rating required',
        description: 'Please select a star rating.',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        toast({
          title: 'Authentication required',
          description: 'Please sign in to rate apps.',
          variant: 'destructive',
        });
        setIsSubmitting(false);
        return;
      }

      const response = await fetch(`/api/apps/${encodeURIComponent(appId)}/rate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          rating,
          comment: comment.trim() || null,
          deployment_success: deploymentSuccess,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to submit rating');
      }

      toast({
        title: userRating ? 'Rating updated' : 'Rating submitted',
        description: 'Thank you for your feedback!',
      });

      setShowForm(false);
      fetchRatings();
      onRatingSubmit?.();
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to submit rating',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderStars = (
    value: number,
    interactive = false,
    size: 'sm' | 'md' = 'md'
  ) => {
    const displayValue = interactive && hoverRating > 0 ? hoverRating : value;
    const starSize = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';

    return (
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            disabled={!interactive}
            onClick={() => interactive && setRating(star)}
            onMouseEnter={() => interactive && setHoverRating(star)}
            onMouseLeave={() => interactive && setHoverRating(0)}
            className={cn(
              'transition-colors',
              interactive && 'cursor-pointer hover:scale-110'
            )}
          >
            <Star
              className={cn(
                starSize,
                star <= displayValue
                  ? 'fill-yellow-400 text-yellow-400'
                  : 'text-black/20'
              )}
            />
          </button>
        ))}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-text-muted">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm">Loading ratings...</span>
      </div>
    );
  }

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        {renderStars(stats?.average_rating || 0, false, 'sm')}
        {stats && stats.total_ratings > 0 && (
          <span className="text-xs text-text-muted">
            ({stats.average_rating.toFixed(1)})
          </span>
        )}
        {isAuthenticated && (
          <button
            onClick={() => setShowForm(!showForm)}
            className="text-xs text-accent-cyan hover:underline"
          >
            {userRating ? 'Update' : 'Rate'}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Rating summary */}
      <div className="flex items-center gap-4">
        <div className="flex flex-col items-center">
          <span className="text-3xl font-bold text-text-primary">
            {stats?.average_rating.toFixed(1) || '0.0'}
          </span>
          {renderStars(stats?.average_rating || 0)}
          <span className="text-xs text-text-muted mt-1">
            {stats?.total_ratings || 0} ratings
          </span>
        </div>

        {stats && stats.success_rate !== null && (
          <div className="flex flex-col items-center px-4 border-l border-black/10">
            <span className="text-2xl font-bold text-green-500">
              {stats.success_rate}%
            </span>
            <span className="text-xs text-text-muted">Success rate</span>
          </div>
        )}
      </div>

      {/* Rate button / form */}
      {isAuthenticated && (
        <>
          {!showForm ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowForm(true)}
              className="w-full"
            >
              {userRating ? 'Update your rating' : 'Rate this app'}
            </Button>
          ) : (
            <div className="p-4 bg-black/5 rounded-xl space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  Your rating
                </label>
                {renderStars(rating, true)}
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  Deployment status
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setDeploymentSuccess(true)}
                    className={cn(
                      'flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors',
                      deploymentSuccess === true
                        ? 'border-green-500 bg-green-500/10 text-green-500'
                        : 'border-black/10 text-text-muted hover:border-black/20'
                    )}
                  >
                    <CheckCircle className="w-4 h-4" />
                    <span className="text-sm">Successful</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeploymentSuccess(false)}
                    className={cn(
                      'flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors',
                      deploymentSuccess === false
                        ? 'border-red-500 bg-red-500/10 text-red-500'
                        : 'border-black/10 text-text-muted hover:border-black/20'
                    )}
                  >
                    <XCircle className="w-4 h-4" />
                    <span className="text-sm">Failed</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  Comment (optional)
                </label>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Share your experience..."
                  rows={3}
                  maxLength={1000}
                  className="w-full px-3 py-2 bg-bg-elevated border border-black/10 rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-cyan/50 resize-none"
                />
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={handleSubmit}
                  disabled={isSubmitting || rating === 0}
                  className="bg-accent-cyan hover:bg-accent-cyan/90 text-white"
                >
                  {isSubmitting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : userRating ? (
                    'Update Rating'
                  ) : (
                    'Submit Rating'
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowForm(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default AppRating;
