/**
 * 内存态存储与视图投影。
 *
 * 每次 createApp 都会得到**独立**的 store（购物车按 cartId 分桶、订单按 cartId 分桶），
 * 因此两个实例之间不共享任何可变状态 —— 「重建实例即回到种子初值」由此成立。
 * 订单号序号也放在 store 里，保证同一实例内单调递增、不重号。
 */

/** 建一份全新的内存态存储；可选注入 store 供调用方共享/隔离自证。 */
export function createStore(products, injected) {
  if (injected && typeof injected === 'object') {
    if (!Array.isArray(injected.products)) injected.products = products;
    if (!(injected.carts instanceof Map)) injected.carts = new Map();
    if (!(injected.orders instanceof Map)) injected.orders = new Map();
    if (!Number.isInteger(injected.orderSeq)) injected.orderSeq = 0;
    return injected;
  }
  return { products, carts: new Map(), orders: new Map(), orderSeq: 0 };
}

export function findProduct(store, productId) {
  return store.products.find((product) => product.id === productId);
}

export function createCart(store, cartId) {
  const cart = { cartId, items: [] };
  store.carts.set(cartId, cart);
  return cart;
}

export function getCart(store, cartId) {
  return cartId === undefined ? undefined : store.carts.get(cartId);
}

/** 购物车行的对外投影：金额一律整数分，行小计由单价 × 件数现算，不做浮点换算。 */
export function rowView(row) {
  return {
    productId: row.productId,
    productName: row.productName,
    unitPriceCents: row.unitPriceCents,
    quantity: row.quantity,
    lineTotalCents: row.unitPriceCents * row.quantity,
  };
}

/** 整车投影：合计字段一律由行推导，避免两处口径各算各的。 */
export function cartView(cart) {
  const items = cart.items.map(rowView);
  return {
    cartId: cart.cartId,
    items,
    quantityTotal: items.reduce((sum, item) => sum + item.quantity, 0),
    totalCents: items.reduce((sum, item) => sum + item.lineTotalCents, 0),
  };
}

export function ordersOf(store, cartId) {
  if (cartId === undefined) return [];
  return store.orders.get(cartId) ?? [];
}

/** 订单号：日期段 + 实例内单调序号，同毫秒连续下单也不会重号。 */
export function nextOrderNo(store) {
  store.orderSeq += 1;
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('');
  return `SO-${stamp}-${String(store.orderSeq).padStart(4, '0')}`;
}
