/**
 * 前端入口：哈希路由 + 顶栏搜索（本地筛选）+ 底部 Tab。
 *
 * 五个功能面共用同一份首帧文档；脚本接手后按路由重绘内容区，
 * 所有数据来自 `/api/v1`，页面不持有任何本地业务副本。
 */
import { api } from './api.mjs';
import { el, emptyState, pageHead } from './components.mjs';
import { renderAuth } from './pages/auth.mjs';
import { renderCart } from './pages/cart.mjs';
import { renderCheckout } from './pages/checkout.mjs';
import { renderMe } from './pages/me.mjs';
import { renderOrderDetail } from './pages/order-detail.mjs';
import { renderOrders } from './pages/order-list.mjs';
import { renderProductDetail } from './pages/product-detail.mjs';
import { renderProductList } from './pages/product-list.mjs';
import { PATHS, parseRoute, tabOf } from './routes.mjs';
import {
  getState,
  loadCart,
  loadOrders,
  loadProducts,
  loadSession,
  setState,
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
  // 「请先登录后再下单」只属于被结算页拦下来的那一次：换到别的路由就不再挂着。
  if (route.name !== 'login' && getState().loginReason) setState({ loginReason: null });

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
    // 判定用**本次请求的返回**而不是状态里的那份：并发下状态可能刚被别的响应改过。
    const cart = await loadCart();
    await loadSession();
    if (!cart || !Array.isArray(cart.items) || cart.items.length === 0) {
      // 空车没有可结算的东西：直接回购物车，连结算内容都不渲染（否则会闪一下不可用的主按钮）。
      window.location.hash = PATHS.cart;
      renderCart(view);
      return;
    }
    renderCheckout(view);
    return;
  }
  if (route.name === 'orders') {
    await loadSession();
    await loadOrders();
    renderOrders(view);
    return;
  }
  if (route.name === 'order') {
    // 先给「加载中…」再取数据（连会话都不等）：这一页是可直达的深链，
    // 数据没回来时应当明确「正在读」，而不是一屏空白或停在上一页。
    renderOrderDetail(view, { loading: true });
    await loadSession();
    let order = null;
    try {
      order = await api.order(route.orderNo);
    } catch {
      // 不存在、不属于本账号、未登录：三种情况同一张空态，不给任何存在性线索。
      order = null;
    }
    if (parseRoute(window.location.hash).name !== 'order') return;
    renderOrderDetail(view, { order });
    return;
  }
  if (route.name === 'me') {
    await loadSession();
    await loadOrders();
    await loadCart();
    renderMe(view);
    return;
  }
  if (route.name === 'login' || route.name === 'register') {
    await loadSession();
    renderAuth(view, { mode: route.name });
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
