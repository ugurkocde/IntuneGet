import SignInClient from './SignInClient';
import { getSafeInternalRedirect } from '@/lib/auth/post-auth-redirect';

// Resolve the callback before rendering so the form does not sit behind a
// client search-params Suspense boundary while JavaScript loads.
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string | string[] }>;
}) {
  const params = await searchParams;
  const callback = Array.isArray(params.callbackUrl) ? params.callbackUrl[0] : params.callbackUrl;
  return <SignInClient callbackUrl={getSafeInternalRedirect(callback)} />;
}
