'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Loader2,
  RefreshCw,
  Search,
  Shield,
  ToggleLeft,
  ToggleRight,
  Check,
  AlertTriangle,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEspProfiles, useAddToEsp } from '@/hooks/use-esp-profiles';
import type { EspProfileSelection, EspProfileSummary, AddToEspResult } from '@/types/esp';

interface EspProfileSelectorProps {
  espProfiles?: EspProfileSelection[];
  onChange?: (profiles: EspProfileSelection[]) => void;
  intuneAppId?: string;
  mode: 'pre-deploy' | 'post-deploy';
  hasRequiredAssignment?: boolean;
}

export function EspProfileSelector({
  espProfiles = [],
  onChange,
  intuneAppId,
  mode,
  hasRequiredAssignment = true,
}: EspProfileSelectorProps) {
  const [enabled, setEnabled] = useState(() => espProfiles.length > 0);
  const [query, setQuery] = useState('');
  const [addResults, setAddResults] = useState<AddToEspResult[] | null>(null);

  // Sync enabled state when parent resets espProfiles externally
  useEffect(() => {
    if (espProfiles.length === 0 && enabled) {
      setEnabled(false);
    } else if (espProfiles.length > 0 && !enabled) {
      setEnabled(true);
    }
    // Only react to espProfiles changes, not enabled
  }, [espProfiles.length]);

  const {
    data: profilesData,
    isLoading,
    error: queryError,
    refetch,
  } = useEspProfiles();

  const addToEspMutation = useAddToEsp();

  const availableProfiles = useMemo(() => {
    return (profilesData?.profiles || [])
      .filter((p) => p?.id && p?.displayName)
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [profilesData]);

  const error = queryError?.message || null;

  const selectedIds = useMemo(
    () => new Set(espProfiles.map((p) => p.id)),
    [espProfiles]
  );

  const filteredProfiles = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return availableProfiles;
    return availableProfiles.filter((p) =>
      p.displayName.toLowerCase().includes(normalizedQuery)
    );
  }, [availableProfiles, query]);

  const handleToggleEnabled = () => {
    const next = !enabled;
    setEnabled(next);
    if (!next) {
      onChange?.([]);
    }
  };

  const toggleProfile = (profile: EspProfileSummary) => {
    if (selectedIds.has(profile.id)) {
      onChange?.(espProfiles.filter((p) => p.id !== profile.id));
    } else {
      onChange?.([...espProfiles, { id: profile.id, displayName: profile.displayName }]);
    }
  };

  // Post-deploy mode: selected profiles managed locally
  const [postDeploySelections, setPostDeploySelections] = useState<Set<string>>(new Set());

  const togglePostDeployProfile = (profile: EspProfileSummary) => {
    setPostDeploySelections((prev) => {
      const next = new Set(prev);
      if (next.has(profile.id)) {
        next.delete(profile.id);
      } else {
        next.add(profile.id);
      }
      return next;
    });
  };

  const handleAddToEsp = async () => {
    if (!intuneAppId || postDeploySelections.size === 0) return;
    setAddResults(null);

    try {
      const profileIds = Array.from(postDeploySelections);
      const profileNames: Record<string, string> = {};
      for (const id of profileIds) {
        const profile = availableProfiles.find((p) => p.id === id);
        if (profile) profileNames[id] = profile.displayName;
      }

      const result = await addToEspMutation.mutateAsync({
        intuneAppId,
        espProfileIds: profileIds,
        espProfileNames: profileNames,
      });
      setAddResults(result.results);
    } catch {
      // Error handled by mutation state
    }
  };

  const showValidationWarning = mode === 'pre-deploy' && enabled && espProfiles.length > 0 && !hasRequiredAssignment;

  // Post-deploy mode: compact self-contained component
  if (mode === 'post-deploy') {
    return (
      <div className="mt-3">
        <button
          type="button"
          onClick={() => setEnabled(!enabled)}
          className="inline-flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
        >
          <Shield className="w-4 h-4" />
          Add to ESP Profile
        </button>

        {enabled && (
          <div className="mt-2 p-3 rounded-lg border border-overlay/15 bg-bg-elevated/50 space-y-3">
            {isLoading && availableProfiles.length === 0 ? (
              <div className="flex items-center gap-2 text-text-muted text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading ESP profiles...
              </div>
            ) : error ? (
              <div className="text-sm text-red-300">{error}</div>
            ) : (
              <>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {availableProfiles.length === 0 ? (
                    <p className="text-text-muted text-sm">No ESP profiles found</p>
                  ) : (
                    availableProfiles.map((profile) => {
                      const selected = postDeploySelections.has(profile.id);
                      return (
                        <button
                          key={profile.id}
                          type="button"
                          onClick={() => togglePostDeployProfile(profile)}
                          className={cn(
                            'w-full text-left px-3 py-2 rounded-lg border transition-colors flex items-center gap-2',
                            selected
                              ? 'bg-blue-600/15 border-blue-500/40 text-blue-700 dark:text-blue-200'
                              : 'bg-bg-elevated/60 border-overlay/15 text-text-secondary hover:border-overlay/20 hover:bg-overlay/10'
                          )}
                        >
                          <Shield className="w-4 h-4 flex-shrink-0" />
                          <span className="text-sm truncate flex-1">{profile.displayName}</span>
                          <span className="text-xs text-text-muted">{profile.selectedAppCount} apps</span>
                        </button>
                      );
                    })
                  )}
                </div>

                {postDeploySelections.size > 0 && (
                  <button
                    type="button"
                    onClick={handleAddToEsp}
                    disabled={addToEspMutation.isPending}
                    className="w-full py-2 px-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {addToEspMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Shield className="w-4 h-4" />
                    )}
                    Add to {postDeploySelections.size} ESP Profile{postDeploySelections.size > 1 ? 's' : ''}
                  </button>
                )}

                {addResults && (
                  <div className="space-y-1">
                    {addResults.map((result) => (
                      <div
                        key={result.profileId}
                        className={cn(
                          'flex items-center gap-2 text-xs px-2 py-1.5 rounded',
                          result.success
                            ? result.alreadyAdded
                              ? 'text-yellow-300 bg-yellow-500/10'
                              : 'text-green-300 bg-green-500/10'
                            : 'text-red-300 bg-red-500/10'
                        )}
                      >
                        {result.success ? (
                          result.alreadyAdded ? (
                            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                          ) : (
                            <Check className="w-3.5 h-3.5 flex-shrink-0" />
                          )
                        ) : (
                          <X className="w-3.5 h-3.5 flex-shrink-0" />
                        )}
                        <span className="truncate">
                          {result.success
                            ? result.alreadyAdded
                              ? 'Already in profile'
                              : 'Added successfully'
                            : result.error || 'Failed'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  // Pre-deploy mode: toggle + multi-select (matches CategoryConfig pattern)
  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={handleToggleEnabled}
        className="flex items-center gap-3 w-full p-3 rounded-lg border border-overlay/15 bg-bg-elevated/50 hover:bg-overlay/10 transition-colors"
      >
        {enabled ? (
          <ToggleRight className="w-6 h-6 text-blue-400 flex-shrink-0" />
        ) : (
          <ToggleLeft className="w-6 h-6 text-text-muted flex-shrink-0" />
        )}
        <div className="flex-1 text-left">
          <p className={cn('text-sm font-medium', enabled ? 'text-text-primary' : 'text-text-muted')}>
            Add to ESP Profile
          </p>
          <p className="text-xs text-text-muted">
            {enabled
              ? 'This app will be required to install before users can access their device during Autopilot enrollment. This modifies a shared tenant-wide profile.'
              : 'Deploy without adding to Enrollment Status Page'}
          </p>
        </div>
      </button>

      {showValidationWarning && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-amber-700 dark:text-amber-300">
            <p className="font-medium mb-1">No &quot;required&quot; assignment configured</p>
            <p>Intune ESP only tracks apps assigned as &quot;required&quot;. Go to the <strong>Assignments</strong> section above and add an assignment with intent set to <strong>Required</strong>, otherwise this app will not be tracked during Autopilot enrollment.</p>
          </div>
        </div>
      )}

      {enabled && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search ESP profiles..."
                className="w-full pl-10 pr-3 py-2.5 bg-bg-elevated border border-overlay/15 rounded-lg text-text-primary text-sm placeholder-text-muted focus:border-overlay/20 focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => void refetch()}
              disabled={isLoading}
              className="px-3 py-2.5 rounded-lg border border-overlay/15 bg-bg-elevated text-text-secondary hover:bg-overlay/10 transition-colors disabled:opacity-50"
              title="Refresh ESP profiles"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
            </button>
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}

          {isLoading && availableProfiles.length === 0 ? (
            <div className="flex items-center gap-2 text-text-muted text-sm py-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading ESP profiles...
            </div>
          ) : (
            <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
              {filteredProfiles.length === 0 ? (
                <p className="text-text-muted text-sm py-2">
                  {availableProfiles.length === 0
                    ? 'No ESP profiles found in tenant'
                    : 'No profiles match your search'}
                </p>
              ) : (
                filteredProfiles.map((profile) => {
                  const selected = selectedIds.has(profile.id);
                  return (
                    <button
                      key={profile.id}
                      type="button"
                      onClick={() => toggleProfile(profile)}
                      className={cn(
                        'w-full text-left px-3 py-2.5 rounded-lg border transition-colors flex items-center gap-2',
                        selected
                          ? 'bg-blue-600/15 border-blue-500/40 text-blue-700 dark:text-blue-200'
                          : 'bg-bg-elevated/60 border-overlay/15 text-text-secondary hover:border-overlay/20 hover:bg-overlay/10'
                      )}
                    >
                      <Shield className="w-4 h-4 flex-shrink-0" />
                      <span className="text-sm truncate flex-1">{profile.displayName}</span>
                      <span className="text-xs text-text-muted">{profile.selectedAppCount} apps</span>
                    </button>
                  );
                })
              )}
            </div>
          )}

          <p className="text-xs text-text-muted">
            Selected: {espProfiles.length}
          </p>
        </div>
      )}
    </div>
  );
}
