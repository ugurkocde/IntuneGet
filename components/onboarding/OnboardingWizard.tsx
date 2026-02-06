'use client';

import { useState, useEffect, useCallback } from 'react';
import { WelcomeStep } from './WelcomeStep';
import { ConsentStep } from './ConsentStep';
import { SuccessStep } from './SuccessStep';
import {
  OnboardingStep,
  getOnboardingStep,
  setOnboardingStep,
} from '@/lib/onboarding-utils';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { GridBackground } from '@/components/landing/ui/GridBackground';
import { GradientOrb } from '@/components/landing/ui/GradientOrb';
import { FadeIn } from '@/components/landing/animations/FadeIn';

interface OnboardingWizardProps {
  userName: string | null | undefined;
  initialStep?: OnboardingStep;
}

export function OnboardingWizard({
  userName,
  initialStep,
}: OnboardingWizardProps) {
  const { getAccessToken } = useMicrosoftAuth();
  const [currentStep, setCurrentStep] = useState<OnboardingStep>(
    initialStep || 1
  );
  const [isInitialized, setIsInitialized] = useState(false);

  /**
   * Verify consent via API before allowing step 3
   * This prevents users from bypassing consent by bookmarking ?step=3
   */
  const verifyConsentForStep = useCallback(async (): Promise<boolean> => {
    try {
      const token = await getAccessToken();
      if (!token) return false;

      const response = await fetch('/api/auth/verify-consent', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) return false;

      const result = await response.json();
      return result.verified === true;
    } catch {
      return false;
    }
  }, [getAccessToken]);

  // Load persisted step on mount (client-side only)
  // When initialStep=3 is provided via URL, verify consent first
  useEffect(() => {
    const initStep = async () => {
      if (initialStep === 3) {
        // Verify consent before allowing direct access to step 3
        // This prevents bypassing consent via URL parameter
        const verified = await verifyConsentForStep();
        if (!verified) {
          // Force back to consent step
          setCurrentStep(2);
          setOnboardingStep(2);
          setIsInitialized(true);
          return;
        }
        setCurrentStep(3);
        setOnboardingStep(3);
      } else if (initialStep) {
        // Use the provided initial step (e.g., from URL)
        setCurrentStep(initialStep);
        setOnboardingStep(initialStep);
      } else {
        // Load from localStorage
        const savedStep = getOnboardingStep();
        setCurrentStep(savedStep);
      }
      setIsInitialized(true);
    };

    initStep();
  }, [initialStep, verifyConsentForStep]);

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
    <div className="min-h-screen bg-bg-deepest flex flex-col relative overflow-hidden">
      {/* Background decorations */}
      <GridBackground className="absolute inset-0" variant="dots" opacity={0.4} />
      <GradientOrb
        color="cyan"
        size="xl"
        className="-top-32 -left-32"
        intensity="low"
      />
      <GradientOrb
        color="violet"
        size="lg"
        className="-bottom-24 -right-24"
        intensity="low"
      />

      {/* Progress indicator */}
      <div className="relative flex justify-center py-6 sm:py-8">
        <div className="flex items-center gap-2">
          {[1, 2, 3].map((step) => (
            <div key={step} className="flex items-center">
              <div
                className={`w-6 h-6 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-xs sm:text-sm font-medium transition-colors ${
                  step === currentStep
                    ? 'bg-accent-cyan text-white'
                    : step < currentStep
                      ? 'bg-emerald-500 text-white'
                      : 'bg-stone-200 text-stone-500'
                }`}
              >
                {step < currentStep ? (
                  <svg
                    className="w-3 h-3 sm:w-4 sm:h-4"
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
                  className={`w-8 sm:w-12 h-0.5 ${
                    step < currentStep ? 'bg-emerald-500' : 'bg-stone-200'
                  }`}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Step labels */}
      <div className="relative flex justify-center mb-6 sm:mb-8">
        <div className="flex items-center gap-4 sm:gap-8 md:gap-12 text-xs text-stone-500">
          <span className={currentStep === 1 ? 'text-accent-cyan font-medium' : ''}>
            Welcome
          </span>
          <span className={currentStep === 2 ? 'text-accent-cyan font-medium' : ''}>
            Setup
          </span>
          <span className={currentStep === 3 ? 'text-accent-cyan font-medium' : ''}>
            Complete
          </span>
        </div>
      </div>

      {/* Step content */}
      <div className="relative flex-1 flex items-center justify-center px-4 pb-16">
        {currentStep === 1 && (
          <FadeIn key="step-1" animateOnMount direction="up">
            <WelcomeStep userName={userName} onNext={handleNext} />
          </FadeIn>
        )}
        {currentStep === 2 && (
          <FadeIn key="step-2" animateOnMount direction="up">
            <ConsentStep onNext={handleNext} onBack={handleBack} />
          </FadeIn>
        )}
        {currentStep === 3 && (
          <FadeIn key="step-3" animateOnMount direction="up">
            <SuccessStep userName={userName} />
          </FadeIn>
        )}
      </div>
    </div>
  );
}
