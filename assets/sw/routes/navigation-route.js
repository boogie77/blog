import {Plugin as BroadcastUpdatePlugin}
    from 'workbox-broadcast-cache-update/Plugin.mjs';
import {Route} from 'workbox-routing/Route.mjs';
import {CacheFirst} from 'workbox-strategies/CacheFirst.mjs';

import {pagePartialsHandler} from './page-partials-route.js';
import {cacheNames} from '../caches.js';
import {createFakeFetchEvent} from '../utils.js';

const getResponseText = async (responsePromise) => {
  const response = await responsePromise;
  return await response.text();
};

const navigationMatcher = ({event, url}) => {
  // return event.request.mode === 'navigate' &&
  return url.hostname === location.hostname &&
      (url.pathname === '/' ||
      url.pathname.match(/^\/(?:about|articles)\/([\w-]+\/)?$/));
};

const cacheFirstHandler = new CacheFirst({
  cacheName: cacheNames.LAYOUT,
  plugins: [
    new BroadcastUpdatePlugin('api-updates', {
      headersToCheck: ['ETag', 'Content-Length'],
    }),
  ],
});

const navigationHandler = async ({url, event}) => {
  try {
    const shellStartEvent = createFakeFetchEvent(`/shell-start.html`);
    const shellEndEvent = createFakeFetchEvent(`/shell-end.html`);
    const pagePartialsEvent = createFakeFetchEvent(
        `${url.pathname}index.content.html`);

    const responsesText = await Promise.all([
      getResponseText(cacheFirstHandler.handle({event: shellStartEvent})),
      getResponseText(pagePartialsHandler.handle({event: pagePartialsEvent})),
      getResponseText(cacheFirstHandler.handle({event: shellEndEvent})),
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
