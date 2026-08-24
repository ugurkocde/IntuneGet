export const CATALOG_BASE_URL = 'https://intuneget.com/apps';

export function categorySlug(category: string): string {
  return category.trim().toLowerCase().replace(/\s+/g, '-');
}

const CATEGORY_DISPLAY_OVERRIDES: Record<string, string> = {
  devops: 'DevOps',
  ide: 'IDEs',
};

/**
 * Human-readable category name from a stored category value or slug.
 * Stored values are lowercase slugs ("developer-tools"), so title-case each
 * word unless a nicer override exists.
 */
export function categoryDisplayName(category: string): string {
  const slug = categorySlug(category);
  const override = CATEGORY_DISPLAY_OVERRIDES[slug];
  if (override) return override;
  return slug
    .split('-')
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ');
}

/**
 * The catalog stores category values with inconsistent casing ("Business" and
 * "business" both exist), so raw category counts contain duplicates. Merge
 * them by slug, summing counts, sorted by count descending.
 */
export function mergeCategoryCounts(
  categories: { category: string; count: number }[]
): { slug: string; name: string; count: number }[] {
  const merged = new Map<string, number>();
  for (const { category, count } of categories) {
    const slug = categorySlug(category);
    if (!slug) continue;
    merged.set(slug, (merged.get(slug) ?? 0) + count);
  }
  return Array.from(merged, ([slug, count]) => ({
    slug,
    name: categoryDisplayName(slug),
    count,
  })).sort((a, b) => b.count - a.count);
}

export function appCatalogHref(wingetId: string): string {
  return `/apps/${encodeURIComponent(wingetId)}`;
}

export function absoluteAppCatalogUrl(wingetId: string): string {
  return `${CATALOG_BASE_URL}/${encodeURIComponent(wingetId)}`;
}

export function resolveCatalogIconUrl(app: { winget_id: string; icon_path?: string | null }): string {
  if (app.icon_path?.startsWith('http')) return app.icon_path;
  const base = (app.icon_path || `/icons/${app.winget_id}/`).replace(/\/?$/, '/');
  return `https://intuneget.com${base}icon-128.png`;
}
