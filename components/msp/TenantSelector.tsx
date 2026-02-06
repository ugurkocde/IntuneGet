'use client';

import { useState, useMemo } from 'react';
import { Search, CheckSquare, Square, Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Tenant {
  id: string;
  tenant_id: string | null;
  display_name: string;
  consent_status: string;
  is_active: boolean;
}

interface TenantSelectorProps {
  tenants: Tenant[];
  selectedTenantIds: string[];
  onSelectionChange: (tenantIds: string[]) => void;
  maxSelections?: number;
  disabled?: boolean;
}

export function TenantSelector({
  tenants,
  selectedTenantIds,
  onSelectionChange,
  maxSelections = 50,
  disabled = false,
}: TenantSelectorProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const activeTenants = useMemo(
    () => tenants.filter((t) => t.is_active && t.consent_status === 'granted' && t.tenant_id),
    [tenants]
  );

  const filteredTenants = useMemo(() => {
    if (!searchQuery) return activeTenants;
    const query = searchQuery.toLowerCase();
    return activeTenants.filter((t) =>
      t.display_name.toLowerCase().includes(query)
    );
  }, [activeTenants, searchQuery]);

  const handleToggle = (tenantId: string) => {
    if (disabled) return;

    if (selectedTenantIds.includes(tenantId)) {
      onSelectionChange(selectedTenantIds.filter((id) => id !== tenantId));
    } else {
      if (selectedTenantIds.length >= maxSelections) {
        return; // Don't allow more selections
      }
      onSelectionChange([...selectedTenantIds, tenantId]);
    }
  };

  const handleSelectAll = () => {
    if (disabled) return;
    const allIds = filteredTenants
      .slice(0, maxSelections)
      .map((t) => t.tenant_id)
      .filter((id): id is string => id !== null);
    onSelectionChange(allIds);
  };

  const handleDeselectAll = () => {
    if (disabled) return;
    onSelectionChange([]);
  };

  const allSelected =
    filteredTenants.length > 0 &&
    filteredTenants.every((t) => t.tenant_id && selectedTenantIds.includes(t.tenant_id));

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-text-secondary">
          {selectedTenantIds.length} of {activeTenants.length} tenants selected
          {maxSelections < Infinity && ` (max ${maxSelections})`}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleSelectAll}
            disabled={disabled || allSelected}
            className="text-sm text-accent-cyan hover:text-accent-cyan-bright disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Select all
          </button>
          <span className="text-text-muted">|</span>
          <button
            type="button"
            onClick={handleDeselectAll}
            disabled={disabled || selectedTenantIds.length === 0}
            className="text-sm text-accent-cyan hover:text-accent-cyan-bright disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Deselect all
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
        <input
          type="text"
          placeholder="Search tenants..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          disabled={disabled}
          className="w-full pl-10 pr-4 py-2 rounded-lg border border-black/10 bg-transparent text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-cyan disabled:opacity-50"
        />
      </div>

      {/* Tenant list */}
      <div className="max-h-72 overflow-y-auto rounded-lg border border-black/10">
        {filteredTenants.length === 0 ? (
          <div className="p-6 text-center">
            <Building2 className="w-8 h-8 text-text-muted mx-auto mb-2" />
            <p className="text-sm text-text-muted">
              {searchQuery ? 'No tenants match your search' : 'No active tenants with consent'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-black/5">
            {filteredTenants.map((tenant) => {
              const tenantId = tenant.tenant_id;
              if (!tenantId) return null;
              const isSelected = selectedTenantIds.includes(tenantId);
              const isDisabled =
                disabled ||
                (!isSelected && selectedTenantIds.length >= maxSelections);

              return (
                <button
                  key={tenant.id}
                  type="button"
                  onClick={() => handleToggle(tenantId)}
                  disabled={isDisabled}
                  className={cn(
                    'w-full flex items-center gap-3 p-3 text-left transition-colors',
                    'hover:bg-black/5',
                    isSelected && 'bg-accent-cyan/5',
                    isDisabled && 'opacity-50 cursor-not-allowed'
                  )}
                >
                  {isSelected ? (
                    <CheckSquare className="w-5 h-5 text-accent-cyan flex-shrink-0" />
                  ) : (
                    <Square className="w-5 h-5 text-text-muted flex-shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-text-primary truncate">
                      {tenant.display_name}
                    </p>
                    <p className="text-xs text-text-muted truncate">
                      {tenantId}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
