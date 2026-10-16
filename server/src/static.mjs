/**
 * 同端口静态托管：把 `web/` 原样提供给浏览器（原生 ESM，无构建产物）。
 *
 * 三条口径：
 *  ① **白名单**：只服务 `/`、`/index.html`、`/src/**`、`/assets/**`、`/favicon.ico`；
 *     其余一律纯文本 404（不得 5xx、不得套用接口层的业务文案）。
 *  ② **路径必须经 `resolveWithinWeb`**：它做 `normalize` + 前缀校验 + 安全解码，
 *     是「不把 web/ 之外的文件吐出去」的唯一入口，不允许别处另写一套校验。
 *  ③ **缓存按内容指纹分档**：带 `?v=<指纹>` 的是「内容变了 URL 就变」，可以长缓存 +
 *     `immutable`；不带的只能协商缓存（`no-cache` + `ETag`），否则改版后浏览器不刷新。
 */
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB_ROOT = fileURLToPath(new URL('../../web/', import.meta.url));
const INDEX_PATH = join(WEB_ROOT, 'index.html');
const FAVICON_PATH = join(WEB_ROOT, 'assets', 'favicon.svg');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  // 主图是**二进制照片**：字节必须原样进出，绝不能经 utf8 编解码（会静默换成 U+FFFD ⇒ 裂图）。
  '.jpg': 'image/jpeg',
};

/** 带指纹：URL 与内容绑定，可以放心长缓存。不带指纹：只能协商缓存。 */
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
const NEGOTIATED_CACHE = 'no-cache';
const FAVICON_CACHE = 'public, max-age=86400';

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });

const yuan = (cents) => (cents / 100).toFixed(2);

/** 读文件 + 内容指纹，带 mtime 缓存：静态请求不该每次都重算哈希。 */
const fileCache = new Map();
function loadFile(path) {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return null;
  }
  const cached = fileCache.get(path);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached;
  let bytes;
  try {
    // 一律按 **Buffer** 读：同一份代码要同时服务文本与照片（jpg）。
    // 文本解码只在真正需要字符串的调用点做（见 renderIndex），二进制路径不碰任何编码。
    bytes = readFileSync(path);
  } catch {
    // 路径在 web/ 之内但不可读是常规 404，不是异常：让它冒出去会用一次探测打死进程。
    return null;
  }
  const entry = {
    bytes,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    version: createHash('sha256').update(bytes).digest('hex').slice(0, 10),
  };
  entry.etag = `"${entry.version}-${bytes.length}"`;
  fileCache.set(path, entry);
  return entry;
}

/** 给 `web/` 内某个相对路径算内容指纹（注入查询串用）。 */
function versionOf(relative) {
  const entry = loadFile(join(WEB_ROOT, relative));
  return entry ? entry.version : '0';
}

/**
 * 服务端渲染商品卡：首帧就要有图、有名、有价。
 *
 * 为什么图必须是 `<a>` 的直接子元素：卡片行是「图 + 名 + 价」的**同一行**，
 * 中间再套一层容器，行文本就只剩图、与判据「行内同时含名称与价格」不符。
 */
export function renderProductCards(products) {
  return products
    .map((product) => {
      const version = versionOf(join('assets', 'products', `${product.id}.jpg`));
      const name = escapeHtml(product.name);
      return (
        `<li class="card" data-product-id="${escapeHtml(product.id)}" data-product-name="${name}">` +
        `<a class="card__link" href="#/products/${escapeHtml(product.id)}">` +
        `<img class="card__img" src="/assets/products/${escapeHtml(product.id)}.jpg?v=${version}"` +
        ` alt="${name}" width="300" height="300" loading="lazy" decoding="async">` +
        `<h3 class="card__title">${name}</h3>` +
        `<p class="card__price"><span class="card__price-symbol">¥</span>` +
        `<span class="card__price-value">${yuan(product.priceCents)}</span></p>` +
        `</a></li>`
      );
    })
    .join('');
}

/** 无脚本兜底：脚本被禁用时至少给一份可读清单（不构成第二份业务真源）。 */
export function renderNoScriptCatalog(products) {
  const cards = products
    .map(
      (product) =>
        `<li class="nojs-card" data-product-name="${escapeHtml(product.name)}">` +
        `<span class="nojs-card__name">${escapeHtml(product.name)}</span>` +
        `<span class="nojs-card__price">¥ ${yuan(product.priceCents)}</span>` +
        `</li>`,
    )
    .join('');
  return (
    '<p class="nojs-note">当前浏览器未启用 JavaScript，仅能展示商品清单；下单请启用脚本后重试。</p>' +
    `<ul class="nojs-cards">${cards}</ul>`
  );
}

/**
 * 首页 HTML：模板占位符在服务端就地填掉。
 *
 * 为什么条数与卡片都在服务端填：首帧在脚本接手前就已可见，留占位符会让用户看到裸标记；
 * 而这两样服务端本来就知道。用替换函数而不是替换串，`$&` 一类模式才不会被当反向引用。
 * 末尾统一清掉未替换的占位符：宁可少一块内容，也不能把 `{{...}}` 泄给用户。
 */
export function renderIndex(template, products) {
  return template
    .replace('{{PRODUCT_COUNT}}', () => String(products.length))
    .replace('{{PRODUCT_CARDS}}', () => renderProductCards(products))
    .replace('{{NOSCRIPT_CATALOG}}', () => renderNoScriptCatalog(products))
    .replace('{{V_STYLES}}', () => versionOf('src/styles.css'))
    .replace('{{V_MAIN}}', () => versionOf('src/main.mjs'))
    .replace(/\{\{[A-Z_]+\}\}/g, '');
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** 把仓库内的真实路径限制在 web/ 之内，挡掉 ../ 穿越。 */
function resolveWithinWeb(pathname) {
  const decoded = safeDecode(pathname);
  if (decoded === null) return null;
  const relative = normalize(decoded).replace(/^([/\\])+/, '');
  if (relative === '' || relative.startsWith('..') || relative.includes(`..${sep}`)) return null;
  const target = join(WEB_ROOT, relative);
  if (!target.startsWith(WEB_ROOT.endsWith(sep) ? WEB_ROOT : WEB_ROOT + sep)) return null;
  return target;
}

function negotiate(entry, headers, cacheControl, contentType) {
  const responseHeaders = { 'content-type': contentType, 'cache-control': cacheControl, etag: entry.etag };
  const ifNoneMatch = headers?.['if-none-match'];
  if (typeof ifNoneMatch === 'string' && ifNoneMatch.split(',').map((v) => v.trim()).includes(entry.etag)) {
    return { status: 304, headers: responseHeaders, body: '' };
  }
  return { status: 200, headers: responseHeaders, body: entry.bytes };
}

/**
 * 处理一个静态请求。返回响应中间表示；路径不可服务时返回 null，
 * 由调用方决定 404 形态（**不得** 5xx）。
 */
export function serveStatic(pathname, { products = [], search = '', headers = {} } = {}) {
  if (pathname === '/' || pathname === '/index.html') {
    const template = loadFile(INDEX_PATH);
    if (template === null) return null;
    const html = renderIndex(template.bytes.toString('utf8'), products);
    const entry = {
      bytes: Buffer.from(html, 'utf8'),
      etag: `"${createHash('sha256').update(html).digest('hex').slice(0, 10)}-${Buffer.byteLength(html, 'utf8')}"`,
    };
    return negotiate(entry, headers, NEGOTIATED_CACHE, CONTENT_TYPES['.html']);
  }

  if (pathname === '/favicon.ico') {
    const icon = loadFile(FAVICON_PATH);
    if (icon === null) return null;
    return negotiate(icon, headers, FAVICON_CACHE, CONTENT_TYPES['.svg']);
  }

  if (pathname.startsWith('/src/') || pathname.startsWith('/assets/')) {
    const target = resolveWithinWeb(pathname);
    if (!target) return null;
    const type = CONTENT_TYPES[extname(target).toLowerCase()];
    if (!type) return null;
    const entry = loadFile(target);
    if (entry === null) return null;
    const fingerprinted = /[?&]v=[^&]/.test(search);
    return negotiate(entry, headers, fingerprinted ? IMMUTABLE_CACHE : NEGOTIATED_CACHE, type);
  }

  return null;
}
