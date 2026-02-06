'use client';

import { useState } from 'react';
import { Send, Loader2, X, Copy, Check, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RoleSelector } from './RoleSelector';
import { type MspRole } from '@/lib/msp-permissions';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { useToast } from '@/hooks/use-toast';

interface InviteTeamMemberProps {
  actorRole: MspRole;
  onInviteSent?: () => void;
  onCancel?: () => void;
}

export function InviteTeamMember({
  actorRole,
  onInviteSent,
  onCancel,
}: InviteTeamMemberProps) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MspRole>('operator');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acceptUrl, setAcceptUrl] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const { getAccessToken } = useMicrosoftAuth();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email.trim()) {
      setError('Email is required');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      setError('Invalid email format');
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setError('Authentication required');
        setIsSubmitting(false);
        return;
      }

      const response = await fetch('/api/msp/invitations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          email: email.trim(),
          role,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send invitation');
      }

      // Track email sent status and URL
      setEmailSent(data.emailSent || false);
      if (data.acceptUrl) {
        setAcceptUrl(data.acceptUrl);
      }

      toast({
        title: data.emailSent ? 'Invitation sent' : 'Invitation created',
        description: data.emailSent
          ? `An invitation email has been sent to ${email}.`
          : `Share the invitation link with ${email}.`,
      });

      onInviteSent?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send invitation');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyUrl = async () => {
    if (acceptUrl) {
      await navigator.clipboard.writeText(acceptUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleClose = () => {
    setEmail('');
    setRole('operator');
    setError(null);
    setAcceptUrl(null);
    setEmailSent(false);
    onCancel?.();
  };

  // Show success state
  if (emailSent || acceptUrl) {
    return (
      <div className="p-4 bg-bg-elevated rounded-xl border border-black/10">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium text-text-primary">
            {emailSent ? 'Invitation Sent' : 'Invitation Created'}
          </h3>
          <button
            onClick={handleClose}
            className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-black/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {emailSent ? (
          <>
            <div className="flex items-center gap-3 p-4 bg-green-500/10 border border-green-500/20 rounded-lg mb-4">
              <Check className="w-5 h-5 text-green-500 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-green-500">Email sent successfully</p>
                <p className="text-sm text-text-secondary">
                  An invitation email has been sent to <strong>{email}</strong>
                </p>
              </div>
            </div>
            <p className="text-xs text-text-muted">
              The invitation will expire in 7 days. The recipient must sign in with their Microsoft account.
            </p>
          </>
        ) : acceptUrl ? (
          <>
            <p className="text-sm text-text-secondary mb-3">
              Share this link with {email} to invite them to your organization:
            </p>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={acceptUrl}
                readOnly
                className="flex-1 px-3 py-2 bg-black/5 border border-black/10 rounded-lg text-sm text-text-primary font-mono"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyUrl}
                className="flex-shrink-0"
              >
                {copied ? (
                  <Check className="w-4 h-4 text-green-500" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </Button>
            </div>

            <p className="text-xs text-text-muted mt-3">
              This link will expire in 7 days. The recipient must sign in with their {email} Microsoft account.
            </p>
          </>
        ) : null}

        <Button onClick={handleClose} className="w-full mt-4">
          Done
        </Button>
      </div>
    );
  }

  return (
    <div className="p-4 bg-bg-elevated rounded-xl border border-black/10">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-medium text-text-primary">Invite Team Member</h3>
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
            htmlFor="email"
            className="block text-sm font-medium text-text-secondary mb-1"
          >
            Email Address <span className="text-red-400">*</span>
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="colleague@yourcompany.com"
            className="w-full px-3 py-2 bg-black/5 border border-black/10 rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-cyan/50 focus:ring-1 focus:ring-accent-cyan/30"
            disabled={isSubmitting}
          />
          <p className="mt-1 text-xs text-text-muted">
            The invited user must have a Microsoft account with this email from your organization&apos;s tenant.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">
            Role
          </label>
          <RoleSelector
            value={role}
            onChange={setRole}
            actorRole={actorRole}
            disabled={isSubmitting}
            excludeOwner
          />
        </div>

        {/* Email Preview Toggle */}
        <div>
          <button
            type="button"
            onClick={() => setShowPreview(!showPreview)}
            className="flex items-center gap-2 text-sm text-text-muted hover:text-text-primary transition-colors"
          >
            {showPreview ? (
              <>
                <EyeOff className="w-4 h-4" />
                Hide email preview
              </>
            ) : (
              <>
                <Eye className="w-4 h-4" />
                Preview invitation email
              </>
            )}
          </button>

          {showPreview && (
            <div className="mt-3 p-4 bg-white rounded-lg border border-black/10 text-sm">
              <div className="border-b border-gray-200 pb-3 mb-3">
                <p className="text-gray-500 text-xs mb-1">Subject:</p>
                <p className="font-medium text-gray-900">
                  You&apos;ve been invited to join your organization on IntuneGet
                </p>
              </div>
              <div className="space-y-3 text-gray-700">
                <p>Hi there,</p>
                <p>
                  You&apos;ve been invited to join <strong>your organization</strong> on IntuneGet as a{' '}
                  <strong>{role.charAt(0).toUpperCase() + role.slice(1)}</strong>.
                </p>
                <div className="py-3">
                  <span className="inline-block px-6 py-3 bg-[#00D9FF] text-white font-medium rounded-lg">
                    Accept Invitation
                  </span>
                </div>
                <p className="text-gray-500 text-xs">
                  This invitation expires in 7 days. If you didn&apos;t expect this invitation, you can ignore this email.
                </p>
              </div>
              <div className="mt-4 pt-3 border-t border-gray-200 text-xs text-gray-400">
                Sent via IntuneGet
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <Button
            type="submit"
            disabled={isSubmitting}
            className="flex-1 bg-accent-cyan hover:bg-accent-cyan/90 text-white"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Sending...
              </>
            ) : (
              <>
                <Send className="w-4 h-4 mr-2" />
                Send Invitation
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

export default InviteTeamMember;
