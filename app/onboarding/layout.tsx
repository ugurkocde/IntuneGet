import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Setup | IntuneGet',
  description: 'Complete your organization setup to start deploying apps to Intune',
};

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-950">
      {children}
    </div>
  );
}
