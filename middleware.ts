import { NextRequest, NextResponse } from 'next/server';
import { createNextMiddleware } from 'gt-next/middleware';

const PROTECTED_ROUTES = ['/dashboard'];

// gt-next locale middleware in cookie-only mode (no path-based locale routing).
// It resolves the UI locale once per request and writes it to the gt locale
// cookie, so the server-rendered locale and the client provider read the same
// value. Without this the locale was re-derived independently on the server
// (Accept-Language) and the client, which showed up as a brief German->English
// flip in client-rendered sections like Uploads (issue #136).
const gtMiddleware = createNextMiddleware({ localeRouting: false });

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

  // Pin the UI locale on page requests. API requests are skipped: their locale
  // is irrelevant and must not drive the shared cookie.
  const response = pathname.startsWith('/api')
    ? NextResponse.next()
    : gtMiddleware(request);

  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'SAMEORIGIN');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons/).*)'],
};
