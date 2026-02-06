'use client';

import { useState } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Loader2, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { useToast } from '@/hooks/use-toast';

interface DeploymentFeedbackProps {
  appId: string;
  appName?: string;
  onFeedbackSubmit?: () => void;
}

type FeedbackType = 'works' | 'fails' | 'improvement';

const feedbackOptions: {
  type: FeedbackType;
  label: string;
  description: string;
  icon: typeof CheckCircle2;
  color: string;
  bgColor: string;
}[] = [
  {
    type: 'works',
    label: 'Works Great',
    description: 'Detection rules work correctly',
    icon: CheckCircle2,
    color: 'text-green-500',
    bgColor: 'bg-green-500/10 border-green-500/30',
  },
  {
    type: 'fails',
    label: 'Not Working',
    description: 'Detection rules fail to detect the app',
    icon: XCircle,
    color: 'text-red-500',
    bgColor: 'bg-red-500/10 border-red-500/30',
  },
  {
    type: 'improvement',
    label: 'Needs Improvement',
    description: 'Suggest improvements to detection',
    icon: AlertTriangle,
    color: 'text-yellow-500',
    bgColor: 'bg-yellow-500/10 border-yellow-500/30',
  },
];

export function DeploymentFeedback({
  appId,
  appName,
  onFeedbackSubmit,
}: DeploymentFeedbackProps) {
  const [selectedType, setSelectedType] = useState<FeedbackType | null>(null);
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const { getAccessToken, isAuthenticated } = useMicrosoftAuth();
  const { toast } = useToast();

  const handleSubmit = async () => {
    if (!isAuthenticated) {
      toast({
        title: 'Authentication required',
        description: 'Please sign in to submit feedback.',
        variant: 'destructive',
      });
      return;
    }

    if (!selectedType) {
      toast({
        title: 'Feedback type required',
        description: 'Please select a feedback type.',
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
          description: 'Please sign in to submit feedback.',
          variant: 'destructive',
        });
        setIsSubmitting(false);
        return;
      }

      // Get environment info
      const environmentInfo = {
        userAgent: navigator.userAgent,
        timestamp: new Date().toISOString(),
        appVersion: appName || appId,
      };

      const response = await fetch('/api/community/detection-feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          app_id: appId,
          feedback_type: selectedType,
          description: description.trim() || null,
          environment_info: environmentInfo,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to submit feedback');
      }

      toast({
        title: 'Feedback submitted',
        description: 'Thank you for helping us improve detection rules!',
      });

      setSubmitted(true);
      setShowForm(false);
      setSelectedType(null);
      setDescription('');
      onFeedbackSubmit?.();
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to submit feedback',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isAuthenticated) {
    return null;
  }

  if (submitted) {
    return (
      <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-xl">
        <div className="flex items-center gap-2 text-green-500">
          <CheckCircle2 className="w-5 h-5" />
          <span className="font-medium">Feedback submitted!</span>
        </div>
        <p className="text-sm text-text-muted mt-1">
          Thank you for helping us improve.
        </p>
      </div>
    );
  }

  if (!showForm) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setShowForm(true)}
        className="w-full"
      >
        <MessageSquare className="w-4 h-4 mr-2" />
        Give feedback on detection rules
      </Button>
    );
  }

  return (
    <div className="p-4 bg-black/5 rounded-xl space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="font-medium text-text-primary">Detection Rule Feedback</h4>
        <button
          onClick={() => {
            setShowForm(false);
            setSelectedType(null);
            setDescription('');
          }}
          className="text-sm text-text-muted hover:text-text-primary"
        >
          Cancel
        </button>
      </div>

      <p className="text-sm text-text-secondary">
        How did the detection rules work for {appName || appId}?
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {feedbackOptions.map((option) => {
          const Icon = option.icon;
          const isSelected = selectedType === option.type;

          return (
            <button
              key={option.type}
              onClick={() => setSelectedType(option.type)}
              className={cn(
                'flex flex-col items-center p-3 rounded-lg border transition-all duration-200',
                isSelected
                  ? option.bgColor
                  : 'border-black/10 hover:border-black/20 hover:bg-black/5'
              )}
            >
              <Icon
                className={cn(
                  'w-6 h-6 mb-1',
                  isSelected ? option.color : 'text-text-muted'
                )}
              />
              <span
                className={cn(
                  'text-sm font-medium',
                  isSelected ? option.color : 'text-text-primary'
                )}
              >
                {option.label}
              </span>
              <span className="text-xs text-text-muted mt-0.5 text-center">
                {option.description}
              </span>
            </button>
          );
        })}
      </div>

      {selectedType && (
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Additional details (optional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                selectedType === 'fails'
                  ? 'Describe what happened (e.g., app shows as not installed, wrong version detected...)'
                  : selectedType === 'improvement'
                  ? 'Suggest how the detection could be improved...'
                  : 'Share any additional details...'
              }
              rows={3}
              maxLength={1000}
              className="w-full px-3 py-2 bg-bg-elevated border border-black/10 rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-cyan/50 resize-none"
            />
            <p className="text-xs text-text-muted text-right mt-1">
              {description.length}/1000
            </p>
          </div>

          <Button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="w-full bg-accent-cyan hover:bg-accent-cyan/90 text-white"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Submitting...
              </>
            ) : (
              'Submit Feedback'
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

export default DeploymentFeedback;
