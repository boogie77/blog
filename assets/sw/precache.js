import {Plugin as BroadcastUpdatePlugin}
    from 'workbox-broadcast-cache-update/Plugin.mjs';
import PrecacheController
    from 'workbox-precaching/controllers/PrecacheController.mjs';
import {cacheNames} from './caches.js';

/* global PRECACHE_MANIFEST */

const precacheAnalyticsJs = async () => {
  const analyticsJsUrl = 'https://www.google-analytics.com/analytics.js';
  const cache = await caches.open(cacheNames.THIRD_PARTY_ASSETS);
  const match = await cache.match(analyticsJsUrl);

  if (!match) {
    const analyticsJsRequest = new Request(analyticsJsUrl, {mode: 'no-cors'});
    const analyticsJsResponse = await fetch(analyticsJsRequest);
    await cache.put(analyticsJsRequest, analyticsJsResponse.clone());
  }
};

let broadcastUpdatePlugin;
const getOrCreateBroadcastUpdatePlugin = () => {
  if (!broadcastUpdatePlugin) {
    broadcastUpdatePlugin = new BroadcastUpdatePlugin('api-updates', {
      headersToCheck: ['ETag'],
    });
  }
  return broadcastUpdatePlugin;
};

let precacheController;
const getOrCreatePrecacheController = () => {
  if (!precacheController) {
    precacheController = new PrecacheController(cacheNames.LAYOUT);
  }
  return precacheController;
};

export const install = async () => {
  const precacheController = getOrCreatePrecacheController();
  precacheController.addToCacheList(PRECACHE_MANIFEST);

  await precacheController.install();
  await precacheAnalyticsJs();
};

export const activate = async () => {
  const precacheController = getOrCreatePrecacheController();
  await precacheController.activate({
    plugins: [getOrCreateBroadcastUpdatePlugin()],
  });
};
