'use client';

import { useRouter } from 'next/navigation';
import { PartyPopper, Search, Package, Upload, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { markOnboardingComplete } from '@/lib/onboarding-utils';
import { markConsentGranted } from '@/components/AdminConsentBanner';

interface SuccessStepProps {
  userName: string | null | undefined;
}

export function SuccessStep({ userName }: SuccessStepProps) {
  const router = useRouter();
  const firstName = userName?.split(' ')[0] || 'there';

  const handleGoToDashboard = () => {
    // Mark both consent and onboarding as complete
    markConsentGranted();
    markOnboardingComplete();
    router.push('/dashboard');
  };

  const tips = [
    {
      icon: Search,
      title: 'Search Apps',
      description:
        'Use the app browser to search thousands of applications from winget.',
      color: 'cyan' as const,
    },
    {
      icon: Package,
      title: 'Select Apps',
      description:
        'Select apps and versions you want to deploy and add them to your selection.',
      color: 'violet' as const,
    },
    {
      icon: Upload,
      title: 'Deploy to Intune',
      description:
        'Review your selection and deploy all apps to your Intune tenant in one click.',
      color: 'cyan' as const,
    },
  ];

  return (
    <div className="text-center max-w-2xl mx-auto">
      {/* Icon */}
      <div className="mb-8">
        <div className="inline-flex items-center justify-center w-20 h-20 bg-emerald-500/10 rounded-2xl">
          <PartyPopper className="w-10 h-10 text-emerald-500" />
        </div>
      </div>

      {/* Heading */}
      <h1 className="text-2xl sm:text-3xl font-bold text-stone-900 mb-4">
        You're All Set, {firstName}!
      </h1>

      <p className="text-lg text-stone-500 mb-8">
        Your organization is configured and ready to deploy apps to Intune.
      </p>

      {/* Tips */}
      <div className="bg-white border border-stone-200 rounded-xl p-6 mb-8 text-left shadow-soft">
        <h2 className="text-lg font-semibold text-stone-900 mb-4">
          Getting Started
        </h2>
        <div className="space-y-4">
          {tips.map((tip, index) => (
            <div key={index} className="flex items-start gap-4">
              <div className={`p-2 rounded-lg flex-shrink-0 ${
                tip.color === 'cyan'
                  ? 'bg-accent-cyan/10'
                  : 'bg-accent-violet/10'
              }`}>
                <tip.icon className={`w-5 h-5 ${
                  tip.color === 'cyan'
                    ? 'text-accent-cyan'
                    : 'text-accent-violet'
                }`} />
              </div>
              <div>
                <h3 className="font-medium text-stone-900">{tip.title}</h3>
                <p className="text-sm text-stone-500">{tip.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <Button
        onClick={handleGoToDashboard}
        size="lg"
        className="bg-accent-cyan hover:bg-accent-cyan-dim text-white px-8 shadow-glow-cyan"
      >
        Go to Dashboard
        <ArrowRight className="w-5 h-5 ml-2" />
      </Button>

      {/* Additional info */}
      <p className="text-xs text-stone-400 mt-6">
        Any user with Intune permissions in your organization can now use
        IntuneGet.
      </p>
    </div>
  );
}
