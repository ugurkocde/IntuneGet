import type { CatalogSource, WingetIdLatestVersion } from '@/lib/catalog/types';
import { isCuratedPackageId } from './core.mjs';

/** Independent source failures never become updates or stop the other source. */
export function withCuratedUpdates(base: CatalogSource, curated: () => Promise<WingetIdLatestVersion[]>): CatalogSource {
  return new Proxy(base, {
    get(target, property) {
      if (property === 'getAllLatestVersions' || property === 'getAppsByWingetIds') {
        return async (ids?: string[]) => {
          const ordinaryIds = ids?.filter(id => !isCuratedPackageId(id));
          const needsCurated = !ids || ids.some(isCuratedPackageId);
          const results = await Promise.allSettled([
            property === 'getAllLatestVersions' ? target.getAllLatestVersions()
              : ordinaryIds?.length ? target.getAppsByWingetIds(ordinaryIds) : Promise.resolve([]),
            needsCurated ? curated() : Promise.resolve([]),
          ]);
          for (let index = 0; index < results.length; index++) {
            if (results[index].status === 'rejected') console.warn(`Update lookup unavailable for ${index === 0 ? 'Winget' : 'curated'} catalog.`);
          }
          if (results.every(result => result.status === 'rejected')) throw new Error('Application update catalogs are unavailable.');
          const ordinary = results[0].status === 'fulfilled' ? results[0].value : [];
          const approved = results[1].status === 'fulfilled' ? results[1].value : [];
          const wanted = ids && new Set(ids.map(id => id.toLowerCase()));
          return [...ordinary.filter(app => !isCuratedPackageId(app.winget_id)),
            ...approved.filter(app => isCuratedPackageId(app.winget_id) && (!wanted || wanted.has(app.winget_id.toLowerCase())))];
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
