import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Paths that require password protection
const PROTECTED_PATHS = [
  '/auth/signin',
  '/auth/error',
  '/dashboard',
  '/onboarding',
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip if SITE_PASSWORD is not set (disabled protection)
  if (!process.env.SITE_PASSWORD) {
    return NextResponse.next();
  }

  // Allow password page and auth API
  if (pathname === '/site-password' || pathname === '/api/site-auth') {
    return NextResponse.next();
  }

  // Check if this is a protected path
  const isProtectedPath = PROTECTED_PATHS.some((path) => pathname.startsWith(path));

  if (!isProtectedPath) {
    return NextResponse.next();
  }

  // Check for access cookie
  const accessCookie = request.cookies.get('site_access');

  if (accessCookie?.value === 'granted') {
    return NextResponse.next();
  }

  // Redirect to password page
  const url = request.nextUrl.clone();
  url.pathname = '/site-password';
  url.searchParams.set('from', pathname);

  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    '/auth/:path*',
    '/dashboard/:path*',
    '/onboarding/:path*',
    '/site-password',
    '/api/site-auth',
  ],
};
