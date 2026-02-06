'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Building2, Check, Plus, Settings } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { useMspOptional } from '@/contexts/MspContext';
import { useSelectedTenant } from '@/hooks/useSelectedTenant';
import type { TenantSwitcherProps } from '@/types/msp';
import { getConsentStatusColor } from '@/types/msp';

export function TenantSwitcher({ className }: TenantSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const context = useMspOptional();
  const { selectedTenant, selectableTenants, select } = useSelectedTenant();

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Don't render if not an MSP user or no context
  if (!context || !context.isMspUser || context.isLoadingOrganization) {
    return null;
  }

  // Don't show if only one tenant
  if (selectableTenants.length <= 1) {
    return null;
  }

  const handleSelect = (tenantId: string) => {
    select(tenantId);
    setIsOpen(false);
  };

  return (
    <div ref={dropdownRef} className={cn('relative', className)}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-black/5 hover:bg-black/10 border border-black/10 transition-all duration-200"
      >
        <Building2 className="w-4 h-4 text-accent-cyan" />
        <span className="text-sm font-medium text-text-primary max-w-[150px] truncate">
          {selectedTenant?.display_name || 'Select Tenant'}
        </span>
        <ChevronDown className={cn(
          'w-4 h-4 text-text-secondary transition-transform duration-200',
          isOpen && 'rotate-180'
        )} />
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div className="absolute top-full right-0 mt-2 w-64 bg-bg-surface border border-black/10 rounded-lg shadow-xl z-50 overflow-hidden animate-fade-in">
          <div className="p-2 border-b border-black/5">
            <p className="text-xs text-text-muted px-2 py-1">Switch tenant</p>
          </div>

          <div className="max-h-64 overflow-y-auto p-1">
            {selectableTenants.map((tenant) => (
              <button
                key={tenant.id}
                onClick={() => tenant.tenant_id && handleSelect(tenant.tenant_id)}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors',
                  selectedTenant?.id === tenant.id
                    ? 'bg-accent-cyan/10 text-text-primary'
                    : 'text-text-secondary hover:bg-black/5 hover:text-text-primary'
                )}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{tenant.display_name}</p>
                  {tenant.tenant_name && (
                    <p className="text-xs text-text-muted truncate">{tenant.tenant_name}</p>
                  )}
                </div>
                {selectedTenant?.id === tenant.id && (
                  <Check className="w-4 h-4 text-accent-cyan flex-shrink-0" />
                )}
              </button>
            ))}
          </div>

          <div className="p-2 border-t border-black/5 space-y-1">
            <Link
              href="/dashboard/msp/tenants/add"
              className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-text-secondary hover:text-text-primary hover:bg-black/5 transition-colors"
              onClick={() => setIsOpen(false)}
            >
              <Plus className="w-4 h-4" />
              Add customer tenant
            </Link>
            <Link
              href="/dashboard/msp/tenants"
              className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-text-secondary hover:text-text-primary hover:bg-black/5 transition-colors"
              onClick={() => setIsOpen(false)}
            >
              <Settings className="w-4 h-4" />
              Manage tenants
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

export default TenantSwitcher;
