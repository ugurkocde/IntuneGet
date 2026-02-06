import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Simple in-memory rate limiting
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = 5; // requests per IP
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (!record || now > record.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return false;
  }

  if (record.count >= RATE_LIMIT) {
    return true;
  }

  record.count++;
  return false;
}

// Clean up old rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of rateLimitMap.entries()) {
    if (now > record.resetTime) {
      rateLimitMap.delete(ip);
    }
  }
}, 60 * 1000);

export async function POST(request: NextRequest) {
  try {
    // Get client IP for rate limiting
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
               request.headers.get('x-real-ip') ??
               'unknown';

    if (isRateLimited(ip)) {
      return NextResponse.json({ success: false }, { status: 429 });
    }

    // Parse request body for count
    let count = 1;
    try {
      const body = await request.json();
      if (typeof body.count === 'number' && body.count > 0) {
        count = body.count;
      }
    } catch {
      // Use default count of 1 if body parsing fails
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    // Silently succeed if Supabase not configured
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ success: true });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Call the increment_counter RPC function
    await supabase.rpc('increment_counter', {
      counter_id: 'apps_deployed',
      amount: count,
    });

    return NextResponse.json({ success: true });
  } catch {
    // Fire-and-forget: silently succeed on error
    return NextResponse.json({ success: true });
  }
}
