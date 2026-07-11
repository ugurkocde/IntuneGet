import { NextResponse } from 'next/server';
import { getPublicLandingStats } from '@/lib/stats/public-stats';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0, must-revalidate',
};

export async function GET() {
  const stats = await getPublicLandingStats();
  return NextResponse.json(stats, { headers: NO_STORE_HEADERS });
}
