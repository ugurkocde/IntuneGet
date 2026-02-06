'use client';

import { useState, useEffect } from 'react';
import { Search, X, Check, Loader2, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AppIcon } from '@/components/AppIcon';
import { cn } from '@/lib/utils';
import type { UnmanagedApp } from '@/types/unmanaged';
import type { NormalizedPackage } from '@/types/winget';

interface LinkPackageModalProps {
  app: UnmanagedApp;
  isOpen: boolean;
  onClose: () => void;
  onLink: (app: UnmanagedApp, wingetPackageId: string) => Promise<void>;
}

export function LinkPackageModal({ app, isOpen, onClose, onLink }: LinkPackageModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<NormalizedPackage[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<NormalizedPackage | null>(null);
  const [isLinking, setIsLinking] = useState(false);

  // Initialize search with app name
  useEffect(() => {
    if (isOpen && app) {
      const initialQuery = app.displayName
        .replace(/\s*\(x64\)|\s*\(x86\)|\s*\(64-bit\)|\s*\(32-bit\)/gi, '')
        .replace(/\s+v?\d+(\.\d+)*(\.\d+)?/g, '')
        .trim();
      setSearchQuery(initialQuery);
      setSelectedPackage(null);
    }
  }, [isOpen, app]);

  // Search for packages
  useEffect(() => {
    const searchPackages = async () => {
      if (!searchQuery || searchQuery.length < 2) {
        setSearchResults([]);
        return;
      }

      setIsSearching(true);
      try {
        const response = await fetch(
          `/api/winget/search?q=${encodeURIComponent(searchQuery)}&limit=10`
        );
        if (response.ok) {
          const data = await response.json();
          setSearchResults(data.packages || []);
        }
      } catch {
        // Search error - silently ignore
      } finally {
        setIsSearching(false);
      }
    };

    const debounce = setTimeout(searchPackages, 300);
    return () => clearTimeout(debounce);
  }, [searchQuery]);

  const handleLink = async () => {
    if (!selectedPackage) return;

    setIsLinking(true);
    try {
      await onLink(app, selectedPackage.id);
      onClose();
    } catch (error) {
      console.error('Link error:', error);
    } finally {
      setIsLinking(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="link-modal-title"
        className="relative w-full max-w-2xl mx-4 bg-bg-surface rounded-2xl border border-black/10 shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/5">
          <div>
            <h2 id="link-modal-title" className="text-lg font-semibold text-text-primary">Link WinGet Package</h2>
            <p className="text-sm text-text-secondary mt-1">
              Search for a WinGet package to link with "{app.displayName}"
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary transition-colors p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="px-6 py-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search WinGet packages..."
              className="pl-10 bg-bg-elevated border-black/10 focus:border-accent-cyan/50"
              autoFocus
            />
            {isSearching && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted animate-spin" />
            )}
          </div>
        </div>

        {/* Partial matches suggestion - always show if available */}
        {app.partialMatches && app.partialMatches.length > 0 && (
          <div className="px-6 pb-4">
            <p className="text-xs text-text-muted mb-2">Suggested matches based on partial matching:</p>
            <div className="flex flex-wrap gap-2">
              {app.partialMatches.slice(0, 5).map((match) => (
                <button
                  key={match.wingetId}
                  onClick={() => {
                    // Find and select this package if it's in search results, otherwise search for it
                    const existingResult = searchResults.find(pkg => pkg.id === match.wingetId);
                    if (existingResult) {
                      setSelectedPackage(existingResult);
                    } else {
                      setSearchQuery(match.wingetId);
                    }
                  }}
                  className={cn(
                    "text-xs px-3 py-1.5 rounded-lg transition-colors",
                    selectedPackage?.id === match.wingetId
                      ? "bg-accent-cyan/20 text-accent-cyan border border-accent-cyan/30"
                      : "bg-bg-elevated text-text-secondary hover:bg-black/10"
                  )}
                >
                  {match.name}
                  {match.confidence && (
                    <span className="ml-1 opacity-60">({Math.round(match.confidence * 100)}%)</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Results */}
        <div className="px-6 pb-4 max-h-80 overflow-y-auto">
          {searchResults.length === 0 && searchQuery.length >= 2 && !isSearching && (
            <div className="text-center py-8 text-text-muted">
              <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No packages found for "{searchQuery}"</p>
            </div>
          )}

          <div className="space-y-2">
            {searchResults.map((pkg) => (
              <button
                key={pkg.id}
                onClick={() => setSelectedPackage(pkg)}
                className={`w-full flex items-center gap-4 p-4 rounded-xl transition-all ${
                  selectedPackage?.id === pkg.id
                    ? 'bg-accent-cyan/10 border-accent-cyan/30 border'
                    : 'bg-bg-elevated hover:bg-black/5 border border-transparent'
                }`}
              >
                <AppIcon
                  packageId={pkg.id}
                  packageName={pkg.name}
                  iconPath={pkg.iconPath}
                  size="md"
                />
                <div className="flex-1 text-left min-w-0">
                  <p className="text-text-primary font-medium truncate">{pkg.name}</p>
                  <p className="text-text-muted text-sm truncate">{pkg.publisher}</p>
                  <p className="text-text-muted text-xs font-mono truncate">{pkg.id}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-secondary bg-bg-deepest px-2 py-1 rounded">
                    v{pkg.version}
                  </span>
                  {selectedPackage?.id === pkg.id && (
                    <Check className="w-5 h-5 text-accent-cyan" />
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-black/5 bg-bg-elevated/50">
          <Button variant="outline" onClick={onClose} className="border-black/10">
            Cancel
          </Button>
          <Button
            onClick={handleLink}
            disabled={!selectedPackage || isLinking}
            className="bg-gradient-to-r from-accent-cyan to-accent-violet hover:opacity-90 text-white border-0"
          >
            {isLinking ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : null}
            Link Package
          </Button>
        </div>
      </div>
    </div>
  );
}
