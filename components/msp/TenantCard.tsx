'use client';

import { Building2, CheckCircle2, Clock, XCircle, MoreVertical, Trash2, Link2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TenantCardProps } from '@/types/msp';
import { getConsentStatusDisplay, getConsentStatusColor, isTenantActive } from '@/types/msp';
import { useState, useRef, useEffect } from 'react';

export function TenantCard({ tenant, onSelect, onRemove, onGetConsentUrl, isSelected }: TenantCardProps) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const isActive = isTenantActive(tenant);
  const isPending = tenant.consent_status === 'pending';
  const isIncomplete = tenant.consent_status === 'consent_incomplete';
  const canGetConsentUrl = isPending || isIncomplete;

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = () => {
    if (isActive && onSelect && tenant.tenant_id) {
      onSelect(tenant.tenant_id);
    }
  };

  const handleRemove = () => {
    if (onRemove) {
      onRemove(tenant.id);
    }
    setShowMenu(false);
  };

  const handleGetConsentUrl = () => {
    if (onGetConsentUrl) {
      onGetConsentUrl(tenant.id);
    }
    setShowMenu(false);
  };

  const getStatusIcon = () => {
    switch (tenant.consent_status) {
      case 'granted':
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case 'pending':
        return <Clock className="w-4 h-4 text-yellow-500" />;
      case 'consent_incomplete':
        return <AlertTriangle className="w-4 h-4 text-orange-500" />;
      case 'revoked':
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return null;
    }
  };

  return (
    <div
      className={cn(
        'relative group p-4 rounded-xl border transition-all duration-200',
        isSelected
          ? 'bg-accent-cyan/10 border-accent-cyan/30'
          : 'bg-black/5 border-black/10 hover:border-black/20',
        isActive && 'cursor-pointer'
      )}
      onClick={handleSelect}
    >
      {/* Selected indicator */}
      {isSelected && (
        <div className="absolute top-3 right-3 w-2 h-2 rounded-full bg-accent-cyan shadow-glow-cyan" />
      )}

      {/* Menu button */}
      <div ref={menuRef} className="absolute top-3 right-3">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowMenu(!showMenu);
          }}
          className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-black/10 transition-colors opacity-0 group-hover:opacity-100"
        >
          <MoreVertical className="w-4 h-4" />
        </button>

        {showMenu && (
          <div className="absolute top-full right-0 mt-1 w-48 bg-bg-elevated border border-black/10 rounded-lg shadow-xl z-10 overflow-hidden">
            {canGetConsentUrl && onGetConsentUrl && (
              <button
                onClick={handleGetConsentUrl}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:bg-black/5 transition-colors"
              >
                <Link2 className="w-4 h-4" />
                Get Consent URL
              </button>
            )}
            {onRemove && (
              <button
                onClick={handleRemove}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                Remove tenant
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className={cn(
          'flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center',
          isActive ? 'bg-accent-cyan/20' : 'bg-black/10'
        )}>
          <Building2 className={cn(
            'w-5 h-5',
            isActive ? 'text-accent-cyan' : 'text-text-secondary'
          )} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-text-primary truncate">{tenant.display_name}</h3>
          </div>

          {tenant.tenant_name && (
            <p className="text-sm text-text-muted truncate">{tenant.tenant_name}</p>
          )}

          {/* Status */}
          <div className="flex items-center gap-1.5 mt-2">
            {getStatusIcon()}
            <span className={cn('text-xs', getConsentStatusColor(tenant.consent_status))}>
              {getConsentStatusDisplay(tenant.consent_status)}
            </span>
          </div>

          {/* Notes */}
          {tenant.notes && (
            <p className="text-xs text-text-muted mt-2 line-clamp-2">{tenant.notes}</p>
          )}

          {/* Stats for active tenants */}
          {isActive && (
            <div className="flex items-center gap-4 mt-3 text-xs text-text-muted">
              {typeof tenant.total_jobs === 'number' && (
                <span>{tenant.total_jobs} jobs</span>
              )}
              {typeof tenant.completed_jobs === 'number' && (
                <span className="text-green-500">{tenant.completed_jobs} completed</span>
              )}
              {typeof tenant.failed_jobs === 'number' && tenant.failed_jobs > 0 && (
                <span className="text-red-500">{tenant.failed_jobs} failed</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default TenantCard;
