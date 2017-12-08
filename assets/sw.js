import 'async-waituntil-polyfill';
import idb from 'idb';
import offlineGoogleAnalytics
    from 'sw-helpers/projects/sw-offline-google-analytics/src';


/* global __CACHE_NAMES__, __CACHE_DATA__,
          __STATIC_ASSETS__, __THIRD_PARTY_ASSETS__ */

const cacheData = __CACHE_DATA__;
const cacheNames = __CACHE_NAMES__;
const staticAssets = __STATIC_ASSETS__;
const thirdPartyAssets = __THIRD_PARTY_ASSETS__;
const contentPartialsSuffix = __CONTENT_PARTIALS_SUFFIX__;


// Maps relevant custom dimension names to their index.
const dimensions = {
  SERVICE_WORKER_REPLAY: 'cd8',
};


const startupTime = new Date();

console.log(startupTime, cacheData);


const cloneResponseAndUpdateHeaders = async (response, newHeaders = {}) => {
  const clone = response.clone();
  const body = await clone.text();
  const copy = new Response(body, clone);

  for (const [key, value] of Object.entries(newHeaders)) {
    copy.headers.set(key, value);
  }
  return copy;
}


const cacheAnalyticsJs = async () => {
  const analyticsJsRequest =
      new Request(thirdPartyAssets.ANALYTICSJS_URL, {mode: 'no-cors'});

  const [cache, analyticsJsResponse] = await Promise.all([
    caches.open(cacheNames.THIRD_PARTY_ASSETS),
    fetch(analyticsJsRequest),
  ]);

  return cache.put(analyticsJsRequest, analyticsJsResponse.clone());
};


const cachePageAssets = async () => {
  const cache = await caches.open(cacheNames.STATIC_ASSETS);
  cache.addAll([
    staticAssets.MAIN_JS_URL,
    staticAssets.MAIN_RUNTIME_URL,
  ]);
};


const cacheInitialAssets = () => Promise.all([
  cachePageAssets(),
  cacheAnalyticsJs(),
]);


const getCacheNameFromRequestUrl = ({pathname}) => {
  if (pathname.startsWith('/static/')) {
    return cacheNames.STATIC_ASSETS;
  } else if (pathname.endsWith(contentPartialsSuffix)) {
    return cacheNames.CONTENT;
  } else if (pathname == '/' ||
      pathname.startsWith('/about/') ||
      pathname.startsWith('/articles/')) {
    return cacheNames.PAGES;
  }
};


const getContentPartialPath = (pathname) => {
  if (pathname.endsWith('/')) {
    pathname += 'index.html';
  }

  return pathname.replace(/\.\w+$/, contentPartialsSuffix);
};


const cacheFirst = async (event, cacheName) => {
  const {pathname} = new URL(event.request.url);
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(pathname);

  if (cachedResponse) {
    // Return the cached response, but (in the background) check to see if the
    // cached reponse is up-to-date. If it's not then update the cache.

    event.waitUntil((async () => {
      // Check IndexedDB to see if the stored hash for the request matches the
      // hash in the service worker script. If it doesn't, fetch the new
      // content, update the cache, and inform the client of new content.
      const pageHash = await getPageContentVersion(pathname);

      if (pageHash != cacheData.pages[pathname]) {
        console.log(`Cached content for ${pathname} is out of date. Updating...`);
        console.log(cacheData.pages[pathname], pageHash);
        debugger;
        await Promise.all([
          cache.add(pathname),
          setPageContentVersion(pathname, cacheData.pages[pathname]),
        ]);
      }
    })());

    console.log('returning cached response...');
    return cachedResponse;
  } else {
    const networkResponse = await fetch(pathname);
    const networkResponseClone = await networkResponse.clone();

    if (networkResponse.ok) {
      event.waitUntil(Promise.all([
        cache.put(pathname, networkResponseClone),
        setPageContentVersion(pathname, cacheData.pages[pathname]),
      ]));
    }

    // console.log(startupTime);
    // console.log(new Date(networkResponse.headers.get('Last-Modified')));

    console.log('returning network response...');
    return networkResponse;
  }
};


self.addEventListener('fetch', (event) => {
  const {request} = event;
  const url = new URL(request.url);

  // Use a cache-first strategy for all same-origin GET requests.
  // The URL of the request will determine the cache to use.
  if (request.method == 'GET' &&
      url.origin == location.origin) {
    const cacheName = getCacheNameFromRequestUrl(url);

    // If no matching cacheName is found, respond as normal. Note, this won't
    // happen through normal navigation but may happen with a browser extension
    // or manually via devtools console.
    if (!cacheName) return;

    if (cacheName != cacheNames.CONTENT) return;

    event.respondWith(cacheFirst(event, cacheName));
  }
});


const openContentVersionsDb = (() => {
  let contentVersionsDb;
  return async () => {
    return contentVersionsDb || (contentVersionsDb = await idb.open(
        'pw:content-versions', 1, (upgradeDB) => {
      upgradeDB.createObjectStore('layouts');
      upgradeDB.createObjectStore('pages');
    }));
  };
})();



const getLayoutContentVersion = async (layout) => {
  const db = await openContentVersionsDb();
  return db.transaction('layouts')
      .objectStore('layouts').get(layout);
}

const getPageContentVersion = async (path) => {
  const db = await openContentVersionsDb();
  return db.transaction('pages')
      .objectStore('pages').get(path);
}

const setLayoutContentVersion = async (layout, version) => {
  const db = await openContentVersionsDb();
  const tx = db.transaction('layouts', 'readwrite');
  tx.objectStore('layouts').put(version, layout)

  await tx.complete;
};

const setPageContentVersion = async (path, version) => {
  const db = await openContentVersionsDb();
  const tx = db.transaction('pages', 'readwrite');
  tx.objectStore('pages').put(version, path)

  await tx.complete;
};


self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    await cacheInitialAssets();
    console.log(cacheData);

    const storedShellHash = await getLayoutContentVersion('shell');

    // Hashes that dont' match means either the shell layout doesn't exist
    // or it's out of date. In either case, refetch it and update.
    if (storedShellHash != cacheData.layouts.shell) {
      try {
        const cache = await caches.open(cacheNames.CONTENT);
        cache.addAll([
          '/shell-start.html',
          '/shell-end.html',
        ]);

        setLayoutContentVersion('shell', cacheData.layouts.shell);
      } catch (err) {
        console.error(err);
      }
    }
  })());
});


self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});


offlineGoogleAnalytics.initialize({
  parameterOverrides: {[dimensions.SERVICE_WORKER_REPLAY]: 'replay'},
});
