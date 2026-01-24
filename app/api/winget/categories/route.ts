import { NextResponse } from 'next/server';
import { getCategories } from '@/lib/winget-api';

export const runtime = 'edge';

export async function GET() {
  try {
    const categories = await getCategories();

    return NextResponse.json({
      count: categories.length,
      categories,
    });
  } catch (error) {
    console.error('Categories fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch categories' },
      { status: 500 }
    );
  }
}
