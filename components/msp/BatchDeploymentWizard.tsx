'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { useMsp } from '@/contexts/MspContext';
import { TenantSelector } from './TenantSelector';
import { Button } from '@/components/ui/button';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Package,
  Building2,
  Settings2,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface AppSelection {
  winget_id: string;
  display_name: string;
  version: string;
  publisher?: string;
}

interface BatchDeploymentWizardProps {
  initialApp?: AppSelection;
  onComplete?: () => void;
}

type WizardStep = 'app' | 'tenants' | 'review';

const steps: { id: WizardStep; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'app', label: 'Select App', icon: Package },
  { id: 'tenants', label: 'Select Tenants', icon: Building2 },
  { id: 'review', label: 'Review & Deploy', icon: Settings2 },
];

export function BatchDeploymentWizard({ initialApp, onComplete }: BatchDeploymentWizardProps) {
  const router = useRouter();
  const { getAccessToken } = useMicrosoftAuth();
  const { managedTenants } = useMsp();
  const queryClient = useQueryClient();

  const [currentStep, setCurrentStep] = useState<WizardStep>(initialApp ? 'tenants' : 'app');
  const [selectedApp, setSelectedApp] = useState<AppSelection | null>(initialApp || null);
  const [selectedTenantIds, setSelectedTenantIds] = useState<string[]>([]);
  const [concurrencyLimit, setConcurrencyLimit] = useState(3);
  const [error, setError] = useState<string | null>(null);

  // For app search (simplified - in production, you'd have a full app search component)
  const [appSearch, setAppSearch] = useState('');
  const [manualApp, setManualApp] = useState<AppSelection>({
    winget_id: '',
    display_name: '',
    version: '',
    publisher: '',
  });

  const createBatchMutation = useMutation({
    mutationFn: async () => {
      if (!selectedApp) throw new Error('No app selected');
      if (selectedTenantIds.length === 0) throw new Error('No tenants selected');

      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error('Not authenticated');

      const response = await fetch('/api/msp/batch-deployments', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          winget_id: selectedApp.winget_id,
          display_name: selectedApp.display_name,
          version: selectedApp.version,
          tenant_ids: selectedTenantIds,
          concurrency_limit: concurrencyLimit,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create batch deployment');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batch-deployments'] });
      onComplete?.();
      router.push('/dashboard/msp/batch');
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to create batch deployment');
    },
  });

  const canProceed = () => {
    switch (currentStep) {
      case 'app':
        return selectedApp && selectedApp.winget_id && selectedApp.display_name && selectedApp.version;
      case 'tenants':
        return selectedTenantIds.length > 0;
      case 'review':
        return true;
      default:
        return false;
    }
  };

  const handleNext = () => {
    setError(null);
    if (currentStep === 'app') {
      // If manual entry, use that
      if (!selectedApp && manualApp.winget_id && manualApp.display_name && manualApp.version) {
        setSelectedApp(manualApp);
      }
      setCurrentStep('tenants');
    } else if (currentStep === 'tenants') {
      setCurrentStep('review');
    } else if (currentStep === 'review') {
      createBatchMutation.mutate();
    }
  };

  const handleBack = () => {
    setError(null);
    if (currentStep === 'tenants') {
      setCurrentStep('app');
    } else if (currentStep === 'review') {
      setCurrentStep('tenants');
    }
  };

  const currentStepIndex = steps.findIndex((s) => s.id === currentStep);

  return (
    <div className="space-y-8">
      {/* Progress Steps */}
      <div className="flex items-center justify-center gap-2">
        {steps.map((step, index) => {
          const isActive = step.id === currentStep;
          const isCompleted = index < currentStepIndex;
          const Icon = step.icon;

          return (
            <div key={step.id} className="flex items-center">
              <div
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-lg transition-colors',
                  isActive && 'bg-accent-cyan/20 text-accent-cyan',
                  isCompleted && 'text-emerald-400',
                  !isActive && !isCompleted && 'text-text-muted'
                )}
              >
                {isCompleted ? (
                  <Check className="w-5 h-5" />
                ) : (
                  <Icon className="w-5 h-5" />
                )}
                <span className="text-sm font-medium hidden sm:inline">{step.label}</span>
              </div>
              {index < steps.length - 1 && (
                <ArrowRight className="w-4 h-4 text-text-muted mx-2" />
              )}
            </div>
          );
        })}
      </div>

      {/* Error message */}
      {error && (
        <div className="flex items-center gap-2 p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {/* Step Content */}
      <div className="min-h-[300px]">
        {currentStep === 'app' && (
          <div className="space-y-6">
            <h3 className="text-lg font-medium text-text-primary">Select Application</h3>

            {/* Manual entry form */}
            <div className="space-y-4 p-6 rounded-xl glass-light border border-black/5">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  WinGet Package ID *
                </label>
                <input
                  type="text"
                  value={selectedApp?.winget_id || manualApp.winget_id}
                  onChange={(e) => {
                    setSelectedApp(null);
                    setManualApp({ ...manualApp, winget_id: e.target.value });
                  }}
                  placeholder="e.g., Microsoft.VisualStudioCode"
                  className="w-full px-4 py-2 rounded-lg border border-black/10 bg-transparent text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-cyan"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Display Name *
                </label>
                <input
                  type="text"
                  value={selectedApp?.display_name || manualApp.display_name}
                  onChange={(e) => {
                    setSelectedApp(null);
                    setManualApp({ ...manualApp, display_name: e.target.value });
                  }}
                  placeholder="e.g., Visual Studio Code"
                  className="w-full px-4 py-2 rounded-lg border border-black/10 bg-transparent text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-cyan"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">
                    Version *
                  </label>
                  <input
                    type="text"
                    value={selectedApp?.version || manualApp.version}
                    onChange={(e) => {
                      setSelectedApp(null);
                      setManualApp({ ...manualApp, version: e.target.value });
                    }}
                    placeholder="e.g., 1.85.0"
                    className="w-full px-4 py-2 rounded-lg border border-black/10 bg-transparent text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-cyan"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">
                    Publisher
                  </label>
                  <input
                    type="text"
                    value={selectedApp?.publisher || manualApp.publisher}
                    onChange={(e) => {
                      setSelectedApp(null);
                      setManualApp({ ...manualApp, publisher: e.target.value });
                    }}
                    placeholder="e.g., Microsoft"
                    className="w-full px-4 py-2 rounded-lg border border-black/10 bg-transparent text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-cyan"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {currentStep === 'tenants' && (
          <div className="space-y-6">
            <h3 className="text-lg font-medium text-text-primary">Select Target Tenants</h3>
            <TenantSelector
              tenants={managedTenants}
              selectedTenantIds={selectedTenantIds}
              onSelectionChange={setSelectedTenantIds}
              maxSelections={50}
            />
          </div>
        )}

        {currentStep === 'review' && (
          <div className="space-y-6">
            <h3 className="text-lg font-medium text-text-primary">Review & Deploy</h3>

            <div className="grid md:grid-cols-2 gap-6">
              {/* App Summary */}
              <div className="p-6 rounded-xl glass-light border border-black/5">
                <div className="flex items-center gap-2 mb-4">
                  <Package className="w-5 h-5 text-accent-cyan" />
                  <h4 className="font-medium text-text-primary">Application</h4>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-text-muted">Package ID:</span>
                    <span className="text-text-primary font-mono">{selectedApp?.winget_id}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-muted">Name:</span>
                    <span className="text-text-primary">{selectedApp?.display_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-muted">Version:</span>
                    <span className="text-text-primary">{selectedApp?.version}</span>
                  </div>
                </div>
              </div>

              {/* Tenants Summary */}
              <div className="p-6 rounded-xl glass-light border border-black/5">
                <div className="flex items-center gap-2 mb-4">
                  <Building2 className="w-5 h-5 text-accent-violet" />
                  <h4 className="font-medium text-text-primary">Target Tenants</h4>
                </div>
                <div className="space-y-2">
                  <p className="text-2xl font-bold text-text-primary">
                    {selectedTenantIds.length}
                  </p>
                  <p className="text-sm text-text-muted">
                    tenants will receive this deployment
                  </p>
                </div>
              </div>
            </div>

            {/* Concurrency Settings */}
            <div className="p-6 rounded-xl glass-light border border-black/5">
              <div className="flex items-center gap-2 mb-4">
                <Settings2 className="w-5 h-5 text-blue-400" />
                <h4 className="font-medium text-text-primary">Deployment Settings</h4>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">
                    Concurrent Deployments: {concurrencyLimit}
                  </label>
                  <input
                    type="range"
                    min="1"
                    max="10"
                    value={concurrencyLimit}
                    onChange={(e) => setConcurrencyLimit(parseInt(e.target.value, 10))}
                    className="w-full accent-accent-cyan"
                  />
                  <p className="text-xs text-text-muted mt-1">
                    Number of tenants to deploy to simultaneously (1-10)
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between pt-6 border-t border-black/10">
        <Button
          variant="ghost"
          onClick={handleBack}
          disabled={currentStep === 'app' || createBatchMutation.isPending}
          className="text-text-secondary"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>

        <Button
          onClick={handleNext}
          disabled={!canProceed() || createBatchMutation.isPending}
          className="bg-gradient-to-r from-accent-cyan to-accent-violet text-bg-elevated hover:opacity-90"
        >
          {createBatchMutation.isPending ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Creating...
            </>
          ) : currentStep === 'review' ? (
            <>
              <Check className="w-4 h-4 mr-2" />
              Create Batch Deployment
            </>
          ) : (
            <>
              Next
              <ArrowRight className="w-4 h-4 ml-2" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
