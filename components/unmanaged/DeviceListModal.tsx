'use client';

import { useState, useEffect } from 'react';
import { Monitor, Loader2, AlertTriangle, RefreshCw, Search, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import type { UnmanagedApp, DetectedAppDevicesResponse } from '@/types/unmanaged';

interface DeviceListModalProps {
  app: UnmanagedApp;
  isOpen: boolean;
  onClose: () => void;
  fetchDevices: (app: UnmanagedApp) => Promise<DetectedAppDevicesResponse>;
}

export function DeviceListModal({ app, isOpen, onClose, fetchDevices }: DeviceListModalProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DetectedAppDevicesResponse | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  // Fetch device list whenever the modal opens (or a retry is requested). The
  // `active` flag prevents stale state updates if the user closes/switches apps
  // before the request resolves.
  useEffect(() => {
    if (!isOpen) return;
    let active = true;

    setIsLoading(true);
    setError(null);
    setData(null);
    setSearchQuery('');

    fetchDevices(app)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load devices');
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isOpen, app, fetchDevices, reloadKey]);

  const handleOpenChange = (open: boolean) => {
    if (!open) onClose();
  };

  const devices = data?.devices ?? [];
  const filteredDevices = searchQuery
    ? devices.filter((d) => d.deviceName.toLowerCase().includes(searchQuery.toLowerCase()))
    : devices;
  const showSearch = devices.length > 10;
  const showMismatch =
    data?.summedDeviceCount != null && data.summedDeviceCount !== data.total;

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg mx-4">
        <DialogHeader>
          <DialogTitle>
            {data ? `${data.total} ${data.total === 1 ? 'device' : 'devices'}` : 'Devices'}
          </DialogTitle>
          <DialogDescription>
            Devices with &ldquo;{app.displayName}&rdquo; installed
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-4">
          {/* Loading */}
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="w-8 h-8 text-accent-cyan animate-spin mb-3" />
              <p className="text-sm text-text-muted">Loading devices...</p>
            </div>
          )}

          {/* Error */}
          {!isLoading && error && (
            <div className="flex flex-col items-center py-10 text-center">
              <AlertTriangle className="w-10 h-10 text-amber-400 mb-3" />
              <p className="text-text-secondary text-sm mb-3">{error}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setReloadKey((k) => k + 1)}
                className="border-overlay/10"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Retry
              </Button>
            </div>
          )}

          {/* Empty */}
          {!isLoading && !error && data && devices.length === 0 && (
            <div className="text-center py-10 text-text-muted">
              <Monitor className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm">No devices found for this app</p>
            </div>
          )}

          {/* Device list */}
          {!isLoading && !error && devices.length > 0 && (
            <div className="space-y-3">
              {/* Multi-version mismatch hint */}
              {showMismatch && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-bg-elevated/60 border border-overlay/5">
                  <Info className="w-4 h-4 text-accent-cyan flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-text-muted">
                    {data!.summedDeviceCount!.toLocaleString()} total installs across{' '}
                    {data!.total.toLocaleString()} distinct devices (some devices run more than one
                    version).
                  </p>
                </div>
              )}

              {/* Truncation note */}
              {data?.truncated && (
                <p className="text-xs text-text-muted">
                  Showing devices from the first {25} detected versions.
                </p>
              )}

              {/* Search */}
              {showSearch && (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filter devices..."
                    className="pl-9 bg-bg-elevated border-overlay/10 focus:border-accent-cyan/50"
                  />
                </div>
              )}

              <div className="space-y-1.5 max-h-80 overflow-y-auto">
                {filteredDevices.length === 0 ? (
                  <p className="text-center py-6 text-sm text-text-muted">
                    No devices match &ldquo;{searchQuery}&rdquo;
                  </p>
                ) : (
                  filteredDevices.map((device) => (
                    <div
                      key={device.id}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-bg-elevated border border-overlay/5"
                    >
                      <Monitor className="w-4 h-4 text-accent-cyan flex-shrink-0" />
                      <p className="text-sm text-text-primary truncate flex-1 min-w-0">
                        {device.deviceName}
                      </p>
                      {device.operatingSystem && (
                        <span className="text-xs text-text-muted flex-shrink-0">
                          {device.operatingSystem}
                        </span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
