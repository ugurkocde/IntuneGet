'use client';

import { useState, useEffect } from 'react';
import { Search, Check, Loader2, Package, AlertTriangle, RefreshCw, ShoppingCart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { AppIcon } from '@/components/AppIcon';
import { cn } from '@/lib/utils';
import type { UnmanagedApp } from '@/types/unmanaged';
import type { NormalizedPackage } from '@/types/winget';

interface LinkPackageModalProps {
  app: UnmanagedApp;
  isOpen: boolean;
  onClose: () => void;
  onLink: (app: UnmanagedApp, wingetPackageId: string) => Promise<void>;
  onLinkAndClaim?: (app: UnmanagedApp, wingetPackageId: string) => Promise<void>;
}

export function LinkPackageModal({ app, isOpen, onClose, onLink, onLinkAndClaim }: LinkPackageModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<NormalizedPackage[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
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
      setSearchError(null);
    }
  }, [isOpen, app]);

  // Search for packages
  useEffect(() => {
    const searchPackages = async () => {
      if (!searchQuery || searchQuery.length < 2) {
        setSearchResults([]);
        setSearchError(null);
        return;
      }

      setIsSearching(true);
      setSearchError(null);
      try {
        const response = await fetch(
          `/api/winget/search?q=${encodeURIComponent(searchQuery)}&limit=10`
        );
        if (response.ok) {
          const data = await response.json();
          setSearchResults(data.packages || []);
        } else {
          setSearchError('Search failed. Please try again.');
          setSearchResults([]);
        }
      } catch {
        setSearchError('Network error. Check your connection and try again.');
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    };

    const debounce = setTimeout(searchPackages, 300);
    return () => clearTimeout(debounce);
  }, [searchQuery]);

  const handleLink = async (andClaim = false) => {
    if (!selectedPackage) return;

    setIsLinking(true);
    try {
      if (andClaim && onLinkAndClaim) {
        await onLinkAndClaim(app, selectedPackage.id);
      } else {
        await onLink(app, selectedPackage.id);
      }
      onClose();
    } catch (error) {
      console.error('Link error:', error);
    } finally {
      setIsLinking(false);
    }
  };

  const handleRetrySearch = () => {
    setSearchError(null);
    // Trigger re-search by appending a space then removing it
    const q = searchQuery;
    setSearchQuery(q + ' ');
    setTimeout(() => setSearchQuery(q), 10);
  };

  const handleOpenChange = (open: boolean) => {
    if (!open && !isLinking) {
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-2xl mx-4"
        onInteractOutside={(e) => {
          if (isLinking) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Link WinGet Package</DialogTitle>
          <DialogDescription>
            Search for a WinGet package to link with &ldquo;{app.displayName}&rdquo;
          </DialogDescription>
        </DialogHeader>

        {/* Search */}
        <div className="px-6 py-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search WinGet packages..."
              className="pl-10 bg-bg-elevated border-overlay/10 focus:border-accent-cyan/50"
              autoFocus
            />
            {isSearching && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted animate-spin" />
            )}
          </div>
        </div>

        {/* Partial matches suggestion */}
        {app.partialMatches && app.partialMatches.length > 0 && (
          <div className="px-6 pb-4">
            <p className="text-xs text-text-muted mb-2">Suggested matches based on partial matching:</p>
            <div className="flex flex-wrap gap-2">
              {app.partialMatches.slice(0, 5).map((match) => (
                <button
                  key={match.wingetId}
                  type="button"
                  onClick={() => {
                    const existingResult = searchResults.find(pkg => pkg.id === match.wingetId);
                    if (existingResult) {
                      setSelectedPackage(existingResult);
                    } else {
                      setSearchQuery(match.wingetId);
                    }
                  }}
                  className={cn(
                    'text-xs px-3 py-1.5 rounded-lg transition-colors',
                    selectedPackage?.id === match.wingetId
                      ? 'bg-accent-cyan/20 text-accent-cyan border border-accent-cyan/30'
                      : 'bg-bg-elevated text-text-secondary hover:bg-overlay/10'
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
          {/* Search error */}
          {searchError && (
            <div className="flex flex-col items-center py-8 text-center">
              <AlertTriangle className="w-10 h-10 text-amber-400 mb-3" />
              <p className="text-text-secondary text-sm mb-3">{searchError}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleRetrySearch}
                className="border-overlay/10"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Retry Search
              </Button>
            </div>
          )}

          {/* No results */}
          {!searchError && searchResults.length === 0 && searchQuery.length >= 2 && !isSearching && (
            <div className="text-center py-8 text-text-muted">
              <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No packages found for &ldquo;{searchQuery}&rdquo;</p>
            </div>
          )}

          {/* Package list */}
          <div className="space-y-2">
            {searchResults.map((pkg) => (
              <button
                key={pkg.id}
                type="button"
                onClick={() => setSelectedPackage(pkg)}
                className={cn(
                  'w-full flex items-center gap-4 p-4 rounded-xl transition-all',
                  selectedPackage?.id === pkg.id
                    ? 'bg-accent-cyan/10 border-accent-cyan/30 border'
                    : 'bg-bg-elevated hover:bg-overlay/5 border border-transparent'
                )}
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

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isLinking}
            className="border-overlay/10"
          >
            Cancel
          </Button>
          {onLinkAndClaim && (
            <Button
              type="button"
              onClick={() => handleLink(true)}
              disabled={!selectedPackage || isLinking}
              className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white border-0"
            >
              {isLinking ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <ShoppingCart className="w-4 h-4 mr-2" />
              )}
              Link & Claim
            </Button>
          )}
          <Button
            type="button"
            onClick={() => handleLink(false)}
            disabled={!selectedPackage || isLinking}
            className="bg-gradient-to-r from-accent-cyan to-accent-violet hover:opacity-90 text-white border-0"
          >
            {isLinking && !onLinkAndClaim ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : null}
            Link Package
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
