import {Route} from 'workbox-routing/Route.mjs';
import {cacheNames} from '../caches.js';

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

const navigationMatcher = ({event, url}) => {
  return event.request.mode === 'navigate' &&
      url.hostname === location.hostname &&
      (url.pathname === '/' ||
      url.pathname.match(/^\/(?:about|articles)\/([\w-]+\/)?/));
};

const navigationHandler = async ({url, event}) => {
  try {
    const layoutCache = await caches.open(cacheNames.LAYOUT);
    const responsesText = await Promise.all([
      getResponseText(layoutCache.match('/shell-start.html')),
      getResponseText(getPageContentFromCacheOrNetwork(url)),
      getResponseText(layoutCache.match('/shell-end.html')),
    ]);

    console.log('Building page from cache...');
    return new Response(responsesText.join(''), {
      headers: {'Content-Type': 'text/html; charset=utf-8'},
    });
  } catch (err) {
    console.error(
        'Error building page from cache, falling back to network', err);
    return await fetch(event.request);
  }
};

export const createNavigationRoute = () => {
  return new Route(navigationMatcher, navigationHandler);
};
