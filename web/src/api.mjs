/**
 * 接口封装：与 `server/` 的 8 个端点一一对应。
 *
 * 成功响应统一是 `{ data }`，错误响应统一是 `{ code, message }` ——
 * 前端不做本地改写，直接把服务端的 `message` 展示给用户（提示文案只有一个真源）。
 */

const API = '/api/v1';

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function request(method, path, body) {
  const init = { method, credentials: 'same-origin', headers: {} };
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', '网络异常，请稍后重试');
  }
  const raw = await response.text();
  let payload;
  try {
    payload = raw === '' ? undefined : JSON.parse(raw);
  } catch {
    payload = undefined;
  }
  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.code ?? 'UNKNOWN_ERROR',
      payload?.message ?? '请求失败，请稍后重试',
    );
  }
  return payload?.data;
}

export const api = {
  listProducts: () => request('GET', `${API}/products`),
  getProduct: (id) => request('GET', `${API}/products/${encodeURIComponent(id)}`),
  getCart: () => request('GET', `${API}/cart`),
  addCartItem: (productId, quantity) =>
    request('POST', `${API}/cart/items`, { productId, quantity }),
  updateCartItem: (productId, quantity) =>
    request('PATCH', `${API}/cart/items/${encodeURIComponent(productId)}`, { quantity }),
  deleteCartItem: (productId) =>
    request('DELETE', `${API}/cart/items/${encodeURIComponent(productId)}`),
  createOrder: () => request('POST', `${API}/orders`),
  listOrders: () => request('GET', `${API}/orders`),
};
