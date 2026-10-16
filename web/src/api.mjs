/**
 * 接口封装：与 `server/` 的端点一一对应。
 *
 * 成功响应统一是 `{ data }`，错误响应统一是 `{ code, message }` ——
 * 前端不改写服务端文案：提示只认服务端的 `message`，避免两份真源互相漂移。
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
  const init = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(`${API}${path}`, init);
  } catch {
    throw new ApiError(0, 'NETWORK', '网络不可用，请稍后重试');
  }

  const text = await res.text();
  let payload = null;
  if (text !== '') {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!res.ok) {
    const code = payload && typeof payload.code === 'string' ? payload.code : 'INTERNAL_ERROR';
    const message = payload && typeof payload.message === 'string' ? payload.message : '请求失败，请稍后重试';
    throw new ApiError(res.status, code, message);
  }
  return payload && 'data' in payload ? payload.data : null;
}

export const api = {
  products: (query = '') => request('GET', `/products${query}`),
  product: (id) => request('GET', `/products/${encodeURIComponent(id)}`),
  cart: () => request('GET', '/cart'),
  addItem: (productId, quantity) => request('POST', '/cart/items', { productId, quantity }),
  setItem: (productId, quantity) => request('PATCH', `/cart/items/${encodeURIComponent(productId)}`, { quantity }),
  removeItem: (productId) => request('DELETE', `/cart/items/${encodeURIComponent(productId)}`),
  submitOrder: () => request('POST', '/orders'),
  orders: (query = '') => request('GET', `/orders${query}`),
  order: (orderNo) => request('GET', `/orders/${encodeURIComponent(orderNo)}`),
  me: () => request('GET', '/auth/me'),
  register: (email, password) => request('POST', '/auth/register', { email, password }),
  login: (email, password) => request('POST', '/auth/login', { email, password }),
  logout: () => request('POST', '/auth/logout'),
};

/** 统一的错误文案出口：服务端 `message` 原样用，网络类错误才用兜底串。 */
export function errorMessage(error) {
  if (error instanceof ApiError) return error.message;
  return '操作未完成，请稍后重试';
}
