import {initialize as initializeOfflineAnalytics}
    from 'workbox-google-analytics';
import {cacheNames, deleteUnusedCaches} from './caches.js';
import {installPrecache, activatePrecache} from './precache.js';
import {router} from './router.js';
import {createFakeFetchEvent} from './utils.js';

import core, {LOG_LEVELS} from 'workbox-core';
core.setLogLevel(LOG_LEVELS.debug);

const dimensions = {
  SERVICE_WORKER_REPLAY: 'cd8',
};
initializeOfflineAnalytics({
  cacheName: cacheNames.THIRD_PARTY_ASSETS,
  parameterOverrides: {[dimensions.SERVICE_WORKER_REPLAY]: 'replay'},
});

self.addEventListener('message', async (evt) => {
  if (evt.data.cmd === 'CACHE_LOADED_RESOURCES') {
    for (const url of evt.data.urls) {
      const fakeFetchEvent = createFakeFetchEvent(url);
      console.log('Handling fake route for', url);

      evt.waitUntil(router.handleRequest(fakeFetchEvent));
    }
  }
});

self.addEventListener('fetch', (evt) => {
  const responsePromise = router.handleRequest(evt);
  if (responsePromise) {
    evt.respondWith(responsePromise);
  }
});

self.addEventListener('install', (evt) => {
  console.log('install', evt);
  const installationComplete = async () => {
    await installPrecache();
    self.skipWaiting();
  };

  evt.waitUntil(installationComplete());
});

self.addEventListener('activate', (evt) => {
  console.log('activate', evt);
  const activationComplete = async () => {
    await activatePrecache();
    await deleteUnusedCaches();

    // TODO(philipwalton): also delete old IDB databases used by precache
    // or other workbox plugins.
  };
  evt.waitUntil(activationComplete());
});
