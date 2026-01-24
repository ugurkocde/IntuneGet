'use client';

import { useState, useEffect } from 'react';
import { WelcomeStep } from './WelcomeStep';
import { ConsentStep } from './ConsentStep';
import { SuccessStep } from './SuccessStep';
import {
  OnboardingStep,
  getOnboardingStep,
  setOnboardingStep,
} from '@/lib/onboarding-utils';

interface OnboardingWizardProps {
  userName: string | null | undefined;
  initialStep?: OnboardingStep;
}

export function OnboardingWizard({
  userName,
  initialStep,
}: OnboardingWizardProps) {
  const [currentStep, setCurrentStep] = useState<OnboardingStep>(
    initialStep || 1
  );
  const [isInitialized, setIsInitialized] = useState(false);

  // Load persisted step on mount (client-side only)
  useEffect(() => {
    if (initialStep) {
      // If initial step provided (e.g., from URL), use that
      setCurrentStep(initialStep);
      setOnboardingStep(initialStep);
    } else {
      // Otherwise load from localStorage
      const savedStep = getOnboardingStep();
      setCurrentStep(savedStep);
    }
    setIsInitialized(true);
  }, [initialStep]);

  // Persist step changes
  const goToStep = (step: OnboardingStep) => {
    setCurrentStep(step);
    setOnboardingStep(step);
  };

  const handleNext = () => {
    if (currentStep < 3) {
      goToStep((currentStep + 1) as OnboardingStep);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      goToStep((currentStep - 1) as OnboardingStep);
    }
  };

  // Don't render until initialized to avoid hydration mismatch
  if (!isInitialized) {
    return null;
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">
      {/* Progress indicator */}
      <div className="flex justify-center py-8">
        <div className="flex items-center gap-2">
          {[1, 2, 3].map((step) => (
            <div key={step} className="flex items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                  step === currentStep
                    ? 'bg-blue-600 text-white'
                    : step < currentStep
                      ? 'bg-green-600 text-white'
                      : 'bg-slate-800 text-slate-500'
                }`}
              >
                {step < currentStep ? (
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                ) : (
                  step
                )}
              </div>
              {step < 3 && (
                <div
                  className={`w-12 h-0.5 ${
                    step < currentStep ? 'bg-green-600' : 'bg-slate-800'
                  }`}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Step labels */}
      <div className="flex justify-center mb-8">
        <div className="flex items-center gap-12 text-xs text-slate-500">
          <span className={currentStep === 1 ? 'text-blue-400' : ''}>
            Welcome
          </span>
          <span className={currentStep === 2 ? 'text-blue-400' : ''}>
            Setup
          </span>
          <span className={currentStep === 3 ? 'text-blue-400' : ''}>
            Complete
          </span>
        </div>
      </div>

      {/* Step content */}
      <div className="flex-1 flex items-center justify-center px-4 pb-16">
        {currentStep === 1 && (
          <WelcomeStep userName={userName} onNext={handleNext} />
        )}
        {currentStep === 2 && (
          <ConsentStep onNext={handleNext} onBack={handleBack} />
        )}
        {currentStep === 3 && <SuccessStep userName={userName} />}
      </div>
    </div>
  );
}
