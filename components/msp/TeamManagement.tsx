'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Users, UserPlus, Loader2, RefreshCw, Mail, Clock, CheckCircle, XCircle, Search, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { MemberCard } from './MemberCard';
import { InviteTeamMember } from './InviteTeamMember';
import { BulkInviteMembers } from './BulkInviteMembers';
import { type MspRole, hasPermission, getRoleDisplayName } from '@/lib/msp-permissions';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { useToast } from '@/hooks/use-toast';

interface Member {
  id: string;
  user_id: string;
  user_email: string;
  user_name: string | null;
  role: MspRole;
  created_at: string;
  is_current_user?: boolean;
}

interface Invitation {
  id: string;
  email: string;
  role: MspRole;
  invited_by_email: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

export function TeamManagement() {
  const [members, setMembers] = useState<Member[]>([]);
  const [pendingInvitations, setPendingInvitations] = useState<Invitation[]>([]);
  const [currentUserRole, setCurrentUserRole] = useState<MspRole>('viewer');
  const [isLoading, setIsLoading] = useState(true);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteMode, setInviteMode] = useState<'single' | 'bulk'>('single');
  const [activeTab, setActiveTab] = useState<'members' | 'invitations'>('members');
  const [searchQuery, setSearchQuery] = useState('');
  const [resendingId, setResendingId] = useState<string | null>(null);

  const { getAccessToken, isAuthenticated } = useMicrosoftAuth();
  const { toast } = useToast();

  const fetchMembers = useCallback(async () => {
    const accessToken = await getAccessToken();
    if (!accessToken) return;

    try {
      const response = await fetch('/api/msp/members', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setMembers(data.members);
        setCurrentUserRole(data.current_user_role);
      }
    } catch (error) {
      console.error('Error fetching members:', error);
    }
  }, [getAccessToken]);

  const fetchInvitations = useCallback(async () => {
    const accessToken = await getAccessToken();
    if (!accessToken) return;

    try {
      const response = await fetch('/api/msp/invitations', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setPendingInvitations(data.pending || []);
      }
    } catch (error) {
      console.error('Error fetching invitations:', error);
    }
  }, [getAccessToken]);

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    await Promise.all([fetchMembers(), fetchInvitations()]);
    setIsLoading(false);
  }, [fetchMembers, fetchInvitations]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchAll();
    }
  }, [isAuthenticated, fetchAll]);

  const handleCancelInvitation = async (invitationId: string) => {
    const accessToken = await getAccessToken();
    if (!accessToken) return;

    try {
      const response = await fetch(`/api/msp/invitations?id=${invitationId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to cancel invitation');
      }

      toast({
        title: 'Invitation cancelled',
        description: 'The invitation has been cancelled.',
      });

      fetchInvitations();
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to cancel invitation',
        variant: 'destructive',
      });
    }
  };

  const handleMemberRoleChange = (memberId: string, newRole: MspRole) => {
    setMembers((prev) =>
      prev.map((m) => (m.id === memberId ? { ...m, role: newRole } : m))
    );
  };

  const handleMemberRemove = (memberId: string) => {
    setMembers((prev) => prev.filter((m) => m.id !== memberId));
  };

  const canInvite = hasPermission(currentUserRole, 'invite_members');

  // Filter members based on search query
  const filteredMembers = useMemo(() => {
    if (!searchQuery.trim()) return members;
    const query = searchQuery.toLowerCase();
    return members.filter(
      (m) =>
        m.user_email.toLowerCase().includes(query) ||
        (m.user_name && m.user_name.toLowerCase().includes(query))
    );
  }, [members, searchQuery]);

  // Resend invitation
  const handleResendInvitation = async (invitation: Invitation) => {
    const accessToken = await getAccessToken();
    if (!accessToken) return;

    setResendingId(invitation.id);

    try {
      // Delete the old invitation
      await fetch(`/api/msp/invitations?id=${invitation.id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      // Create a new one
      const response = await fetch('/api/msp/invitations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          email: invitation.email,
          role: invitation.role,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to resend invitation');
      }

      toast({
        title: 'Invitation resent',
        description: `A new invitation has been sent to ${invitation.email}.`,
      });

      fetchInvitations();
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to resend invitation',
        variant: 'destructive',
      });
    } finally {
      setResendingId(null);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 animate-spin text-accent-cyan" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent-cyan/10 flex items-center justify-center">
            <Users className="w-5 h-5 text-accent-cyan" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-text-primary">Team Management</h2>
            <p className="text-sm text-text-muted">
              {members.length} member{members.length !== 1 ? 's' : ''}
              {pendingInvitations.length > 0 && ` | ${pendingInvitations.length} pending`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchAll}
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
          {canInvite && (
            <Button
              size="sm"
              onClick={() => setShowInviteForm(true)}
              className="bg-accent-cyan hover:bg-accent-cyan/90 text-white"
            >
              <UserPlus className="w-4 h-4 mr-2" />
              Invite Member
            </Button>
          )}
        </div>
      </div>

      {/* Invite form */}
      {showInviteForm && (
        <div className="space-y-3">
          {/* Toggle between single and bulk invite */}
          <div className="flex gap-1 p-1 bg-black/5 rounded-lg w-fit">
            <button
              onClick={() => setInviteMode('single')}
              className={cn(
                'px-4 py-1.5 text-sm font-medium rounded-md transition-colors',
                inviteMode === 'single'
                  ? 'bg-bg-elevated text-text-primary shadow-sm'
                  : 'text-text-muted hover:text-text-primary'
              )}
            >
              Single Invite
            </button>
            <button
              onClick={() => setInviteMode('bulk')}
              className={cn(
                'px-4 py-1.5 text-sm font-medium rounded-md transition-colors',
                inviteMode === 'bulk'
                  ? 'bg-bg-elevated text-text-primary shadow-sm'
                  : 'text-text-muted hover:text-text-primary'
              )}
            >
              Bulk Invite
            </button>
          </div>

          {inviteMode === 'single' ? (
            <InviteTeamMember
              actorRole={currentUserRole}
              onInviteSent={() => {
                fetchInvitations();
                setShowInviteForm(false);
              }}
              onCancel={() => setShowInviteForm(false)}
            />
          ) : (
            <BulkInviteMembers
              actorRole={currentUserRole}
              onInvitesSent={() => {
                fetchInvitations();
                setShowInviteForm(false);
              }}
              onCancel={() => setShowInviteForm(false)}
            />
          )}
        </div>
      )}

      {/* Search and Tabs */}
      <div className="space-y-3">
        {/* Search bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search members by name or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-black/5 border border-black/10 rounded-lg text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-cyan/50 focus:ring-1 focus:ring-accent-cyan/30"
          />
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-black/5 rounded-lg">
          <button
            onClick={() => setActiveTab('members')}
            className={cn(
              'flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors',
              activeTab === 'members'
                ? 'bg-bg-elevated text-text-primary shadow-sm'
                : 'text-text-muted hover:text-text-primary'
            )}
          >
            Members ({members.length})
          </button>
          <button
            onClick={() => setActiveTab('invitations')}
            className={cn(
              'flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors',
              activeTab === 'invitations'
                ? 'bg-bg-elevated text-text-primary shadow-sm'
                : 'text-text-muted hover:text-text-primary'
            )}
          >
            Pending Invitations ({pendingInvitations.length})
          </button>
        </div>
      </div>

      {/* Content */}
      {activeTab === 'members' ? (
        <div className="space-y-3">
          {members.length === 0 ? (
            <div className="p-8 text-center text-text-muted">
              <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No team members found</p>
            </div>
          ) : filteredMembers.length === 0 ? (
            <div className="p-8 text-center text-text-muted">
              <Search className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No members match &quot;{searchQuery}&quot;</p>
              <button
                onClick={() => setSearchQuery('')}
                className="mt-2 text-accent-cyan hover:underline text-sm"
              >
                Clear search
              </button>
            </div>
          ) : (
            filteredMembers.map((member) => (
              <MemberCard
                key={member.id}
                member={member}
                currentUserRole={currentUserRole}
                onRoleChange={handleMemberRoleChange}
                onRemove={handleMemberRemove}
              />
            ))
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {pendingInvitations.length === 0 ? (
            <div className="p-8 text-center text-text-muted">
              <Mail className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No pending invitations</p>
              {canInvite && (
                <button
                  onClick={() => {
                    setActiveTab('members');
                    setShowInviteForm(true);
                  }}
                  className="mt-2 text-accent-cyan hover:underline text-sm"
                >
                  Invite a team member
                </button>
              )}
            </div>
          ) : (
            pendingInvitations.map((invitation) => (
              <div
                key={invitation.id}
                className="flex items-center gap-4 p-4 bg-bg-elevated rounded-xl border border-black/10"
              >
                <div className="w-10 h-10 rounded-full bg-yellow-500/10 flex items-center justify-center">
                  <Clock className="w-5 h-5 text-yellow-500" />
                </div>

                <div className="flex-1 min-w-0">
                  <p className="font-medium text-text-primary">{invitation.email}</p>
                  <p className="text-sm text-text-muted">
                    Invited as {getRoleDisplayName(invitation.role)} by {invitation.invited_by_email.split('@')[0]}
                  </p>
                  <p className="text-xs text-text-muted mt-1">
                    Expires {formatDate(invitation.expires_at)}
                  </p>
                </div>

                {canInvite && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleResendInvitation(invitation)}
                      disabled={resendingId === invitation.id}
                      className="text-accent-cyan hover:text-accent-cyan hover:bg-accent-cyan/10"
                    >
                      {resendingId === invitation.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <Send className="w-4 h-4 mr-1" />
                          Resend
                        </>
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCancelInvitation(invitation.id)}
                      disabled={resendingId === invitation.id}
                      className="text-red-400 hover:text-red-500 hover:bg-red-500/10"
                    >
                      <XCircle className="w-4 h-4 mr-1" />
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default TeamManagement;
