import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { password } = await request.json();

    // Check if password protection is enabled
    const sitePassword = process.env.SITE_PASSWORD;
    if (!sitePassword) {
      return NextResponse.json(
        { success: true, message: 'Password protection is disabled' },
        { status: 200 }
      );
    }

    // Validate password
    if (!password || password !== sitePassword) {
      return NextResponse.json(
        { success: false, error: 'Invalid password' },
        { status: 401 }
      );
    }

    // Create response with success
    const response = NextResponse.json(
      { success: true },
      { status: 200 }
    );

    // Set HttpOnly cookie for 30 days
    const thirtyDaysInSeconds = 30 * 24 * 60 * 60;
    const isProduction = process.env.NODE_ENV === 'production';

    response.cookies.set('site_access', 'granted', {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: thirtyDaysInSeconds,
      path: '/',
    });

    return response;
  } catch {
    return NextResponse.json(
      { success: false, error: 'An error occurred' },
      { status: 500 }
    );
  }
}
