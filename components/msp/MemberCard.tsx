'use client';

import { useState } from 'react';
import { User, MoreVertical, Trash2, Shield, Crown, Loader2, Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { RoleSelector } from './RoleSelector';
import {
  type MspRole,
  type AccessMode,
  getRoleDisplayName,
  getRoleColor,
  getAccessModeDisplayName,
  hasPermission,
  canModifyRole,
} from '@/lib/msp-permissions';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { useToast } from '@/hooks/use-toast';

interface Member {
  id: string;
  user_id: string;
  user_email: string;
  user_name: string | null;
  role: MspRole;
  access_mode?: AccessMode;
  created_at: string;
  is_current_user?: boolean;
}

interface MemberCardProps {
  member: Member;
  currentUserRole: MspRole;
  onRoleChange?: (memberId: string, newRole: MspRole) => void;
  onAccessModeChange?: (memberId: string, newAccessMode: AccessMode) => void;
  onRemove?: (memberId: string) => void;
}

export function MemberCard({
  member,
  currentUserRole,
  onRoleChange,
  onAccessModeChange,
  onRemove,
}: MemberCardProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [showConfirmRemove, setShowConfirmRemove] = useState(false);
  const [isChangingRole, setIsChangingRole] = useState(false);
  const [isChangingAccessMode, setIsChangingAccessMode] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

  const { getAccessToken } = useMicrosoftAuth();
  const { toast } = useToast();

  const accessMode: AccessMode = member.access_mode || 'full';

  const canEditRole = hasPermission(currentUserRole, 'change_roles') &&
    !member.is_current_user &&
    canModifyRole(currentUserRole, member.role);

  const canRemove = hasPermission(currentUserRole, 'remove_members') &&
    !member.is_current_user &&
    member.role !== 'owner' &&
    canModifyRole(currentUserRole, member.role);

  const handleRoleChange = async (newRole: MspRole) => {
    const accessToken = await getAccessToken();
    if (!accessToken) return;

    setIsChangingRole(true);
    try {
      const response = await fetch(`/api/msp/members/${member.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ role: newRole }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to change role');
      }

      toast({
        title: 'Role updated',
        description: `${member.user_email}'s role has been changed to ${getRoleDisplayName(newRole)}.`,
      });

      onRoleChange?.(member.id, newRole);
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to change role',
        variant: 'destructive',
      });
    } finally {
      setIsChangingRole(false);
    }
  };

  const handleAccessModeToggle = async () => {
    const newAccessMode: AccessMode = accessMode === 'full' ? 'customer_only' : 'full';

    const accessToken = await getAccessToken();
    if (!accessToken) return;

    setIsChangingAccessMode(true);
    try {
      const response = await fetch(`/api/msp/members/${member.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ access_mode: newAccessMode }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to change tenant access');
      }

      toast({
        title: 'Tenant access updated',
        description: `${member.user_email}'s tenant access has been changed to ${getAccessModeDisplayName(newAccessMode)}.`,
      });

      onAccessModeChange?.(member.id, newAccessMode);
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to change tenant access',
        variant: 'destructive',
      });
    } finally {
      setIsChangingAccessMode(false);
    }
  };

  const handleRemove = async () => {
    const accessToken = await getAccessToken();
    if (!accessToken) return;

    setIsRemoving(true);
    try {
      const response = await fetch(`/api/msp/members/${member.id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to remove member');
      }

      toast({
        title: 'Member removed',
        description: `${member.user_email} has been removed from the organization.`,
      });

      onRemove?.(member.id);
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to remove member',
        variant: 'destructive',
      });
    } finally {
      setIsRemoving(false);
      setShowMenu(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const getRoleIcon = (role: MspRole) => {
    if (role === 'owner') return Crown;
    if (role === 'admin') return Shield;
    return User;
  };

  const RoleIcon = getRoleIcon(member.role);

  return (
    <div
      className={cn(
        'relative flex items-center gap-4 p-4 bg-bg-elevated rounded-xl border transition-all duration-200',
        member.is_current_user
          ? 'border-accent-cyan/30 bg-accent-cyan/5'
          : 'border-overlay/10'
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          'flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center',
          getRoleColor(member.role).split(' ')[1]
        )}
      >
        <RoleIcon className={cn('w-5 h-5', getRoleColor(member.role).split(' ')[0])} />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-text-primary truncate">
            {member.user_name || member.user_email.split('@')[0]}
          </span>
          {member.is_current_user && (
            <span className="text-xs text-accent-cyan">(you)</span>
          )}
        </div>
        <p className="text-sm text-text-muted truncate">{member.user_email}</p>
        <p className="text-xs text-text-muted mt-1">
          Joined {formatDate(member.created_at)}
        </p>
      </div>

      {/* Role and tenant access */}
      <div className="flex-shrink-0 w-32 space-y-1.5">
        {canEditRole ? (
          <>
            <RoleSelector
              value={member.role}
              onChange={handleRoleChange}
              actorRole={currentUserRole}
              disabled={isChangingRole}
              excludeOwner
            />
            <button
              type="button"
              onClick={handleAccessModeToggle}
              disabled={isChangingAccessMode}
              title={
                accessMode === 'customer_only'
                  ? 'Limited to customer tenants. Click to grant full access.'
                  : 'Has full tenant access. Click to limit to customer tenants.'
              }
              className={cn(
                'w-full flex items-center gap-1 px-2 py-1 text-xs rounded-md border transition-colors',
                isChangingAccessMode && 'opacity-50 cursor-wait',
                accessMode === 'customer_only'
                  ? 'text-orange-500 bg-orange-500/10 border-orange-500/20 hover:bg-orange-500/20'
                  : 'text-text-muted bg-overlay/5 border-overlay/10 hover:bg-overlay/10'
              )}
            >
              {isChangingAccessMode ? (
                <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" />
              ) : (
                <Building2 className="w-3 h-3 flex-shrink-0" />
              )}
              <span className="truncate">{getAccessModeDisplayName(accessMode)}</span>
            </button>
          </>
        ) : (
          <>
            <span
              className={cn(
                'inline-flex items-center px-2.5 py-1 text-sm rounded-full font-medium',
                getRoleColor(member.role)
              )}
            >
              {getRoleDisplayName(member.role)}
            </span>
            {accessMode === 'customer_only' && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full font-medium text-orange-500 bg-orange-500/10">
                <Building2 className="w-3 h-3 flex-shrink-0" />
                <span className="truncate">{getAccessModeDisplayName(accessMode)}</span>
              </span>
            )}
          </>
        )}
      </div>

      {/* Actions */}
      {canRemove && (
        <div className="relative flex-shrink-0">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-overlay/10 transition-colors"
          >
            <MoreVertical className="w-4 h-4" />
          </button>

          {showMenu && (
            <div className="absolute top-full right-0 mt-1 w-40 bg-bg-elevated border border-overlay/10 rounded-lg shadow-xl z-10 overflow-hidden">
              <button
                onClick={() => {
                  setShowMenu(false);
                  setShowConfirmRemove(true);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                Remove member
              </button>
            </div>
          )}
        </div>
      )}

      {/* Confirm Remove Dialog */}
      {showConfirmRemove && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-bg-elevated rounded-xl border border-overlay/10 p-6 max-w-sm w-full shadow-2xl">
            <h3 className="text-lg font-semibold text-text-primary mb-2">Remove Team Member?</h3>
            <p className="text-sm text-text-secondary mb-4">
              Are you sure you want to remove <strong>{member.user_name || member.user_email}</strong> from the organization? They will lose access to all MSP features.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirmRemove(false)}
                disabled={isRemoving}
                className="flex-1 px-4 py-2 text-sm font-medium text-text-primary bg-overlay/5 hover:bg-overlay/10 rounded-lg transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  handleRemove();
                  setShowConfirmRemove(false);
                }}
                disabled={isRemoving}
                className="flex-1 px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isRemoving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Removing...
                  </>
                ) : (
                  'Remove'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MemberCard;
