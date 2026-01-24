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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import type { PackageAssignment } from '@/types/upload';
import type { EntraIDGroup } from '@/types/intune';

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

  const { getAccessToken } = useMicrosoftAuth();

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
    [getAccessToken]
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

  // Add a group assignment
  const addGroupAssignment = (group: EntraIDGroup) => {
    // Check if already added
    if (assignments.some((a) => a.type === 'group' && a.groupId === group.id)) {
      return;
    }

    onChange([
      ...assignments,
      {
        type: 'group',
        intent: 'required',
        groupId: group.id,
        groupName: group.displayName,
      },
    ]);

    setSearchQuery('');
    setSearchResults([]);
    setShowDropdown(false);
  };

  // Update assignment intent
  const updateIntent = (index: number, intent: 'required' | 'available' | 'uninstall') => {
    const updated = [...assignments];
    updated[index] = { ...updated[index], intent };
    onChange(updated);
  };

  // Remove an assignment
  const removeAssignment = (index: number) => {
    onChange(assignments.filter((_, i) => i !== index));
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
      default:
        return 'text-slate-400 bg-slate-500/10 border-slate-500/30';
    }
  };

  return (
    <div className="space-y-4">
      {/* Enable/Disable Toggle */}
      <div>
        <button
          type="button"
          onClick={handleToggle}
          className="flex items-center gap-3 w-full p-3 rounded-lg border border-slate-700 bg-slate-800/50 hover:bg-slate-800 transition-colors"
        >
          {enabled ? (
            <ToggleRight className="w-6 h-6 text-blue-400 flex-shrink-0" />
          ) : (
            <ToggleLeft className="w-6 h-6 text-slate-500 flex-shrink-0" />
          )}
          <div className="flex-1 text-left">
            <p className={cn('text-sm font-medium', enabled ? 'text-white' : 'text-slate-400')}>
              Configure Assignments
            </p>
            <p className="text-xs text-slate-500">
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
            <label className="block text-sm font-medium text-slate-300 mb-2">
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
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600 hover:text-white'
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
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600 hover:text-white'
                )}
              >
                <Users className="w-4 h-4" />
                <span>All Users</span>
              </button>
            </div>
            <p className="text-slate-500 text-xs mt-2">
              {hasAllDevices && hasAllUsers && 'Required for all devices, available for all users'}
              {hasAllDevices && !hasAllUsers && 'Required for all devices in tenant'}
              {!hasAllDevices && hasAllUsers && 'Available in Company Portal for all users'}
              {!hasAllDevices && !hasAllUsers && 'Select targets above or add groups below'}
            </p>
          </div>

          {/* Group Search */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Add Group Assignment
            </label>
            <div className="relative">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setShowDropdown(true);
                  }}
                  onFocus={() => setShowDropdown(true)}
                  placeholder="Search Entra ID groups..."
                  className="w-full pl-10 pr-10 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-500 focus:border-slate-600 focus:outline-none"
                />
                {isSearching && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 animate-spin" />
                )}
              </div>

              {/* Search Results Dropdown */}
              {showDropdown && searchQuery.length >= 2 && (
                <div className="absolute z-20 w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-xl max-h-48 overflow-y-auto">
                  {searchError ? (
                    <div className="px-4 py-3 text-red-400 text-sm">{searchError}</div>
                  ) : searchResults.length === 0 ? (
                    <div className="px-4 py-3 text-slate-500 text-sm">
                      {isSearching ? 'Searching...' : 'No groups found'}
                    </div>
                  ) : (
                    searchResults.map((group) => {
                      const isAdded = assignments.some(
                        (a) => a.type === 'group' && a.groupId === group.id
                      );
                      return (
                        <button
                          key={group.id}
                          type="button"
                          onClick={() => !isAdded && addGroupAssignment(group)}
                          disabled={isAdded}
                          className={cn(
                            'w-full px-4 py-2 text-left hover:bg-slate-700 transition-colors flex items-center gap-3',
                            isAdded && 'opacity-50 cursor-not-allowed'
                          )}
                        >
                          <UserCircle className="w-5 h-5 text-slate-400 flex-shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-white text-sm truncate">{group.displayName}</p>
                            {group.description && (
                              <p className="text-slate-500 text-xs truncate">{group.description}</p>
                            )}
                          </div>
                          {isAdded && (
                            <span className="text-xs text-slate-500 flex-shrink-0">Added</span>
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
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Configured Assignments ({assignments.length})
              </label>
              <div className="space-y-2">
                {assignments.map((assignment, index) => (
                  <div
                    key={`${assignment.type}-${assignment.groupId || index}`}
                    className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-lg border border-slate-700"
                  >
                    {/* Target Icon */}
                    <div className="flex-shrink-0">
                      {assignment.type === 'allUsers' && (
                        <Users className="w-5 h-5 text-slate-400" />
                      )}
                      {assignment.type === 'allDevices' && (
                        <Monitor className="w-5 h-5 text-slate-400" />
                      )}
                      {assignment.type === 'group' && (
                        <UserCircle className="w-5 h-5 text-slate-400" />
                      )}
                    </div>

                    {/* Target Name */}
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium truncate">
                        {getTargetDisplay(assignment)}
                      </p>
                      <p className="text-slate-500 text-xs capitalize">{assignment.type}</p>
                    </div>

                    {/* Intent Dropdown */}
                    <div className="relative flex-shrink-0">
                      <select
                        value={assignment.intent}
                        onChange={(e) =>
                          updateIntent(index, e.target.value as 'required' | 'available' | 'uninstall')
                        }
                        className={cn(
                          'appearance-none pl-3 pr-8 py-1.5 rounded border text-xs font-medium cursor-pointer focus:outline-none',
                          getIntentColor(assignment.intent)
                        )}
                      >
                        <option value="required" className="bg-slate-800 text-white">
                          Required
                        </option>
                        <option value="available" className="bg-slate-800 text-white">
                          Available
                        </option>
                        <option value="uninstall" className="bg-slate-800 text-white">
                          Uninstall
                        </option>
                      </select>
                      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none" />
                    </div>

                    {/* Remove Button */}
                    <button
                      type="button"
                      onClick={() => removeAssignment(index)}
                      className="flex-shrink-0 text-slate-500 hover:text-red-400 transition-colors p-1"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty State when enabled but no assignments */}
          {assignments.length === 0 && (
            <div className="p-4 bg-slate-800/30 rounded-lg border border-slate-700/50 text-center">
              <p className="text-slate-500 text-sm">
                Select a quick assignment option or search for groups above.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
