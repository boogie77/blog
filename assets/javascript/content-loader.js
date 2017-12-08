import * as alerts from './alerts';
import {gaTest, trackError, NULL_VALUE} from './analytics';
import * as drawer from './drawer';
import History2 from './history2';
import Timer from './timer.js';


/* global __STATIC_ASSETS__, __CACHE_NAMES__, __ANALYTICSJS_URL__ */
// const cacheNames = __CACHE_NAMES__;
// const staticAssts = STATIC_ASSETS;
// const thirdPartyAssets = THIRD_PARTY_ASSETS;


const CONTENT_SUFFIX = '.content.html';


const getContentPartialPath = (pagePath) => {
  if (pagePath.endsWith('/')) {
    pagePath += 'index.html';
  }
  return pagePath.replace(/\.html$/, CONTENT_SUFFIX);
}



/**
 * Fetches the page data for the passed path and tracks how long it takes.
 * If an error occurs making the request, show an alert to the user.
 * @param {string} path The page path to load.
 * @return {!Promise} A promise that fulfills with an object containing the
 *    content and title of a page or rejects with the network error.
 */
const fetchPage = async (path) => {
  const timer = new Timer().start();
  const gaEventData = {
    eventCategory: 'Virtual Pageviews',
    eventAction: 'fetch',
    page: path,
  };

  try {
    const response = await fetch(getContentPartialPath(path));

    let content;
    if (response.ok) {

      // console.log('*** window ***');
      // for (const [key, value] of response.headers.entries()) {
      //   console.log(key, value);
      // }


      content = await response.text();
    } else {
      throw new Error(
          `Response: (${response.status}) ${response.statusText}`);
    }

    timer.stop();
    gaTest('send', 'event', Object.assign(gaEventData, {
      eventValue: Math.round(timer.duration),
      // TODO(philipwalton): track cache hits vs network requests.
      eventLabel: NULL_VALUE,
    }));

    return content;
  } catch (err) {
    const message = (err instanceof TypeError) ?
        `Check your network connection to ensure you're still online.` :
        err.message;

    alerts.add({
      title: `Oops, there was an error making your request`,
      body: message,
    });

    // Rethrow to be able to catch it again in an outer scope.
    throw err;
  }
};


/**
 * Update the <main> element with the new content and set the new title.
 * @param {string} content The content to set to the page container.
 */
const updatePage = (content) => {
  document.getElementById('content').innerHTML = content;
};


/**
 * Sets the scroll position of the main document to the top of the page or
 * to the position of an element if a hash fragment is passed.
 * @param {string} hash The hash fragment of a URL to match with an element ID.
 */
const setScroll = (hash) => {
  const target = hash && document.getElementById(hash.slice(1));
  const scrollPos = target ? target.offsetTop : 0;

  // TODO: There's a weird bug were sometimes this function doesn't do anything
  // if the browser has already visited the page and thinks it has a scroll
  // position in mind.
  window.scrollTo(0, scrollPos);
};


/**
 * Removes and re-adds impression observation on the #share call to action
 * since a new page has loaded and thus a new impression should be possible.
 */
const resetImpressionTracking = () => {
  gaTest('impressionTracker:unobserveAllElements');
  gaTest('impressionTracker:observeElements', ['share']);
};


/**
 * Initializes the dynamic, page-loading code.
 */
export const init = () => {
  // Only load external content via AJAX if the browser support pushState.
  if (!(window.history && window.history.pushState)) return;

  new History2({
    onBeforeChange: async (state) => {
      try {
        const content = await fetchPage(state.pathname);

        updatePage(content);
        drawer.close();
        setScroll(state.hash);
        resetImpressionTracking();
      } catch (err) {
        trackError(/** @type {!Error} */ (err));
        throw err;
      }
    },
    // onAfterChange: async (state) => {},
  });
};
