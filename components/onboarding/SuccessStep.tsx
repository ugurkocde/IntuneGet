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
    },
    {
      icon: Package,
      title: 'Select Apps',
      description:
        'Select apps and versions you want to deploy and add them to your selection.',
    },
    {
      icon: Upload,
      title: 'Deploy to Intune',
      description:
        'Review your selection and deploy all apps to your Intune tenant in one click.',
    },
  ];

  return (
    <div className="text-center max-w-2xl mx-auto">
      {/* Icon */}
      <div className="mb-8">
        <div className="inline-flex items-center justify-center w-20 h-20 bg-green-500/10 rounded-2xl">
          <PartyPopper className="w-10 h-10 text-green-500" />
        </div>
      </div>

      {/* Heading */}
      <h1 className="text-3xl font-bold text-white mb-4">
        You're All Set, {firstName}!
      </h1>

      <p className="text-lg text-slate-400 mb-8">
        Your organization is configured and ready to deploy apps to Intune.
      </p>

      {/* Tips */}
      <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6 mb-8 text-left">
        <h2 className="text-lg font-semibold text-white mb-4">
          Getting Started
        </h2>
        <div className="space-y-4">
          {tips.map((tip, index) => (
            <div key={index} className="flex items-start gap-4">
              <div className="p-2 bg-blue-500/10 rounded-lg flex-shrink-0">
                <tip.icon className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <h3 className="font-medium text-white">{tip.title}</h3>
                <p className="text-sm text-slate-400">{tip.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <Button
        onClick={handleGoToDashboard}
        size="lg"
        className="bg-green-600 hover:bg-green-700 text-white px-8"
      >
        Go to Dashboard
        <ArrowRight className="w-5 h-5 ml-2" />
      </Button>

      {/* Additional info */}
      <p className="text-xs text-slate-500 mt-6">
        Any user with Intune permissions in your organization can now use
        IntuneGet.
      </p>
    </div>
  );
}
