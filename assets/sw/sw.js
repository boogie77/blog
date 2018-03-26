import {initialize as initializeOfflineAnalytics}
    from 'workbox-google-analytics';
import {Router} from 'workbox-routing/Router.mjs';
import {cacheNames, deleteUnusedCaches} from './caches.js';
import * as precache from './precache.js';
import {routes} from './routes.js';

const dimensions = {
  SERVICE_WORKER_REPLAY: 'cd8',
};
initializeOfflineAnalytics({
  cacheName: cacheNames.THIRD_PARTY_ASSETS,
  parameterOverrides: {[dimensions.SERVICE_WORKER_REPLAY]: 'replay'},
});

const router = new Router();
for (const route of Object.values(routes)) {
  router.registerRoute(route());
}

self.addEventListener('fetch', (evt) => {
  const responsePromise = router.handleRequest(evt);
  if (responsePromise) {
    evt.respondWith(responsePromise);
  }
});

self.addEventListener('install', (evt) => {
  console.log('install', evt);
  const installationComplete = async () => {
    await precache.install();
    self.skipWaiting();
  };

  evt.waitUntil(installationComplete());
});

self.addEventListener('activate', (evt) => {
  console.log('activate', evt);
  const activationComplete = async () => {
    await precache.activate();
    await deleteUnusedCaches();

    // TODO(philipwalton): also delete old IDB databases used by precache
    // or other workbox plugins.
  };
  evt.waitUntil(activationComplete());
});

