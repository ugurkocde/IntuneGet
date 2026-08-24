export const CATALOG_BASE_URL = 'https://intuneget.com/apps';

export function categorySlug(category: string): string {
  return category.trim().toLowerCase().replace(/\s+/g, '-');
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
