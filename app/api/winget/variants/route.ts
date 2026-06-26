import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getLocaleDisplay, countryCodeToFlag } from '@/lib/locale-utils';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const parentId = searchParams.get('id');

    if (!parentId || parentId.length > 200 || !/^[\w.-]+$/.test(parentId)) {
      return NextResponse.json(
        { error: 'Parameter "id" is required and must be a valid package identifier' },
        { status: 400 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { error: 'Database configuration missing' },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data, error } = await supabase.rpc('get_locale_variants', {
      parent_id: parentId,
    });

    if (error) {
      console.error('Error fetching locale variants:', error);
      return NextResponse.json(
        { error: 'Failed to fetch locale variants' },
        { status: 500 }
      );
    }

    const variants = (data || []).map(
      (row: { winget_id: string; locale_code: string; latest_version: string | null }) => {
        const display = getLocaleDisplay(row.locale_code);
        return {
          wingetId: row.winget_id,
          localeCode: row.locale_code,
          localeName: display.name,
          countryFlag: display.flag,
          flagEmoji: countryCodeToFlag(display.flag),
          version: row.latest_version,
        };
      }
    );

    return NextResponse.json({
      parentId,
      count: variants.length,
      variants,
    }, {
      headers: { 'Cache-Control': 'public, max-age=300, s-maxage=600' },
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to fetch locale variants' },
      { status: 500 }
    );
  }
}
