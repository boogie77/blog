import {delegate, parseUrl} from 'dom-utils';
import * as alerts from './alerts';
import {gaTest, trackError} from './analytics';
import * as drawer from './drawer';
import History2 from './history2';
import Timer from './timer.js';


// Cache the container element to avoid multiple lookups.
let container;

// Store the result of page content requests to avoid multiple
// lookups when navigation to a previously seen page.
const pageCache = {};


/**
 * Gets the title of a page from a link element.
 * @param {!Element} a The `<a>`` element.
 * @return {string} The title of the page the link will load.
 */
const getTitle = (a) => {
  const title = a.title || a.innerText;
  return title ? title + ' \u2014 Philip Walton' : '';
};


/**
 * Extracts the markup from inside the `<main>` element of an HTML document.
 * @param {string} html The full HTML document text.
 * @return {string} Just the content inside `<main>`.
 */
const getMainContent = (html) => {
  const match = /<main[^>]*>([\s\S]*)<\/main>/.exec(html);
  return match ? match[1] : '';
};


/**
 * Fetches the content of a page at the passed page path and track how long it
 * takes. If the content is already in the page cache, do not make an
 * unnecessary fetch request. If an error occurs making the request, show
 * an alert to the user.
 * @param {string} path The page path to load.
 * @return {!Promise} A promise that fulfills with the HTML content of a
 *    page or rejects with the network error.
 */
const fetchPageContent = async (path) => {
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
      const response = await fetch(path);

      let html;
      if (response.ok) {
        html = await response.text();
      } else {
        throw new Error(
            `Response: (${response.status}) ${response.statusText}`);
      }

      const content = getMainContent(html);
      // TODO(philipwalton):
      // const title = getTitle(html);
      // const canonical = getCanonical(html);

      if (!content) {
        throw new Error(`Could not parse content from response: ${path}`);
      } else {
        timer.stop();
        gaTest('send', 'event', Object.assign(gaEventData, {
          eventValue: Math.round(timer.duration),
          eventLabel: 'network',
        }));

        pageCache[path] = content;
        return content;
      }
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
 * Adds the new content to the page.
 * @param {string} content The content to set to the page container.
 */
const showPageContent = (content) => {
  container.innerHTML = content;
};


/**
 * Executes any scripts added to the container element since they're not
 * automatically added via `innerHTML`.
 */
const executeContainerScripts = () => {
  const containerScripts = [...container.getElementsByTagName('script')];

  for (const containerScript of containerScripts) {
    // Remove the unexecuted container script.
    containerScript.parentNode.removeChild(containerScript);

    const activeScript = document.createElement('script');
    activeScript.text = containerScript.text;
    container.appendChild(activeScript);
  }
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
  pageCache[location.pathname] = container.innerHTML;

  const history2 = new History2(async (state) => {
    try {
      const content = await fetchPageContent(state.pathname);

      showPageContent(content);
      executeContainerScripts();
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
        title: getTitle(delegateTarget),
      });
    }
  });
};
