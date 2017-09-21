import {delegate, parseUrl} from 'dom-utils';
import * as alerts from './alerts';
import {gaTest, trackError} from './analytics';
import * as drawer from './drawer';
import History2 from './history2';
import Timer from './timer.js';


// Cache the container element to avoid multiple lookups.
let container;


// Store the result of page data requests to avoid multiple
// lookups when navigating to a previously seen page.
const pageCache = {};


/**
 * Fetches the page data for the passed path and tracks how long it takes.
 * If the content is already in the page cache, do not make an unnecessary
 * fetch request. If an error occurs making the request, show an alert to the
 * user.
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

  if (pageCache[path]) {
    timer.stop();
    gaTest('send', 'event', Object.assign(gaEventData, {
      eventValue: Math.round(timer.duration),
      eventLabel: 'cache',
    }));

    return pageCache[path];
  } else {
    try {
      const response = await fetch(`${path}index.json`);

      let data;
      if (response.ok) {
        data = await response.json();
      } else {
        throw new Error(
            `Response: (${response.status}) ${response.statusText}`);
      }

      timer.stop();
      gaTest('send', 'event', Object.assign(gaEventData, {
        eventValue: Math.round(timer.duration),
        eventLabel: 'network',
      }));

      return pageCache[path] = data;
    } catch (err) {
      const message = (err instanceof TypeError) ?
          'Check your network connection to ensure you\'re still online.' :
          err.message;

      alerts.add({
        title: `Oops, there was an error making your request`,
        body: message,
      });

      // Rethrow to be able to catch it again in an outer scope.
      throw err;
    }
  }
};


/**
 * Update the <main> element with the new content and set the new title.
 * @param {string} content The content to set to the page container.
 */
const updatePage = ({content, title}) => {
  container.innerHTML = content;
  document.title = title;
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

  // Add the current page to the cache.
  container = document.querySelector('main');
  pageCache[location.pathname] = {
    content: container.innerHTML,
    title: document.title,
  };

  const history2 = new History2(async (state) => {
    try {
      const data = await fetchPage(state.pathname);

      updatePage(data);
      drawer.close();
      setScroll(state.hash);
      resetImpressionTracking();
    } catch (err) {
      trackError(/** @type {!Error} */ (err));
    }
  });

  delegate(document, 'click', 'a[href]', function(event, delegateTarget) {
    // Don't load content if the user is doing anything other than a normal
    // left click to open a page in the same window.
    if (// On mac, command clicking will open a link in a new tab. Control
        // clicking does this on windows.
        event.metaKey || event.ctrlKey ||
        // Shift clicking in Chrome/Firefox opens the link in a new window
        // In Safari it adds the URL to a favorites list.
        event.shiftKey ||
        // On Mac, clicking with the option key is used to download a resouce.
        event.altKey ||
        // Middle mouse button clicks (which == 2) are used to open a link
        // in a new tab, and right clicks (which == 3) on Firefox trigger
        // a click event.
        event.which > 1) return;

    const page = parseUrl(location.href);
    const link = parseUrl(delegateTarget.href);

    if (/\.(png|svg)$/.test(link.href)) return;

    // Don't do anything when clicking on links to the current URL.
    if (link.href == page.href) event.preventDefault();

    // If the clicked link is on the same site but has a different path,
    // prevent the browser from navigating there and load the page via ajax.
    if ((link.origin == page.origin) && (link.pathname != page.pathname)) {
      event.preventDefault();
      history2.add({
        url: link.href,
      });
    }
  });
};
