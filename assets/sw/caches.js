export const cacheNames = {
  LAYOUT: 'pw:v1:layout',
  LAYOUT_TEMP: 'pw:v1:layout-temp',
  PAGES: 'pw:v1:pages',
  STATIC_ASSETS: 'pw:v1:static',
  THIRD_PARTY_ASSETS: 'pw:v1:third-party-assets',
};

export const deleteUnusedCaches = async () => {
  const usedCacheNames = await caches.keys();
  const validCacheNames = new Set(Object.values(cacheNames));
  for (const usedCacheName of usedCacheNames) {
    if (!validCacheNames.has(usedCacheName)) {
      await caches.delete(usedCacheName);
    }
  }
};
