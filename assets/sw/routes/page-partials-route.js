import {Plugin as BroadcastUpdatePlugin}
    from 'workbox-broadcast-cache-update/Plugin.mjs';
import {Route} from 'workbox-routing/Route.mjs';
import {StaleWhileRevalidate}
    from 'workbox-strategies/StaleWhileRevalidate.mjs';
import {cacheNames} from '../caches.js';

const pagePartialsMatcher = ({url}) => {
  return url.hostname === location.hostname &&
      url.pathname.endsWith('index.content.html');
};

const pagePartialsHandler = new StaleWhileRevalidate({
  cacheName: cacheNames.PAGES,
  plugins: [
    new BroadcastUpdatePlugin('api-updates', {
      headersToCheck: ['ETag'],
    }),
  ],
});

export const createPagePartialsRoute = () => {
  return new Route(pagePartialsMatcher, pagePartialsHandler);
};
