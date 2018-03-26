import {createNavigationRoute} from './routes/navigation-route.js';
import {createPagePartialsRoute} from './routes/page-partials-route.js';
import {createStaticAssetsRoute} from './routes/static-assets-route.js';
import {createThirdPartyAssetsRoute}
    from './routes/third-party-assets-route.js';

export const routes = {
  createNavigationRoute,
  createPagePartialsRoute,
  createStaticAssetsRoute,
  createThirdPartyAssetsRoute,
};
