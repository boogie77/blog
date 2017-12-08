const crypto = require('crypto');
const fs = require('fs-extra');
const he = require('he');
const hljs = require('highlight.js');
const htmlMinifier = require('html-minifier');
const yaml = require('js-yaml');
const MarkdownIt = require('markdown-it');
const markdownItAnchor = require('markdown-it-anchor');
const moment = require('moment-timezone');
const nunjucks = require('nunjucks');
const path = require('path');
const {getRevisionedAssetUrl} = require('./static');
const config = require('../config.json');

const {promisify} = require('util');
const hashFiles = promisify(require('hash-files'));


let book;


const hash = (data) => {
  return crypto.createHash('md5').update(data).digest('hex').slice(0, 10);
};


const hashShell = (() => {
  let shellTemplateHash;
  return async () => {
    return shellTemplateHash || (shellTemplateHash = (await hashFiles({
      algorithm: 'md5',
      files: [
        './templates/_*',
        './templates/shell*',
      ],
    })).slice(0, 10));
  };
})();


const getTemplate = (pathname) => {
  let templateFile;

  if (pathname == '/') {
    templateFile = 'index.html';
  } else if (pathname.endsWith('/')) {
    templateFile = `${pathname.slice(0, -1)}.html`;
  } else {
    templateFile = pathname;
  }

  return path.resolve(path.join(config.templatesDir, templateFile));
};


const getOutputFile = (pathname) => {
  if (pathname.endsWith('/')) {
    pathname += 'index.html';
  }

  return path.resolve(path.join(config.publicDir, pathname));
};


const getPartialOutputFile = (outputFile) => {
  const basename = path.basename(outputFile, '.html');
  return path.join(
      path.dirname(outputFile), `${basename}${config.contentPartialsSuffix}`);
};


const getPartialPath = (pathname) => {
  if (pathname.endsWith('/')) {
    pathname += 'index.html';
  }
  const extname = path.extname(pathname);
  const basename = path.basename(pathname, extname);
  const dirname = path.dirname(pathname);

  return path.join(dirname, basename + config.contentPartialsSuffix);
};


const env = nunjucks.configure(config.templatesDir, {
  autoescape: false,
  watch: false,
});

env.addFilter('format', (str, formatString) => {
  return moment.tz(str, book.site.timezone).format(formatString);
});

env.addFilter('revision', (filename) => {
  return getRevisionedAssetUrl(filename);
});

env.addFilter('encode', (content) => {
  return he.encode(content, {useNamedReferences: true});
});

env.addFilter('inline', (() => {
  const inlineCache = {};
  return (filepath) => {
    if (!inlineCache[filepath]) {
      try {
        inlineCache[filepath] = fs.readFileSync(
            path.join(config.publicDir, filepath), 'utf-8');
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
  };
})()
);


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


const renderArticleContentPartials = async () => {
  for (const article of book.articles) {
    const markdown =
        await fs.readFile(`${article.path.slice(1, -1)}.md`, 'utf-8');

    article.markup = renderMarkdown(nunjucks.renderString(markdown));

    const data = {
      site: book.site,
      page: article,
      layout: 'partial.html',
    };

    article.content = nunjucks.render(article.template, data);
    article.partialPath = getPartialPath(article.path);
    article.hash = hash(article.content);
  }
};


const buildArticles = async () => {
  for (const article of book.articles) {
    await fs.outputFile(article.partialOutput, minifyHtml(article.content));

    const data = {
      site: book.site,
      page: article,
      layout: 'shell.html',
    };

    const html = nunjucks.render(article.template, data);
    await fs.outputFile(article.output, minifyHtml(html));
  }
};


const renderPageContentPartials = async () => {
  for (const page of book.pages) {
    if (!page.private) {
      const data = {
        site: book.site,
        articles: book.articles,
        page: page,
        layout: 'partial.html',
      };

      page.content = nunjucks.render(page.template, data);
      page.partialPath = getPartialPath(page.path);
      page.hash = hash(page.content);
    }
  }
};


const buildPages = async () => {
  for (const page of book.pages) {
    // Private pages are those that cannot be found by following a link on the
    // site, and thus no content partial needs to be created for them.
    if (!page.private) {
      await fs.outputFile(page.partialOutput, minifyHtml(page.content));
    }

    const data = {
      site: book.site,
      articles: book.articles,
      page: page,
      layout: 'shell.html',
    };

    const html = nunjucks.render(page.template, data);
    await fs.outputFile(page.output, minifyHtml(html));
  }
};


const buildResources = async () => {
  const data = {
    site: book.site,
    articles: book.articles,
  };
  for (const resource of book.resources) {
    const content = nunjucks.render(resource.template, data);
    await fs.outputFile(resource.output, content);
  }
};


const initBook = async () => {
  book = yaml.safeLoad(await fs.readFile('./book.yaml', 'utf-8'));

  for (const page of book.pages) {
    page.template = getTemplate(page.path);
    page.output = getOutputFile(page.path);
    page.partialOutput = getPartialOutputFile(page.output);
  }

  for (const resource of book.resources) {
    resource.template = getTemplate(resource.path);
    resource.output = getOutputFile(resource.path);
  }

  for (const article of book.articles) {
    article.template = getTemplate('article.html');
    article.output = getOutputFile(article.path);
    article.partialOutput = getPartialOutputFile(article.output);
  }

  book.buildTime = new Date();
};


const render = async () => {
  await initBook();
  await renderArticleContentPartials();
  await renderPageContentPartials();
};


const getCacheData = (() => {
  let cacheData;
  return async () => {
    if (!cacheData) {
      cacheData = {
        layouts: {
          shell: await hashShell(),
        },
        pages: {},
      };

      for (const page of [...book.articles, ...book.pages]) {
        cacheData.pages[page.partialPath] = page.hash;
      }
    }
    return cacheData;
  };
})();


const buildCacheManifest = async () => {
  const cacheData = await getCacheData();

  await fs.outputJson(
      path.join(config.publicDir, 'cache-manifest.json'), cacheData);
}


const build = async () => {
  try {
    await buildArticles();
    await buildPages();
    await buildResources();
    await buildCacheManifest();
  } catch (err) {
    console.error(err);
  }
};


module.exports = {
  render,
  getCacheData,
  build,
};
