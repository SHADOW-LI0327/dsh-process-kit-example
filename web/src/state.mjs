/**
 * 应用状态：单份内存副本，全部来自 `/api/v1` 的响应，不在前端二次计算金额或件数。
 *
 * 页面只读 `getState()`；写入口只有 `setState()`（并广播给订阅者），
 * 这样「件数徽标 = 服务端 quantityTotal」这类断言只有一个落点。
 */
import { api, errorMessage } from './api.mjs';

/** 单件商品可买上限（与服务端一致；达到上限时「＋」必须禁用）。 */
export const MAX_QUANTITY = 8;

const state = {
  products: [],
  cart: null,
  user: null,
  orders: [],
  error: null,
  notice: null,
};

const listeners = new Set();

export function getState() {
  return state;
}

export function setState(patch) {
  Object.assign(state, patch);
  for (const listener of listeners) listener(state);
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function productById(id) {
  return state.products.find((item) => item.id === id) ?? null;
}

/** 购物车件数徽标：一律取服务端 `quantityTotal`，前端不累加行内数字。 */
export function cartQuantity() {
  return state.cart ? state.cart.quantityTotal : 0;
}

export function syncCartBadge() {
  const badge = document.getElementById('tab-cart-count');
  if (!badge) return;
  const total = cartQuantity();
  badge.textContent = String(total);
  badge.hidden = total === 0;
}

/**
 * 每个读取面各有一条「代」计数：只有**最新一次**请求的响应才允许写入状态。
 *
 * 为什么必须有：同一份状态会被快速切换的路由反复读取，慢的旧响应若后到就会把新结果盖掉
 * （典型表现：刚切到自己的车，界面却显示上一个会话的空车）。判据也要求「服务端返回的值说了算」，
 * 那就先保证写进状态的那份确实是最后发出的那次请求的结果。
 */
const generation = { products: 0, cart: 0, session: 0, orders: 0 };

export async function loadProducts() {
  const mine = (generation.products += 1);
  try {
    const data = await api.products();
    if (mine !== generation.products) return;
    setState({ products: Array.isArray(data) ? data : [], error: null });
  } catch (error) {
    if (mine !== generation.products) return;
    setState({ error: errorMessage(error) });
  }
}

export async function loadCart() {
  const mine = (generation.cart += 1);
  let cart = null;
  try {
    cart = await api.cart();
    if (mine !== generation.cart) return cart;
    setState({ cart });
  } catch (error) {
    if (mine !== generation.cart) return null;
    setState({ error: errorMessage(error) });
  }
  syncCartBadge();
  return cart;
}

export async function loadSession() {
  const mine = (generation.session += 1);
  try {
    const data = await api.me();
    if (mine !== generation.session) return;
    setState({ user: data && data.user ? data.user : null });
  } catch {
    if (mine !== generation.session) return;
    setState({ user: null });
  }
}

/** 订单只在登录后可读；未登录按空表处理（服务端会返 401，属预期）。 */
export async function loadOrders() {
  const mine = (generation.orders += 1);
  if (state.user === null) {
    setState({ orders: [] });
    return;
  }
  try {
    const data = await api.orders('?limit=100');
    if (mine !== generation.orders) return;
    setState({ orders: Array.isArray(data) ? data : [], error: null });
  } catch (error) {
    if (mine !== generation.orders) return;
    setState({ orders: [], error: errorMessage(error) });
  }
}
