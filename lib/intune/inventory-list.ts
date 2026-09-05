import type { IntuneWin32App, InventoryListApp } from '@/types/inventory';

export function toInventoryListApp(app: IntuneWin32App): InventoryListApp {
  return {
    id: app.id, displayName: app.displayName, description: app.description,
    publisher: app.publisher, displayVersion: app.displayVersion,
    createdDateTime: app.createdDateTime, lastModifiedDateTime: app.lastModifiedDateTime,
    size: app.size, installExperience: app.installExperience, hasIcon: Boolean(app.largeIcon?.value),
  };
}

// Only an opaque Graph pagination token is accepted from the caller. Never
// follow a client-supplied URL with the service principal's Authorization header.
export function inventoryPageUrl(cursor: string | null): string {
  const url = new URL('https://graph.microsoft.com/beta/deviceAppManagement/mobileApps');
  url.searchParams.set('$filter', "isof('microsoft.graph.win32LobApp')");
  url.searchParams.set('$orderby', 'displayName');
  url.searchParams.set('$top', '100');
  if (cursor) url.searchParams.set('$skiptoken', cursor);
  return url.toString();
}
