'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Users,
  Monitor,
  Search,
  X,
  Loader2,
  ChevronDown,
  UserCircle,
  ToggleLeft,
  ToggleRight,
  ShieldBan,
  SlidersHorizontal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { useMspOptional } from '@/hooks/useMspOptional';
import type { PackageAssignment } from '@/types/upload';
import type { EntraIDGroup, IntuneAssignmentFilter } from '@/types/intune';

interface AssignmentConfigProps {
  assignments: PackageAssignment[];
  onChange: (assignments: PackageAssignment[]) => void;
}

export function AssignmentConfig({ assignments, onChange }: AssignmentConfigProps) {
  const [enabled, setEnabled] = useState(() => assignments.length > 0);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<EntraIDGroup[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [assignmentMode, setAssignmentMode] = useState<'include' | 'exclude'>('include');

  // Filter state
  const [availableFilters, setAvailableFilters] = useState<IntuneAssignmentFilter[]>([]);
  const [isLoadingFilters, setIsLoadingFilters] = useState(false);
  const [filtersLoaded, setFiltersLoaded] = useState(false);
  const [expandedFilterRow, setExpandedFilterRow] = useState<number | null>(null);

  const { getAccessToken } = useMicrosoftAuth();
  const { isMspUser, selectedTenantId } = useMspOptional();

  // When toggling off, clear assignments
  const handleToggle = () => {
    const newEnabled = !enabled;
    setEnabled(newEnabled);
    if (!newEnabled) {
      onChange([]);
    }
  };

  // Check if specific assignment types are present
  const hasAllDevices = assignments.some((a) => a.type === 'allDevices');
  const hasAllUsers = assignments.some((a) => a.type === 'allUsers');

  // Fetch assignment filters on first interaction
  const loadFilters = useCallback(async () => {
    if (filtersLoaded || isLoadingFilters) return;

    setIsLoadingFilters(true);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) return;

      const response = await fetch('/api/intune/filters', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(isMspUser && selectedTenantId ? { 'X-MSP-Tenant-Id': selectedTenantId } : {}),
        },
      });

      if (response.ok) {
        const data = await response.json();
        setAvailableFilters(data.filters || []);
      }
    } catch (err) {
      console.error('Failed to load assignment filters:', err);
    } finally {
      setIsLoadingFilters(false);
      setFiltersLoaded(true);
    }
  }, [filtersLoaded, isLoadingFilters, getAccessToken, isMspUser, selectedTenantId]);

  // Debounced group search
  const searchGroups = useCallback(
    async (query: string) => {
      if (!query || query.length < 2) {
        setSearchResults([]);
        return;
      }

      setIsSearching(true);
      setSearchError(null);

      try {
        const accessToken = await getAccessToken();
        if (!accessToken) {
          setSearchError('Not authenticated');
          return;
        }

        const response = await fetch(
          `/api/intune/groups?search=${encodeURIComponent(query)}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              ...(isMspUser && selectedTenantId ? { 'X-MSP-Tenant-Id': selectedTenantId } : {}),
            },
          }
        );

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to search groups');
        }

        const data = await response.json();
        setSearchResults(data.groups || []);
      } catch (err) {
        console.error('Group search error:', err);
        setSearchError(err instanceof Error ? err.message : 'Search failed');
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    },
    [getAccessToken, isMspUser, selectedTenantId]
  );

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery) {
        searchGroups(searchQuery);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, searchGroups]);

  // Toggle all devices assignment
  const toggleAllDevices = () => {
    if (hasAllDevices) {
      onChange(assignments.filter((a) => a.type !== 'allDevices'));
    } else {
      onChange([...assignments, { type: 'allDevices', intent: 'required' }]);
    }
  };

  // Toggle all users assignment
  const toggleAllUsers = () => {
    if (hasAllUsers) {
      onChange(assignments.filter((a) => a.type !== 'allUsers'));
    } else {
      onChange([...assignments, { type: 'allUsers', intent: 'available' }]);
    }
  };

  // Check if a group is already added in any mode
  const getGroupAssignmentType = (groupId: string): 'group' | 'exclusionGroup' | null => {
    const existing = assignments.find(
      (a) => (a.type === 'group' || a.type === 'exclusionGroup') && a.groupId === groupId
    );
    if (!existing) return null;
    return existing.type === 'group' || existing.type === 'exclusionGroup' ? existing.type : null;
  };

  // Add a group assignment (include or exclude based on mode)
  const addGroupAssignment = (group: EntraIDGroup) => {
    const existingType = getGroupAssignmentType(group.id);

    // If already added as the same type, skip
    if (
      (assignmentMode === 'include' && existingType === 'group') ||
      (assignmentMode === 'exclude' && existingType === 'exclusionGroup')
    ) {
      return;
    }

    // If added as the opposite type, block it
    if (existingType !== null) {
      return;
    }

    const type = assignmentMode === 'exclude' ? 'exclusionGroup' : 'group';
    const intent = assignmentMode === 'exclude' ? 'required' : 'required';

    onChange([
      ...assignments,
      {
        type,
        intent,
        groupId: group.id,
        groupName: group.displayName,
      },
    ]);

    setSearchQuery('');
    setSearchResults([]);
    setShowDropdown(false);
  };

  // Update assignment intent
  const updateIntent = (index: number, intent: 'required' | 'available' | 'uninstall' | 'updateOnly') => {
    const updated = [...assignments];
    updated[index] = { ...updated[index], intent };
    onChange(updated);
  };

  // Update assignment filter
  const updateFilter = (index: number, filter: IntuneAssignmentFilter | null, filterType?: 'include' | 'exclude') => {
    const updated = [...assignments];
    if (filter) {
      updated[index] = {
        ...updated[index],
        filterId: filter.id,
        filterName: filter.displayName,
        filterType: filterType || updated[index].filterType || 'include',
      };
    } else {
      const { filterId: _, filterName: __, filterType: ___, ...rest } = updated[index];
      updated[index] = rest as PackageAssignment;
    }
    onChange(updated);
    setExpandedFilterRow(null);
  };

  // Update filter type on an existing filter
  const updateFilterType = (index: number, filterType: 'include' | 'exclude') => {
    const updated = [...assignments];
    updated[index] = { ...updated[index], filterType };
    onChange(updated);
  };

  // Remove an assignment
  const removeAssignment = (index: number) => {
    onChange(assignments.filter((_, i) => i !== index));
    if (expandedFilterRow !== null) {
      if (expandedFilterRow === index) {
        setExpandedFilterRow(null);
      } else if (expandedFilterRow > index) {
        setExpandedFilterRow(expandedFilterRow - 1);
      }
    }
  };

  // Get display name for assignment target
  const getTargetDisplay = (assignment: PackageAssignment): string => {
    switch (assignment.type) {
      case 'allUsers':
        return 'All Users';
      case 'allDevices':
        return 'All Devices';
      case 'group':
        return assignment.groupName || 'Unknown Group';
      case 'exclusionGroup':
        return assignment.groupName || 'Unknown Group';
      default:
        return 'Unknown';
    }
  };

  // Get intent color
  const getIntentColor = (intent: string): string => {
    switch (intent) {
      case 'required':
        return 'text-blue-400 bg-blue-500/10 border-blue-500/30';
      case 'available':
        return 'text-green-400 bg-green-500/10 border-green-500/30';
      case 'uninstall':
        return 'text-red-400 bg-red-500/10 border-red-500/30';
      case 'updateOnly':
        return 'text-amber-400 bg-amber-500/10 border-amber-500/30';
      default:
        return 'text-text-muted bg-slate-500/10 border-slate-500/30';
    }
  };

  return (
    <div className="space-y-4">
      {/* Enable/Disable Toggle */}
      <div>
        <button
          type="button"
          onClick={handleToggle}
          className="flex items-center gap-3 w-full p-3 rounded-lg border border-overlay/15 bg-bg-elevated/50 hover:bg-overlay/10 transition-colors"
        >
          {enabled ? (
            <ToggleRight className="w-6 h-6 text-blue-400 flex-shrink-0" />
          ) : (
            <ToggleLeft className="w-6 h-6 text-text-muted flex-shrink-0" />
          )}
          <div className="flex-1 text-left">
            <p className={cn('text-sm font-medium', enabled ? 'text-text-primary' : 'text-text-muted')}>
              Configure Assignments
            </p>
            <p className="text-xs text-text-muted">
              {enabled
                ? 'Assignments will be applied when deployed'
                : 'Deploy without assignments - configure later in Intune'}
            </p>
          </div>
        </button>
      </div>

      {/* Assignment Configuration (shown when enabled) */}
      {enabled && (
        <>
          {/* Quick Assignment Buttons */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Quick Assignment
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={toggleAllDevices}
                className={cn(
                  'flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors',
                  hasAllDevices
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : 'bg-bg-elevated border-overlay/15 text-text-muted hover:border-overlay/20 hover:text-text-primary'
                )}
              >
                <Monitor className="w-4 h-4" />
                <span>All Devices</span>
              </button>
              <button
                type="button"
                onClick={toggleAllUsers}
                className={cn(
                  'flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors',
                  hasAllUsers
                    ? 'bg-green-600 border-green-500 text-white'
                    : 'bg-bg-elevated border-overlay/15 text-text-muted hover:border-overlay/20 hover:text-text-primary'
                )}
              >
                <Users className="w-4 h-4" />
                <span>All Users</span>
              </button>
            </div>
            <p className="text-text-muted text-xs mt-2">
              {hasAllDevices && hasAllUsers && 'Required for all devices, available for all users'}
              {hasAllDevices && !hasAllUsers && 'Required for all devices in tenant'}
              {!hasAllDevices && hasAllUsers && 'Available in Company Portal for all users'}
              {!hasAllDevices && !hasAllUsers && 'Select targets above or add groups below'}
            </p>
          </div>

          {/* Group Search */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Add Group Assignment
            </label>

            {/* Include/Exclude Mode Toggle */}
            <div className="flex items-center gap-1 mb-2">
              <button
                type="button"
                onClick={() => setAssignmentMode('include')}
                className={cn(
                  'px-3 py-1.5 rounded-l-lg border text-xs font-medium transition-colors',
                  assignmentMode === 'include'
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : 'bg-bg-elevated border-overlay/15 text-text-muted hover:text-text-primary'
                )}
              >
                Include
              </button>
              <button
                type="button"
                onClick={() => setAssignmentMode('exclude')}
                className={cn(
                  'px-3 py-1.5 rounded-r-lg border border-l-0 text-xs font-medium transition-colors',
                  assignmentMode === 'exclude'
                    ? 'bg-red-600 border-red-500 text-white'
                    : 'bg-bg-elevated border-overlay/15 text-text-muted hover:text-text-primary'
                )}
              >
                Exclude
              </button>
              <span className="text-text-muted text-xs ml-2">
                {assignmentMode === 'exclude'
                  ? 'Groups will be excluded from the assignment'
                  : 'Groups will be included in the assignment'}
              </span>
            </div>

            <div className="relative">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setShowDropdown(true);
                  }}
                  onFocus={() => setShowDropdown(true)}
                  placeholder="Search Entra ID groups..."
                  className={cn(
                    'w-full pl-10 pr-10 py-2.5 bg-bg-elevated border rounded-lg text-text-primary text-sm placeholder-text-muted focus:outline-none',
                    assignmentMode === 'exclude'
                      ? 'border-red-500/30 focus:border-red-500/50'
                      : 'border-overlay/15 focus:border-overlay/20'
                  )}
                />
                {isSearching && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted animate-spin" />
                )}
              </div>

              {/* Search Results Dropdown */}
              {showDropdown && searchQuery.length >= 2 && (
                <div className="absolute z-20 w-full mt-1 bg-bg-elevated border border-overlay/15 rounded-lg shadow-xl max-h-48 overflow-y-auto">
                  {searchError ? (
                    <div className="px-4 py-3 text-red-400 text-sm">{searchError}</div>
                  ) : searchResults.length === 0 ? (
                    <div className="px-4 py-3 text-text-muted text-sm">
                      {isSearching ? 'Searching...' : 'No groups found'}
                    </div>
                  ) : (
                    searchResults.map((group) => {
                      const existingType = getGroupAssignmentType(group.id);
                      const isAddedSameMode =
                        (assignmentMode === 'include' && existingType === 'group') ||
                        (assignmentMode === 'exclude' && existingType === 'exclusionGroup');
                      const isAddedOppositeMode =
                        (assignmentMode === 'include' && existingType === 'exclusionGroup') ||
                        (assignmentMode === 'exclude' && existingType === 'group');
                      const isDisabled = isAddedSameMode || isAddedOppositeMode;

                      return (
                        <button
                          key={group.id}
                          type="button"
                          onClick={() => !isDisabled && addGroupAssignment(group)}
                          disabled={isDisabled}
                          className={cn(
                            'w-full px-4 py-2 text-left hover:bg-overlay/10 transition-colors flex items-center gap-3',
                            isDisabled && 'opacity-50 cursor-not-allowed'
                          )}
                        >
                          <UserCircle className="w-5 h-5 text-text-muted flex-shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-text-primary text-sm truncate">{group.displayName}</p>
                            {group.description && (
                              <p className="text-text-muted text-xs truncate">{group.description}</p>
                            )}
                          </div>
                          {isAddedSameMode && (
                            <span className="text-xs text-text-muted flex-shrink-0">Added</span>
                          )}
                          {isAddedOppositeMode && (
                            <span className="text-xs text-amber-400 flex-shrink-0">
                              Already {existingType === 'group' ? 'included' : 'excluded'}
                            </span>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Assignment List */}
          {assignments.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Configured Assignments ({assignments.length})
              </label>
              <div className="space-y-2">
                {assignments.map((assignment, index) => {
                  const isExclusion = assignment.type === 'exclusionGroup';

                  return (
                    <div
                      key={`${assignment.type}-${assignment.groupId || index}`}
                      className={cn(
                        'rounded-lg border',
                        isExclusion
                          ? 'bg-red-500/5 border-red-500/20'
                          : 'bg-bg-elevated/50 border-overlay/15'
                      )}
                    >
                      <div className="flex items-center gap-3 p-3">
                        {/* Target Icon */}
                        <div className="flex-shrink-0">
                          {assignment.type === 'allUsers' && (
                            <Users className="w-5 h-5 text-text-muted" />
                          )}
                          {assignment.type === 'allDevices' && (
                            <Monitor className="w-5 h-5 text-text-muted" />
                          )}
                          {assignment.type === 'group' && (
                            <UserCircle className="w-5 h-5 text-text-muted" />
                          )}
                          {isExclusion && (
                            <ShieldBan className="w-5 h-5 text-red-400" />
                          )}
                        </div>

                        {/* Target Name */}
                        <div className="flex-1 min-w-0">
                          <p className={cn(
                            'text-sm font-medium truncate',
                            isExclusion ? 'text-red-300' : 'text-text-primary'
                          )}>
                            {getTargetDisplay(assignment)}
                          </p>
                          <p className={cn(
                            'text-xs',
                            isExclusion ? 'text-red-400/70' : 'text-text-muted'
                          )}>
                            {isExclusion ? 'Excluded' : assignment.type === 'group' ? 'Included' : assignment.type === 'allUsers' ? 'All Users' : assignment.type === 'allDevices' ? 'All Devices' : assignment.type}
                          </p>
                        </div>

                        {/* Intent Dropdown (not shown for exclusion groups) */}
                        {!isExclusion && (
                          <div className="relative flex-shrink-0">
                            <select
                              value={assignment.intent}
                              onChange={(e) =>
                                updateIntent(index, e.target.value as 'required' | 'available' | 'uninstall' | 'updateOnly')
                              }
                              className={cn(
                                'appearance-none pl-3 pr-8 py-1.5 rounded border text-xs font-medium cursor-pointer focus:outline-none',
                                getIntentColor(assignment.intent)
                              )}
                            >
                              <option value="required" className="bg-bg-elevated text-text-primary">
                                Required
                              </option>
                              <option value="available" className="bg-bg-elevated text-text-primary">
                                Available
                              </option>
                              <option value="uninstall" className="bg-bg-elevated text-text-primary">
                                Uninstall
                              </option>
                              <option value="updateOnly" className="bg-bg-elevated text-text-primary">
                                Update Only
                              </option>
                            </select>
                            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none" />
                          </div>
                        )}

                        {/* Exclusion badge */}
                        {isExclusion && (
                          <span className="flex-shrink-0 px-2 py-1 rounded border text-xs font-medium text-red-400 bg-red-500/10 border-red-500/30">
                            Excluded
                          </span>
                        )}

                        {/* Filter button */}
                        <button
                          type="button"
                          onClick={() => {
                            if (expandedFilterRow === index) {
                              setExpandedFilterRow(null);
                            } else {
                              loadFilters();
                              setExpandedFilterRow(index);
                            }
                          }}
                          className={cn(
                            'flex-shrink-0 p-1 rounded transition-colors',
                            assignment.filterId
                              ? 'text-purple-400 hover:text-purple-300'
                              : 'text-text-muted hover:text-text-primary'
                          )}
                          title={assignment.filterId ? `Filter: ${assignment.filterName}` : 'Add filter'}
                        >
                          <SlidersHorizontal className="w-4 h-4" />
                        </button>

                        {/* Remove Button */}
                        <button
                          type="button"
                          onClick={() => removeAssignment(index)}
                          className="flex-shrink-0 text-text-muted hover:text-red-400 transition-colors p-1"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Filter indicator row */}
                      {assignment.filterId && expandedFilterRow !== index && (
                        <div className="px-3 pb-2 flex items-center gap-2">
                          <SlidersHorizontal className="w-3 h-3 text-purple-400 flex-shrink-0" />
                          <span className="text-xs text-purple-400 truncate">
                            Filter: {assignment.filterName}
                          </span>
                          <span className={cn(
                            'text-xs px-1.5 py-0.5 rounded border',
                            assignment.filterType === 'exclude'
                              ? 'text-red-400 bg-red-500/10 border-red-500/30'
                              : 'text-green-400 bg-green-500/10 border-green-500/30'
                          )}>
                            {assignment.filterType === 'exclude' ? 'Exclude' : 'Include'}
                          </span>
                          <button
                            type="button"
                            onClick={() => updateFilter(index, null)}
                            className="text-text-muted hover:text-red-400 transition-colors ml-auto"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      )}

                      {/* Expanded filter picker */}
                      {expandedFilterRow === index && (
                        <div className="px-3 pb-3 border-t border-overlay/10 pt-2">
                          {isLoadingFilters ? (
                            <div className="flex items-center gap-2 text-text-muted text-xs py-2">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              Loading filters...
                            </div>
                          ) : availableFilters.length === 0 ? (
                            <p className="text-text-muted text-xs py-2">
                              No assignment filters available in this tenant.
                            </p>
                          ) : (
                            <div className="space-y-2">
                              <div className="flex items-center gap-2">
                                <select
                                  value={assignment.filterId || ''}
                                  onChange={(e) => {
                                    if (e.target.value === '') {
                                      updateFilter(index, null);
                                    } else {
                                      const filter = availableFilters.find((f) => f.id === e.target.value);
                                      if (filter) {
                                        updateFilter(index, filter);
                                      }
                                    }
                                  }}
                                  className="flex-1 text-xs bg-bg-elevated border border-overlay/15 rounded-lg px-3 py-2 text-text-primary focus:outline-none"
                                >
                                  <option value="">No filter</option>
                                  {availableFilters.map((filter) => (
                                    <option key={filter.id} value={filter.id}>
                                      {filter.displayName} ({filter.platform})
                                    </option>
                                  ))}
                                </select>
                                {assignment.filterId && (
                                  <select
                                    value={assignment.filterType || 'include'}
                                    onChange={(e) => updateFilterType(index, e.target.value as 'include' | 'exclude')}
                                    className="text-xs bg-bg-elevated border border-overlay/15 rounded px-2 py-2 text-text-primary focus:outline-none"
                                  >
                                    <option value="include">Include</option>
                                    <option value="exclude">Exclude</option>
                                  </select>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Update Only Info Banner */}
          {assignments.some((a) => a.intent === 'updateOnly') && (
            <div className="p-3 bg-amber-500/10 rounded-lg border border-amber-500/20 space-y-2">
              <p className="text-amber-400 text-sm">
                <span className="font-medium">Update Only:</span>{' '}
                The app will only install on devices where it is already detected.
                Devices without the app will be skipped.
              </p>
              {assignments.some((a) => a.intent !== 'updateOnly') && (
                <p className="text-amber-400 text-sm">
                  <span className="font-medium">Warning:</span>{' '}
                  Requirement rules apply to the entire app, not individual assignments.
                  Mixing &quot;Update Only&quot; with other intents will gate all assignments
                  behind the existence check. Consider using &quot;Update Only&quot; for all
                  assignments or none.
                </p>
              )}
            </div>
          )}

          {/* Empty State when enabled but no assignments */}
          {assignments.length === 0 && (
            <div className="p-4 bg-bg-elevated/30 rounded-lg border border-overlay/[0.07] text-center">
              <p className="text-text-muted text-sm">
                Select a quick assignment option or search for groups above.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
