import { NextRequest, NextResponse } from 'next/server';

const PROTECTED_ROUTES = ['/dashboard'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Protect dashboard routes: redirect to sign-in if no auth hint cookie
  const isProtected = PROTECTED_ROUTES.some((route) => pathname.startsWith(route));
  if (isProtected) {
    const authHint = request.cookies.get('msal-auth-hint');
    if (!authHint?.value) {
      const signinUrl = new URL('/auth/signin', request.url);
      signinUrl.searchParams.set('callbackUrl', pathname);
      return NextResponse.redirect(signinUrl);
    }
  }

  const response = NextResponse.next();

  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons/).*)'],
};
