/**
 * 同端口静态托管：把 `web/` 原样提供给浏览器（原生 ESM，无构建产物）。
 *
 * 另外做一件小事：把「无脚本兜底」的商品清单渲染进 `<noscript>`。
 * 前端是 ESM 驱动的，脚本被禁用时若什么都不给，页面就是一片空白；
 * 兜底清单用的是同一份种子数据，不构成第二份业务真源。
 */
import { readFileSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB_ROOT = fileURLToPath(new URL('../../web/', import.meta.url));
const INDEX_PATH = join(WEB_ROOT, 'index.html');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

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

/** 无脚本兜底：每条商品一个可定位锚点，供结构断言与真实降级使用。 */
export function renderNoScriptCatalog(products) {
  const cards = products
    .map(
      (product) =>
        `<li class="nojs-card" data-product-name="${escapeHtml(product.name)}">` +
        `<span class="nojs-card__name">${escapeHtml(product.name)}</span>` +
        `<span class="nojs-card__price">¥ ${(product.priceCents / 100).toFixed(2)}</span>` +
        `</li>`,
    )
    .join('');
  return (
    '<p class="nojs-note">当前浏览器未启用 JavaScript，页面只能展示商品清单。</p>' +
    `<ul class="nojs-cards">${cards}</ul>`
  );
}

/**
 * 首页 HTML：模板里的占位符在服务端就地填掉。
 *
 * 为什么条数也在服务端填：副标题在脚本接手前就已经可见，留占位符会让首帧
 * 闪出一串裸模板标记；而这个条数服务端本来就知道（就是当前实例的商品数），
 * 不需要等前端把目录拉回来。用替换函数而不是替换串，`$&` 一类模式才不会被当反向引用。
 */
export function renderIndex(template, products) {
  return template
    .replace('{{PRODUCT_COUNT}}', () => String(products.length))
    .replace('{{NOSCRIPT_CATALOG}}', () => renderNoScriptCatalog(products));
}

function readTextFile(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    // 路径在 web/ 之内但文件不存在（或不可读）是常规的 404，不是异常：
    // 让它冒出去会让「随便探一个不存在的资源」直接打死进程。
    return null;
  }
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

/**
 * 处理一个静态请求。返回响应中间表示；路径不可服务时返回 null，
 * 由调用方决定 404 形态（不得 5xx）。
 */
export function serveStatic(pathname, { products = [] } = {}) {
  if (pathname === '/' || pathname === '/index.html') {
    const template = readTextFile(INDEX_PATH);
    if (template === null) return null;
    const html = renderIndex(template, products);
    return { status: 200, headers: { 'content-type': CONTENT_TYPES['.html'] }, body: html };
  }
  if (pathname.startsWith('/src/')) {
    const target = resolveWithinWeb(pathname);
    if (!target) return null;
    const type = CONTENT_TYPES[extname(target).toLowerCase()];
    if (!type) return null;
    const body = readTextFile(target);
    if (body === null) return null;
    return { status: 200, headers: { 'content-type': type }, body };
  }
  return null;
}
