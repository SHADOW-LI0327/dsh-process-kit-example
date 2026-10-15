/**
 * 前端入口：哈希路由 + 页头/徽标外壳。
 *
 * 五页共用一个外壳（侧栏 + 页头 + 内容区），路由只换内容区与页头文字；
 * 数据全部来自 `/api/v1`，页面不持有任何本地业务副本。
 */
import { api } from './api.mjs';
import { banner } from './components.mjs';
import * as cartPage from './pages/cart.mjs';
import * as checkoutPage from './pages/checkout.mjs';
import * as orderListPage from './pages/order-list.mjs';
import * as productDetailPage from './pages/product-detail.mjs';
import * as productListPage from './pages/product-list.mjs';

const content = document.getElementById('content');
const titleNode = document.getElementById('page-title');
const subtitleNode = document.getElementById('page-subtitle');
const badgeNode = document.getElementById('cart-badge');
const actionNode = document.getElementById('header-action');
const navItems = [...document.querySelectorAll('[data-nav]')];

const DEFAULT_HASH = '#/products';
let pendingFlash = null;

const ui = {
  setHeader({ title, subtitle, action }) {
    if (title) {
      titleNode.textContent = title;
      document.title = `${title} · 电商小铺`;
    }
    if (subtitle) subtitleNode.textContent = subtitle;
    if (action) {
      actionNode.textContent = action.label;
      actionNode.setAttribute('href', action.href);
    }
  },
  setSubtitle(text) {
    subtitleNode.textContent = text;
  },
  setActiveNav(key) {
    for (const item of navItems) {
      item.classList.toggle('is-active', item.getAttribute('data-nav') === key);
    }
  },
  setCart(cart) {
    badgeNode.textContent = `购物车 · ${cart.quantityTotal} 件`;
  },
  async refreshBadge() {
    try {
      ui.setCart(await api.getCart());
    } catch {
      // 徽标是辅助信息：取不到就保持原值，不打断当前页面。
    }
  },
  flash(message) {
    pendingFlash = message;
  },
  consumeFlash() {
    const message = pendingFlash;
    pendingFlash = null;
    return message;
  },
  navigate(hash) {
    if (window.location.hash === hash) {
      void route();
      return;
    }
    window.location.hash = hash;
  },
};

const ctx = { root: content, ui };

const ROUTES = [
  {
    pattern: /^#\/products\/(.+)$/,
    page: productDetailPage,
    params: (match) => ({ id: decodeURIComponent(match[1]) }),
  },
  { pattern: /^#\/products\/?$/, page: productListPage },
  { pattern: /^#\/cart\/?$/, page: cartPage },
  { pattern: /^#\/checkout\/?$/, page: checkoutPage },
  { pattern: /^#\/orders\/?$/, page: orderListPage },
];

function resolveRoute() {
  const hash = window.location.hash || DEFAULT_HASH;
  for (const route of ROUTES) {
    const match = route.pattern.exec(hash);
    if (match) return { page: route.page, params: route.params ? route.params(match) : {} };
  }
  return { page: null, params: {} };
}

async function route() {
  const { page, params } = resolveRoute();
  if (!page) {
    window.location.hash = DEFAULT_HASH;
    return;
  }
  try {
    await page.render(ctx, params);
  } catch (error) {
    content.innerHTML = banner(error?.message ?? '页面渲染失败，请刷新重试', { retry: true });
    content
      .querySelector('[data-action="retry"]')
      ?.addEventListener('click', () => void route());
  }
}

window.addEventListener('hashchange', () => void route());
void route();
void ui.refreshBadge();
