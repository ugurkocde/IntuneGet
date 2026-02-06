'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';
import { OnboardingStep } from '@/lib/onboarding-utils';

function OnboardingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, user } = useMicrosoftAuth();
  const [isLoading, setIsLoading] = useState(true);

  // Get initial step from URL if provided (e.g., ?step=3 from consent callback)
  const stepParam = searchParams.get('step');
  const initialStep = stepParam
    ? (parseInt(stepParam, 10) as OnboardingStep)
    : undefined;

  // Allow some time for MSAL to initialize
  useEffect(() => {
    const timeout = setTimeout(() => {
      setIsLoading(false);
    }, 500);

    return () => clearTimeout(timeout);
  }, []);

  // Redirect to sign-in if not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/auth/signin?callbackUrl=/onboarding');
    }
  }, [isLoading, isAuthenticated, router]);

  // Show loading while checking auth
  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen bg-bg-deepest flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-accent-cyan animate-spin mx-auto mb-4" />
          <p className="text-stone-500">Loading...</p>
        </div>
      </div>
    );
  }

  return <OnboardingWizard userName={user?.name} initialStep={initialStep} />;
}

export default function OnboardingPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-bg-deepest flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="w-8 h-8 text-accent-cyan animate-spin mx-auto mb-4" />
            <p className="text-stone-500">Loading...</p>
          </div>
        </div>
      }
    >
      <OnboardingContent />
    </Suspense>
  );
}
