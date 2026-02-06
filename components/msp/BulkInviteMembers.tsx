'use client';

import { useState } from 'react';
import { Users, Loader2, X, Check, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RoleSelector } from './RoleSelector';
import { type MspRole } from '@/lib/msp-permissions';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { useToast } from '@/hooks/use-toast';

interface BulkInviteMembersProps {
  actorRole: MspRole;
  onInvitesSent?: () => void;
  onCancel?: () => void;
}

interface InviteResult {
  email: string;
  success: boolean;
  error?: string;
}

export function BulkInviteMembers({
  actorRole,
  onInvitesSent,
  onCancel,
}: BulkInviteMembersProps) {
  const [emailsText, setEmailsText] = useState('');
  const [role, setRole] = useState<MspRole>('operator');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<InviteResult[] | null>(null);

  const { getAccessToken } = useMicrosoftAuth();
  const { toast } = useToast();

  // Parse emails from text input (supports comma, semicolon, newline separated)
  const parseEmails = (text: string): string[] => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return text
      .split(/[,;\n]+/)
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.length > 0 && emailRegex.test(email));
  };

  const parsedEmails = parseEmails(emailsText);
  const uniqueEmails = [...new Set(parsedEmails)];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (uniqueEmails.length === 0) {
      setError('Please enter at least one valid email address');
      return;
    }

    if (uniqueEmails.length > 20) {
      setError('Maximum 20 invitations at once');
      return;
    }

    setError(null);
    setIsSubmitting(true);
    setResults(null);

    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setError('Authentication required');
        setIsSubmitting(false);
        return;
      }

      // Send invitations one by one and collect results
      const inviteResults: InviteResult[] = [];

      for (const email of uniqueEmails) {
        try {
          const response = await fetch('/api/msp/invitations', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              email,
              role,
            }),
          });

          const data = await response.json();

          if (!response.ok) {
            inviteResults.push({
              email,
              success: false,
              error: data.error || 'Failed to send invitation',
            });
          } else {
            inviteResults.push({
              email,
              success: true,
            });
          }
        } catch {
          inviteResults.push({
            email,
            success: false,
            error: 'Network error',
          });
        }
      }

      setResults(inviteResults);

      const successCount = inviteResults.filter((r) => r.success).length;
      const failCount = inviteResults.filter((r) => !r.success).length;

      if (successCount > 0) {
        toast({
          title: 'Invitations sent',
          description: `Successfully invited ${successCount} member${successCount !== 1 ? 's' : ''}${failCount > 0 ? `. ${failCount} failed.` : '.'}`,
        });
      }

      if (failCount === 0) {
        onInvitesSent?.();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send invitations');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setEmailsText('');
    setRole('operator');
    setError(null);
    setResults(null);
    onCancel?.();
  };

  // Show results state
  if (results) {
    const successResults = results.filter((r) => r.success);
    const failedResults = results.filter((r) => !r.success);

    return (
      <div className="p-4 bg-bg-elevated rounded-xl border border-black/10">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium text-text-primary">Bulk Invite Results</h3>
          <button
            onClick={handleClose}
            className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-black/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {successResults.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <Check className="w-4 h-4 text-green-500" />
              <span className="text-sm font-medium text-green-500">
                {successResults.length} invitation{successResults.length !== 1 ? 's' : ''} sent
              </span>
            </div>
            <div className="space-y-1 pl-6">
              {successResults.map((result) => (
                <p key={result.email} className="text-sm text-text-secondary">
                  {result.email}
                </p>
              ))}
            </div>
          </div>
        )}

        {failedResults.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="w-4 h-4 text-red-500" />
              <span className="text-sm font-medium text-red-500">
                {failedResults.length} invitation{failedResults.length !== 1 ? 's' : ''} failed
              </span>
            </div>
            <div className="space-y-1 pl-6">
              {failedResults.map((result) => (
                <p key={result.email} className="text-sm text-text-secondary">
                  {result.email} - <span className="text-red-400">{result.error}</span>
                </p>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-2">
          {failedResults.length > 0 && (
            <Button
              onClick={() => {
                setEmailsText(failedResults.map((r) => r.email).join('\n'));
                setResults(null);
              }}
              variant="outline"
              className="flex-1"
            >
              Retry Failed
            </Button>
          )}
          <Button onClick={handleClose} className="flex-1">
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 bg-bg-elevated rounded-xl border border-black/10">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-accent-cyan" />
          <h3 className="font-medium text-text-primary">Bulk Invite Members</h3>
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
            htmlFor="emails"
            className="block text-sm font-medium text-text-secondary mb-1"
          >
            Email Addresses <span className="text-red-400">*</span>
          </label>
          <textarea
            id="emails"
            value={emailsText}
            onChange={(e) => setEmailsText(e.target.value)}
            placeholder="Enter email addresses (one per line, or separated by commas)"
            rows={5}
            className="w-full px-3 py-2 bg-black/5 border border-black/10 rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-cyan/50 focus:ring-1 focus:ring-accent-cyan/30 resize-none font-mono text-sm"
            disabled={isSubmitting}
          />
          <p className="mt-1 text-xs text-text-muted">
            {uniqueEmails.length > 0 ? (
              <span className="text-accent-cyan">
                {uniqueEmails.length} valid email{uniqueEmails.length !== 1 ? 's' : ''} detected
              </span>
            ) : (
              'Separate emails with commas, semicolons, or new lines. Maximum 20 at once.'
            )}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">
            Role (applies to all)
          </label>
          <RoleSelector
            value={role}
            onChange={setRole}
            actorRole={actorRole}
            disabled={isSubmitting}
            excludeOwner
          />
        </div>

        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <Button
            type="submit"
            disabled={isSubmitting || uniqueEmails.length === 0}
            className="flex-1 bg-accent-cyan hover:bg-accent-cyan/90 text-white"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Sending {uniqueEmails.length} invitation{uniqueEmails.length !== 1 ? 's' : ''}...
              </>
            ) : (
              <>
                <Users className="w-4 h-4 mr-2" />
                Invite {uniqueEmails.length || ''} Member{uniqueEmails.length !== 1 ? 's' : ''}
              </>
            )}
          </Button>
          {onCancel && (
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

export default BulkInviteMembers;
