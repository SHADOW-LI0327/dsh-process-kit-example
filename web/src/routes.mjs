/**
 * 哈希路由：五个功能面共用同一份首帧文档，路由只决定渲染哪一页。
 *
 * 解析是纯函数（便于单测与排错）：`#/products/P-001` ⇒ `{ name:'product', id:'P-001' }`。
 */

export const PATHS = {
  products: '#/products',
  cart: '#/cart',
  checkout: '#/checkout',
  orders: '#/orders',
  me: '#/me',
  login: '#/login',
  register: '#/register',
};

export function parseRoute(hash) {
  const raw = String(hash ?? '').replace(/^#/, '');
  const path = raw.split('?')[0];
  const parts = path.split('/').filter((part) => part !== '');

  if (parts.length === 0) return { name: 'products' };
  const head = parts[0];
  const id = parts[1];

  switch (head) {
    case 'products':
      return id ? { name: 'product', id: decodeURIComponent(id) } : { name: 'products' };
    case 'cart':
      return { name: 'cart' };
    case 'checkout':
      return { name: 'checkout' };
    case 'orders':
      return id ? { name: 'order', orderNo: decodeURIComponent(id) } : { name: 'orders' };
    case 'me':
      return { name: 'me' };
    case 'login':
      return { name: 'login' };
    case 'register':
      return { name: 'register' };
    default:
      return { name: 'notfound' };
  }
}

/** 当前路由该点亮哪个底部 Tab。 */
export function tabOf(routeName) {
  if (routeName === 'product') return 'products';
  if (routeName === 'order') return 'orders';
  if (routeName === 'checkout') return 'cart';
  if (routeName === 'login' || routeName === 'register') return 'me';
  return routeName;
}

/** 跳转到某个哈希路由；相同路由时直接重渲（不触发 hashchange）。 */
export function go(hash, rerender) {
  if (window.location.hash === hash) {
    if (typeof rerender === 'function') rerender();
    return;
  }
  window.location.hash = hash;
}
