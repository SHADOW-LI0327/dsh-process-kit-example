/**
 * 前端入口：哈希路由 + 顶栏搜索（本地筛选）+ 底部 Tab。
 *
 * 五个功能面共用同一份首帧文档；脚本接手后按路由重绘内容区，
 * 所有数据来自 `/api/v1`，页面不持有任何本地业务副本。
 */
import { el, emptyState, pageHead } from './components.mjs';
import { renderAuth } from './pages/auth.mjs';
import { renderCart } from './pages/cart.mjs';
import { renderCheckout } from './pages/checkout.mjs';
import { renderMe } from './pages/me.mjs';
import { renderOrders } from './pages/order-list.mjs';
import { renderProductDetail } from './pages/product-detail.mjs';
import { renderProductList } from './pages/product-list.mjs';
import { parseRoute, tabOf } from './routes.mjs';
import {
  loadCart,
  loadOrders,
  loadProducts,
  loadSession,
  subscribe,
  syncCartBadge,
} from './state.mjs';

const view = document.getElementById('view');
const searchInput = document.getElementById('search-input');

/** 搜索关键词只做本地筛选，不进 URL、不发请求。 */
let keyword = '';

function markTab(routeName) {
  const active = tabOf(routeName);
  for (const item of document.querySelectorAll('.tabbar__item')) {
    item.classList.toggle('is-active', item.dataset.tab === active);
  }
}

function renderNotFound(root) {
  root.replaceChildren(
    pageHead('页面不存在', '地址可能写错了'),
    el('section', { class: 'panel' }, [
      emptyState('没有这个页面', '回商品列表继续逛。'),
      el('div', { class: 'actions' }, [el('a', { class: 'btn btn--cta', href: '#/products' }, ['回商品列表'])]),
    ]),
  );
}

async function render() {
  if (!view) return;
  const route = parseRoute(window.location.hash);
  markTab(route.name);

  if (route.name === 'products') {
    renderProductList(view, { keyword });
    return;
  }
  if (route.name === 'product') {
    renderProductDetail(view, { id: route.id });
    return;
  }
  if (route.name === 'cart') {
    await loadCart();
    renderCart(view);
    return;
  }
  if (route.name === 'checkout') {
    await loadCart();
    await loadSession();
    renderCheckout(view);
    return;
  }
  if (route.name === 'orders') {
    await loadSession();
    await loadOrders();
    renderOrders(view);
    return;
  }
  if (route.name === 'me') {
    await loadSession();
    await loadOrders();
    await loadCart();
    renderMe(view);
    return;
  }
  if (route.name === 'login') {
    await loadSession();
    renderAuth(view);
    return;
  }
  renderNotFound(view);
}

function bindSearch() {
  if (!searchInput) return;
  searchInput.addEventListener('input', () => {
    keyword = searchInput.value;
    if (parseRoute(window.location.hash).name === 'products') renderProductList(view, { keyword });
  });
}

async function boot() {
  bindSearch();
  subscribe(() => syncCartBadge());
  window.addEventListener('hashchange', () => {
    render();
  });
  await loadProducts();
  await loadCart();
  await loadSession();
  await render();
  syncCartBadge();
}

boot();
