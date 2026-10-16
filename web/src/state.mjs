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

export async function loadProducts() {
  try {
    const data = await api.products();
    setState({ products: Array.isArray(data) ? data : [], error: null });
  } catch (error) {
    setState({ error: errorMessage(error) });
  }
}

export async function loadCart() {
  try {
    setState({ cart: await api.cart() });
  } catch (error) {
    setState({ error: errorMessage(error) });
  }
  syncCartBadge();
}

export async function loadSession() {
  try {
    const data = await api.me();
    setState({ user: data && data.user ? data.user : null });
  } catch {
    setState({ user: null });
  }
}

/** 订单只在登录后可读；未登录按空表处理（服务端会返 401，属预期）。 */
export async function loadOrders() {
  if (state.user === null) {
    setState({ orders: [] });
    return;
  }
  try {
    const data = await api.orders('?limit=100');
    setState({ orders: Array.isArray(data) ? data : [], error: null });
  } catch (error) {
    setState({ orders: [], error: errorMessage(error) });
  }
}
