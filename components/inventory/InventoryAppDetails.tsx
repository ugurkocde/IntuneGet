'use client';

import { X, Package, Calendar, User, Terminal, AlertCircle, Loader2, RefreshCw, ExternalLink, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAppDetails } from '@/hooks/use-inventory';
import type { IntuneAppAssignment } from '@/types/inventory';

interface InventoryAppDetailsProps {
  appId: string;
  onClose: () => void;
  onUpdate?: (wingetId: string) => void;
}

export function InventoryAppDetails({ appId, onClose, onUpdate }: InventoryAppDetailsProps) {
  const { data, isLoading, error, refetch } = useAppDetails(appId);
  const app = data?.app;

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatSize = (bytes: number | null) => {
    if (!bytes) return 'Unknown';
    const mb = bytes / (1024 * 1024);
    if (mb < 1) return `${Math.round(bytes / 1024)} KB`;
    if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
    return `${mb.toFixed(1)} MB`;
  };

  const getAssignmentIntent = (intent: IntuneAppAssignment['intent']) => {
    const intents: Record<string, { label: string; color: string }> = {
      required: { label: 'Required', color: 'text-blue-400' },
      available: { label: 'Available', color: 'text-green-400' },
      uninstall: { label: 'Uninstall', color: 'text-red-400' },
      availableWithoutEnrollment: { label: 'Available (Unenrolled)', color: 'text-yellow-400' },
    };
    return intents[intent] || { label: intent, color: 'text-slate-400' };
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative h-full w-full max-w-lg bg-slate-900 border-l border-slate-800 overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-slate-900 border-b border-slate-800 p-4 z-10">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">App Details</h2>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => refetch()}
                disabled={isLoading}
                className="text-slate-400 hover:text-white"
              >
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </Button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-4">
          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
              <p className="text-white font-medium">Failed to load app</p>
              <p className="text-sm mt-1">{error.message}</p>
              <Button
                variant="outline"
                className="mt-4 border-slate-700"
                onClick={() => refetch()}
              >
                Try Again
              </Button>
            </div>
          )}

          {app && (
            <div className="space-y-6">
              {/* App Header */}
              <div className="flex items-start gap-4">
                <div className="w-16 h-16 rounded-lg bg-slate-800 flex items-center justify-center flex-shrink-0">
                  {app.largeIcon?.value ? (
                    <img
                      src={`data:${app.largeIcon.type};base64,${app.largeIcon.value}`}
                      alt={app.displayName}
                      className="w-14 h-14 rounded"
                    />
                  ) : (
                    <Package className="w-8 h-8 text-slate-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-xl font-semibold text-white">{app.displayName}</h3>
                  <p className="text-slate-400">{app.publisher || 'Unknown Publisher'}</p>
                  {app.displayVersion && (
                    <p className="text-sm text-slate-500 mt-1">Version {app.displayVersion}</p>
                  )}
                </div>
              </div>

              {/* Update Button */}
              {onUpdate && (
                <Button
                  onClick={() => onUpdate(app.displayName)}
                  className="w-full bg-blue-600 hover:bg-blue-700"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Check for Update
                </Button>
              )}

              {/* Description */}
              {app.description && (
                <div>
                  <h4 className="text-sm font-medium text-slate-400 mb-2">Description</h4>
                  <p className="text-sm text-slate-300">{app.description}</p>
                </div>
              )}

              {/* Commands */}
              <div className="space-y-4">
                {app.installCommandLine && (
                  <div>
                    <h4 className="text-sm font-medium text-slate-400 mb-2 flex items-center gap-2">
                      <Terminal className="w-4 h-4" />
                      Install Command
                    </h4>
                    <code className="block text-sm text-green-400 bg-slate-800 p-3 rounded-lg overflow-x-auto">
                      {app.installCommandLine}
                    </code>
                  </div>
                )}
                {app.uninstallCommandLine && (
                  <div>
                    <h4 className="text-sm font-medium text-slate-400 mb-2 flex items-center gap-2">
                      <Terminal className="w-4 h-4" />
                      Uninstall Command
                    </h4>
                    <code className="block text-sm text-red-400 bg-slate-800 p-3 rounded-lg overflow-x-auto">
                      {app.uninstallCommandLine}
                    </code>
                  </div>
                )}
              </div>

              {/* Assignments */}
              {app.assignments && app.assignments.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-slate-400 mb-3 flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    Assignments ({app.assignments.length})
                  </h4>
                  <div className="space-y-2">
                    {app.assignments.map((assignment) => {
                      const intentInfo = getAssignmentIntent(assignment.intent);
                      return (
                        <div
                          key={assignment.id}
                          className="flex items-center justify-between p-3 bg-slate-800 rounded-lg"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center">
                              <Users className="w-4 h-4 text-slate-400" />
                            </div>
                            <div>
                              <p className="text-sm text-white">
                                {assignment.target['@odata.type']?.includes('allDevices')
                                  ? 'All Devices'
                                  : assignment.target['@odata.type']?.includes('allUsers')
                                  ? 'All Users'
                                  : assignment.target.groupId
                                  ? `Group: ${assignment.target.groupId.slice(0, 8)}...`
                                  : 'Unknown Target'}
                              </p>
                            </div>
                          </div>
                          <span className={`text-sm font-medium ${intentInfo.color}`}>
                            {intentInfo.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Metadata */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <MetadataItem
                  icon={Calendar}
                  label="Created"
                  value={formatDate(app.createdDateTime)}
                />
                <MetadataItem
                  icon={Calendar}
                  label="Modified"
                  value={formatDate(app.lastModifiedDateTime)}
                />
                <MetadataItem
                  icon={Package}
                  label="Size"
                  value={formatSize(app.size)}
                />
                <MetadataItem
                  icon={User}
                  label="Run As"
                  value={app.installExperience?.runAsAccount || 'System'}
                />
              </div>

              {/* Additional Info */}
              {(app.developer || app.owner || app.notes) && (
                <div className="space-y-3 pt-4 border-t border-slate-800">
                  {app.developer && (
                    <div>
                      <span className="text-sm text-slate-500">Developer: </span>
                      <span className="text-sm text-slate-300">{app.developer}</span>
                    </div>
                  )}
                  {app.owner && (
                    <div>
                      <span className="text-sm text-slate-500">Owner: </span>
                      <span className="text-sm text-slate-300">{app.owner}</span>
                    </div>
                  )}
                  {app.notes && (
                    <div>
                      <span className="text-sm text-slate-500">Notes: </span>
                      <span className="text-sm text-slate-300">{app.notes}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Links */}
              {(app.informationUrl || app.privacyInformationUrl) && (
                <div className="flex gap-3 pt-4 border-t border-slate-800">
                  {app.informationUrl && (
                    <a
                      href={app.informationUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-500 hover:text-blue-400 flex items-center gap-1"
                    >
                      More Info <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                  {app.privacyInformationUrl && (
                    <a
                      href={app.privacyInformationUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-500 hover:text-blue-400 flex items-center gap-1"
                    >
                      Privacy <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MetadataItem({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="bg-slate-800/50 rounded-lg p-3">
      <div className="flex items-center gap-2 text-slate-400 mb-1">
        <Icon className="w-4 h-4" />
        <span className="text-xs">{label}</span>
      </div>
      <p className="text-sm text-white capitalize">{value}</p>
    </div>
  );
}
