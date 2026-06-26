import { NextResponse } from 'next/server';
import { getCategories } from '@/lib/winget-api';
import { getCatalogSource } from '@/lib/catalog';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function GET() {
  try {
    const categories = await getCategories();

    // Get actual total count of verified apps (not just sum of categories)
    let totalApps = categories.reduce((sum, cat) => sum + cat.count, 0);

    const count = await getCatalogSource().getCategoryCount({ verifiedOnly: true });

    if (count !== null) {
      totalApps = count;
    }

    return NextResponse.json({
      count: categories.length,
      totalApps,
      categories,
    }, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to fetch categories' },
      { status: 500, headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  }
}
