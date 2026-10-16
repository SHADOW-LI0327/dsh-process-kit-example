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

/** 主图在 `web/` 内的相对路径：指纹与 `src` 都必须由这一处推导，两处各拼一次必然漂移。 */
function productImagePath(productId) {
  return join('assets', 'products', `${productId}.jpg`);
}

/**
 * 查询串里的 `?v=` 是否**等于该文件的真指纹**。
 * 形态合法但退化的值（`?v=0` / `?v=000000`）不算带指纹：否则一次伪造就能把某个版本
 * 按 `immutable` 钉在客户端一年。资源本身确实存在，所以退化档仍按无指纹档返回 200。
 */
function isTrueFingerprint(search, version) {
  const match = /[?&]v=([^&]*)/.exec(search ?? '');
  return match !== null && match[1] === version;
}

/**
 * 服务端渲染商品卡：首帧就要有图、有名、有价，并与客户端重绘后的结构逐字同构
 * （主图 / 角标 / 商品名 / 元价 / 现货，角标按缺货 > 包邮 > 热卖取值）。
 *
 * 为什么主图外面那层是 `span` 而不是 `div`：卡片行靠 `closest('li, … , div')` 落回卡元素，
 * 套一层 `div` 会让它先落在那层包裹上 —— 行文本里只剩图，丢掉名称与价格。
 * 为什么图仍要排在最前：DOM 顺序判据要求图片先于价格出现。
 */
const FREE_SHIPPING_CENTS = 9900;

export function renderProductCards(products) {
  return products
    .map((product) => {
      const version = versionOf(productImagePath(product.id));
      const suffix = version === '0' ? '' : `?v=${version}`;
      const name = escapeHtml(product.name);
      const out = product.stock === 0;
      const badge = out
        ? { word: '缺货', kind: 'muted', veil: true }
        : product.priceCents >= FREE_SHIPPING_CENTS
          ? { word: '包邮', kind: 'success', veil: false }
          : { word: '热卖', kind: 'accent', veil: false };
      return (
        `<li class="${out ? 'card card--out' : 'card'}" data-product-id="${escapeHtml(product.id)}"` +
        ` data-product-name="${name}">` +
        `<a class="card__link" href="#/products/${escapeHtml(product.id)}">` +
        `<span class="card__wrap">` +
        `<img class="card__img" src="/assets/products/${escapeHtml(product.id)}.jpg${suffix}"` +
        ` alt="${name}" width="300" height="300" loading="lazy" decoding="async">` +
        (badge.veil ? `<span class="card__veil" aria-hidden="true"></span>` : '') +
        `<span class="badge badge--${badge.kind} card__badge">${badge.word}</span>` +
        `</span>` +
        `<h3 class="card__title">${name}</h3>` +
        `<div class="card__foot"><p class="card__price"><span class="card__price-symbol">¥</span>` +
        `<span class="card__price-value">${yuan(product.priceCents)}</span></p>` +
        `<p class="card__stock">现货 ${product.stock} 件</p></div>` +
        `</a></li>`
      );
    })
    .join('');
}

/**
 * 无脚本兜底：脚本被禁用时至少给一份可读清单（不构成第二份业务真源）。
 *
 * 为什么封顶而不是全量：这段是首帧 HTML 的一部分，商品条数一多就把首页撑成一张长清单；
 * 超出的条数用一行「还有 N 件」交代，既不静默截断也不让首帧无界增长。
 */
const NOSCRIPT_LIMIT = 7;

export function renderNoScriptCatalog(products) {
  const shown = products.slice(0, NOSCRIPT_LIMIT);
  const cards = shown
    .map(
      (product) =>
        `<li class="nojs-card" data-product-name="${escapeHtml(product.name)}">` +
        `<span class="nojs-card__name">${escapeHtml(product.name)}</span>` +
        `　<span class="nojs-card__price">¥ ${yuan(product.priceCents)}</span>` +
        `</li>`,
    )
    .join('');
  const hidden = products.length - shown.length;
  const overflow = products[NOSCRIPT_LIMIT];
  const more =
    hidden > 0 && overflow
      ? `<p class="nojs-more">还有 ${hidden} 件商品（${escapeHtml(overflow.name)}）</p>`
      : '';
  return (
    '<p class="nojs-note">当前浏览器未启用 JavaScript，仅能展示商品清单；下单请启用脚本后重试。</p>' +
    `<ul class="nojs-cards">${cards}</ul>` +
    more
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
  // 客户端重绘主图时也要带同一份指纹：没有这张表，脚本接手后主图就退回了协商缓存档。
  const versions = {};
  for (const product of products) {
    const version = versionOf(productImagePath(product.id));
    if (version !== '0') versions[product.id] = version;
  }
  return template
    .replace('{{PRODUCT_COUNT}}', () => String(products.length))
    .replace('{{PRODUCT_CARDS}}', () => renderProductCards(products))
    .replace('{{NOSCRIPT_CATALOG}}', () => renderNoScriptCatalog(products))
    .replace('{{ASSET_VERSIONS}}', () => JSON.stringify(versions))
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
    return negotiate(
      entry,
      headers,
      isTrueFingerprint(search, entry.version) ? IMMUTABLE_CACHE : NEGOTIATED_CACHE,
      type,
    );
  }

  return null;
}
