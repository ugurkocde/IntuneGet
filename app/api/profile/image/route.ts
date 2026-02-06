import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { parseAccessToken } from '@/lib/auth-utils';

const MAX_BASE64_SIZE = 200 * 1024;
const ALLOWED_MIME_PATTERN = /^data:image\/(jpeg|png|webp);base64,/;

export async function GET(request: NextRequest) {
  try {
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const supabase = createServerClient();

    const { data, error } = await supabase
      .from('user_profiles')
      .select('profile_image')
      .eq('id', user.userId)
      .single();

    if (error && error.code !== 'PGRST116') {
      return NextResponse.json(
        { error: 'Failed to fetch profile image' },
        { status: 500 }
      );
    }

    return NextResponse.json({ image: data?.profile_image ?? null });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { image } = body;

    if (!image || typeof image !== 'string') {
      return NextResponse.json(
        { error: 'Image data is required' },
        { status: 400 }
      );
    }

    if (!ALLOWED_MIME_PATTERN.test(image)) {
      return NextResponse.json(
        { error: 'Invalid image format. Accepted: JPEG, PNG, WebP' },
        { status: 400 }
      );
    }

    if (image.length > MAX_BASE64_SIZE) {
      return NextResponse.json(
        { error: 'Image too large. Maximum size is 200KB.' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    const { error } = await supabase
      .from('user_profiles')
      .update({
        profile_image: image,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.userId);

    if (error) {
      return NextResponse.json(
        { error: 'Failed to update profile image' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const supabase = createServerClient();

    const { error } = await supabase
      .from('user_profiles')
      .update({
        profile_image: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.userId);

    if (error) {
      return NextResponse.json(
        { error: 'Failed to remove profile image' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
