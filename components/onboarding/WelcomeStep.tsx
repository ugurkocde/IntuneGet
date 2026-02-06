'use client';

import { Rocket, Shield, Package, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface WelcomeStepProps {
  userName: string | null | undefined;
  onNext: () => void;
}

export function WelcomeStep({ userName, onNext }: WelcomeStepProps) {
  const firstName = userName?.split(' ')[0] || 'there';

  return (
    <div className="text-center max-w-2xl mx-auto">
      {/* Icon */}
      <div className="mb-8">
        <div className="inline-flex items-center justify-center w-20 h-20 bg-accent-cyan/10 rounded-2xl">
          <Rocket className="w-10 h-10 text-accent-cyan" />
        </div>
      </div>

      {/* Heading */}
      <h1 className="text-2xl sm:text-3xl font-bold text-stone-900 mb-4">
        Welcome, {firstName}!
      </h1>

      <p className="text-lg text-stone-500 mb-8">
        Let's get your organization set up to deploy apps to Intune in minutes.
      </p>

      {/* What IntuneGet does */}
      <div className="bg-white border border-stone-200 rounded-xl p-6 mb-8 text-left shadow-soft">
        <h2 className="text-lg font-semibold text-stone-900 mb-4">
          What IntuneGet does
        </h2>
        <div className="space-y-4">
          <div className="flex items-start gap-4">
            <div className="p-2 bg-accent-cyan/10 rounded-lg flex-shrink-0">
              <Package className="w-5 h-5 text-accent-cyan" />
            </div>
            <div>
              <h3 className="font-medium text-stone-900">Browse Apps</h3>
              <p className="text-sm text-stone-500">
                Search and browse thousands of applications from the Windows
                Package Manager (winget) repository.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-4">
            <div className="p-2 bg-accent-violet/10 rounded-lg flex-shrink-0">
              <Shield className="w-5 h-5 text-accent-violet" />
            </div>
            <div>
              <h3 className="font-medium text-stone-900">Deploy to Intune</h3>
              <p className="text-sm text-stone-500">
                One-click deployment directly to your Microsoft Intune tenant.
                No manual packaging required.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Setup info */}
      <div className="bg-stone-100 border border-stone-200 rounded-xl p-4 mb-8">
        <p className="text-sm text-stone-600">
          <strong className="text-stone-900">Quick setup:</strong> We need admin
          consent to upload apps to your organization. This is a one-time step.
        </p>
      </div>

      {/* CTA */}
      <Button
        onClick={onNext}
        size="lg"
        className="bg-accent-cyan hover:bg-accent-cyan-dim text-white px-8 shadow-glow-cyan"
      >
        Get Started
        <ArrowRight className="w-5 h-5 ml-2" />
      </Button>
    </div>
  );
}
