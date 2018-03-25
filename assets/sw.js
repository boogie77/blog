// import core, {LOG_LEVELS} from 'workbox-core';

import {Plugin as BroadcastUpdatePlugin} from 'workbox-broadcast-cache-update/Plugin.mjs';
import {initialize as initializeOfflineAnalytics} from 'workbox-google-analytics';
import PrecacheController from 'workbox-precaching/controllers/PrecacheController.mjs';
import {Route} from 'workbox-routing/Route.mjs';
import {Router} from 'workbox-routing/Router.mjs';
import {CacheFirst} from 'workbox-strategies/CacheFirst.mjs';
import {StaleWhileRevalidate} from 'workbox-strategies/StaleWhileRevalidate.mjs';


/* global PRECACHE_MANIFEST */

const cacheNames = {
  LAYOUT: 'pw:laytout',
  LAYOUT_TEMP: 'pw:laytout-temp',
  PAGES: 'pw:pages',
  STATIC_ASSETS: 'pw:static',
  GOOGLE_ANALYTICS: 'pw:analytics',
};


// Maps relevant custom dimension names to their index.
const dimensions = {
  SERVICE_WORKER_REPLAY: 'cd8',
};

// precaching.precache(PRECACHE_MANIFEST);

const precache = new PrecacheController(cacheNames.LAYOUT);
precache.addToCacheList(PRECACHE_MANIFEST);


const broadcastUpdatePlugin = new BroadcastUpdatePlugin('api-updates', {
  headersToCheck: ['ETag'],
});


// core.setLogLevel(LOG_LEVELS.debug);


const fullPageMatcher = ({event, url}) => {
  return event.request.mode === 'navigate' &&
      url.hostname === location.hostname &&
      (url.pathname === '/' ||
      url.pathname.match(/^\/(about|articles)\/([\w-]+\/)?/));
};

const getResponseText = async (responsePromise) => {
  const response = await responsePromise;
  return await response.text();
};

// Promise.race doesn't work because it rejects if any of the promises it's
// passed rejects before any of them fulfill. What we want is a function
// that fulfills as soon as any of its passed promises fulfill and only
// rejects if *all* of them reject.
const promiseFirst = (promises) => {
  return new Promise((resolve, reject) => {
    // Resolve the main promise as soon as any of the passed promises resolve.
    promises.forEach((p) => p.then(resolve));
    // Rejects the main promise only if all passed promises reject.
    promises
        .reduce((a, b) => a.catch(() => b))
        .catch(() => reject(new Error('No promises were fulfilled')));
  });
};

const getPageContentFromCacheOrNetwork = async (url) => {
  const resource = `${url.pathname}index.content.html`;
  const getResourceFromCache = async (resource) => {
    const pagesCache = await caches.open(cacheNames.PAGES);
    return await pagesCache.match(resource);
  };
  const getResourceFromNetwork = async (resource) => {
    const response = await fetch(resource);

    if (response.ok) {
      // Don't await the cache put here. Asynchronously cache it,
      // so the response can be returned immediately below.
      const responseClone = response.clone();
      (async () => {
        const pagesCache = await caches.open(cacheNames.PAGES);
        pagesCache.put(resource, responseClone);
      })();
    }
    return response;
  };

  return promiseFirst([
    getResourceFromCache(resource),
    getResourceFromNetwork(resource),
  ]);
};


const fullPageHandler = async ({url, event}) => {
  try {
    const layoutCache = await caches.open(cacheNames.LAYOUT);
    const responsesText = await Promise.all([
      getResponseText(layoutCache.match('/shell-start.html')),
      getResponseText(getPageContentFromCacheOrNetwork(url)),
      getResponseText(layoutCache.match('/shell-end.html')),
    ]);

    console.log('Building page from cache...')
    return new Response(responsesText.join(''), {
      headers: {'Content-Type': 'text/html; charset=utf-8'},
    });
  } catch (err) {
    console.error('Error building page from cache, falling back to network', err);
    return await fetch(event.request);
  }
};

const fullPageRoute = new Route(fullPageMatcher, fullPageHandler);


const partialPageMatcher = ({url}) => {
  return url.hostname === location.hostname &&
      url.pathname.endsWith('index.content.html');
};

const partialPageHandler = new StaleWhileRevalidate({
  cacheName: cacheNames.PAGES,
  plugins: [broadcastUpdatePlugin],
});
const partialPageRoute = new Route(partialPageMatcher, partialPageHandler);


const staticAssetsMatcher = ({url}) => {
  return url.hostname === location.hostname &&
    url.pathname.startsWith('/static/');
};

const staticAssetsHandler = new CacheFirst({
  cacheName: cacheNames.STATIC_ASSETS,
});
const staticAssetsRoute = new Route(staticAssetsMatcher, staticAssetsHandler);


const router = new Router();
router.registerRoute(fullPageRoute);
router.registerRoute(partialPageRoute);
router.registerRoute(staticAssetsRoute);


initializeOfflineAnalytics({
  cacheName: cacheNames.GOOGLE_ANALYTICS,
  parameterOverrides: {[dimensions.SERVICE_WORKER_REPLAY]: 'replay'},
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
    const {updatedEntries} = await precache.install({
      plugins: [broadcastUpdatePlugin],
    });

    self.skipWaiting();
    console.log('Skipping waiting...');
  };

  evt.waitUntil(installationComplete());
});

self.addEventListener('activate', (evt) => {
  console.log('activate', evt);

  const activationComplete = async () => {
    await precache.activate({
      plugins: [broadcastUpdatePlugin],
    });
    console.log('Done activating precache...');

    // Delete old caches.
    const usedCacheNames = await caches.keys();
    const validCacheNames = new Set(Object.values(cacheNames));
    for (const usedCacheName of usedCacheNames) {
      if (!validCacheNames.has(usedCacheName)) {
        console.log('Deleting', usedCacheName);
        await caches.delete(usedCacheName);
      }
    }
    console.log('Cleaned up old caches...');
  };
  evt.waitUntil(activationComplete());
});
