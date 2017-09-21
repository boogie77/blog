const fs = require('fs-extra');
const he = require('he');
const hljs = require('highlight.js');
const htmlMinifier = require('html-minifier');
const MarkdownIt = require('markdown-it');
const markdownItAnchor = require('markdown-it-anchor');
const moment = require('moment-timezone');
const nunjucks = require('nunjucks');
const path = require('path');
const striptags = require('striptags');
const {getRevisionedAssetUrl} = require('./static');

const book = require('../book');
const config = require('../config.json');


const env = nunjucks.configure('templates', {
  autoescape: false,
  watch: false,
});

env.addFilter('format', (str, formatString) => {
  return moment.tz(str, book.site.timezone).format(formatString);
});

env.addFilter('revision', (filename) => {
  return getRevisionedAssetUrl(filename);
});

env.addFilter('addSuffix', (title) => {
  const {titleSuffix} = book.site;
  return title.endWith(titleSuffix) ? title : `${title}${titleSuffix}`;
});

env.addFilter('encode', (content) => {
  return he.encode(content, {useNamedReferences: true});
});

const inlineCache = {};
env.addFilter('inline', (filepath) => {
  if (!inlineCache[filepath]) {
    try {
      inlineCache[filepath] = fs.readFileSync(`build/${filepath}`, 'utf-8');
    } catch (err) {
      if (process.env.NODE_ENV == 'production') {
        throw err;
      } else {
        console.warn(err.message);
        inlineCache[filepath] = '';
      }
    }
  }

  return inlineCache[filepath];
});


const minifyHtml = (content) => {
  if (process.env.NODE_ENV == 'production') {
    let opts = {
      removeComments: true,
      collapseWhitespace: true,
      collapseBooleanAttributes: true,
      removeAttributeQuotes: true,
      removeRedundantAttributes: true,
      useShortDoctype: true,
      removeEmptyAttributes: true,
      minifyJS: true,
      minifyCSS: true,
    };

    return htmlMinifier.minify(content, opts);
  } else {
    return content;
  }
};

/**
 * Renders markdown content as HTML with syntax highlighted code blocks.
 * @param {string} content A markdown string.
 * @return {string} The rendered HTML.
 */
const renderMarkdown = (content) => {
  const md = new MarkdownIt({
    html: true,
    typographer: true,
    highlight: function(code, lang) {
      code = lang ? hljs.highlight(lang, code).value :
          // Since we're not using highlight.js here, we need to
          // espace the html, but we have to unescape first in order
          // to avoid double escaping.
          he.escape(he.unescape(code));

      // Allow for highlighting portions of code blocks
      // using `**` before and after
      return code.replace(/\*\*(.+)?\*\*/g, '<mark>$1</mark>');
    },
  }).use(markdownItAnchor);

  return md.render(content);
};


const getPageTemplateFromPathname = (pathname) => {
  if (pathname == '/') {
    return 'templates/index.html';
  } else if (pathname.endsWith('/')) {
    return `templates/${pathname.slice(0, -1)}.html`;
  } else {
    return `templates/${pathname}`;
  }
};

const getOutputPathFromPathname = (pathname) => {
  // Add index.html if necessary and remove leading slash.
  return `build${pathname.replace(/\/$/, '/index.html')}`;
};

const buildArticles = async () => {
  for (const article of book.articles) {
    const content =
        await fs.readFile(`${article.path.slice(1, -1)}.md`, 'utf-8');

    article.markup = renderMarkdown(nunjucks.renderString(content));

    const data = {
      site: book.site,
      page: article,
    };

    article.content = nunjucks.render(path.resolve('templates/article.html'), data);

    const json = {
      title: article.title + book.site.titleSuffix,
      path: article.path,
      content: minifyHtml(article.content),
    };

    await fs.outputJson(
        getOutputPathFromPathname(article.path).replace(/\.html/, '.json'),
        json);

    const baseTemplatePath = 'templates/base.html';
    const html = nunjucks.render(path.resolve(baseTemplatePath), data);

    await fs.outputFile(
        getOutputPathFromPathname(article.path),
        minifyHtml(html));
  }
};

const buildPages = async () => {
  for (const page of book.pages) {
    const pageTemplatePath = getPageTemplateFromPathname(page.path);

    const data = {
      site: book.site,
      articles: book.articles,
      page: page,
    };

    page.content = nunjucks.render(path.resolve(pageTemplatePath), data);

    if (pageTemplatePath.endsWith('.html')) {
      const json = {
        title: page.title + book.site.titleSuffix,
        path: page.path,
        content: minifyHtml(page.content),
      };

      await fs.outputJson(
          getOutputPathFromPathname(page.path).replace(/\.html/, '.json'),
          json);

      const baseTemplatePath = 'templates/base.html';
      const html = nunjucks.render(path.resolve(baseTemplatePath), data);
      await fs.outputFile(
          getOutputPathFromPathname(page.path), minifyHtml(html));
    } else {
      await fs.outputFile(
          getOutputPathFromPathname(page.path),
          page.content);
    }
  }
};

const build = async () => {
  await buildArticles();
  await buildPages();
};


module.exports = {build};

module.exports.build();
