/**
 * 视图构件：商品卡 / 行件数控件 / 提示条 / 空态，五页共用。
 *
 * 构件只吃服务端数据：件数控件的变化一律由调用方发请求、用响应重绘，
 * 前端不自己加减，避免「前端算错也算过」的假绿。
 */
import { MAX_QUANTITY } from './state.mjs';
import { money, shortTime, yuanParts } from './format.mjs';

/**
 * 主图地址（含内容指纹）：首帧由服务端把「商品 id → 该 jpg 字节的 sha256 前 10 位」
 * 写进 `#asset-versions` 这张 JSON 表，脚本接手后沿用同一份值。
 * 为什么不在前端另算：照片是二进制，前端算不出也不该算；缺表时退化为不带指纹。
 */
let assetVersions = null;

function assetVersion(productId) {
  if (assetVersions === null) {
    assetVersions = {};
    try {
      const slot = document.getElementById('asset-versions');
      const parsed = slot ? JSON.parse(slot.textContent || '{}') : {};
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) assetVersions = parsed;
    } catch {
      assetVersions = {};
    }
  }
  const version = assetVersions[productId];
  return typeof version === 'string' && version !== '' ? version : null;
}

export function productImageSrc(productId) {
  const base = `/assets/products/${productId}.jpg`;
  const version = assetVersion(productId);
  return version === null ? base : `${base}?v=${version}`;
}

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(key, String(value));
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** 价格：符号与数字分开成两个节点（符号更小）。 */
export function priceNode(cents, prefix = 'card__price') {
  const { symbol, amount } = yuanParts(cents);
  return el('p', { class: prefix }, [
    el('span', { class: `${prefix}-symbol` }, [symbol]),
    el('span', { class: `${prefix}-value` }, [amount]),
  ]);
}

/** 包邮门槛：与促销条「满 99 元包邮」同一门槛 ⇒ 角标说「包邮」时「这一件单独买就包邮」为真。 */
const FREE_SHIPPING_CENTS = 9900;

/**
 * 卡角标：每卡**恰好 1 个**，按固定优先级取值 —— 缺货 > 包邮 > 热卖。
 * 「秒杀」不在词表里：本店没有秒杀事件数据，逐卡打「秒杀」是不实声称。
 */
export function badgeFor(product) {
  if (product.stock === 0) return { word: '缺货', kind: 'muted', veil: true };
  if (product.priceCents >= FREE_SHIPPING_CENTS) return { word: '包邮', kind: 'success', veil: false };
  return { word: '热卖', kind: 'accent', veil: false };
}

/**
 * 商品卡：主图 / 角标 / 商品名 / 元价 / 现货 五要素按此顺序（图 → 角标 → 标题 → 价 → 现货）。
 *
 * 主图外面那层必须是 `span`：图片行要靠 `closest('li, … , div')` 落回**卡元素**上
 * （换成 `div` 会先落在这层包裹上，行文本里就只剩图，丢掉了名称与价格）。
 */
export function productCard(product) {
  const badge = badgeFor(product);
  const image = el('img', {
    class: 'card__img',
    src: productImageSrc(product.id),
    alt: product.name,
    width: 300,
    height: 300,
    loading: 'lazy',
    decoding: 'async',
  });
  const wrap = el('span', { class: 'card__wrap' }, [
    image,
    // 缺货时主图盖一层 60% 遮罩（角标随之压在遮罩上）。
    badge.veil ? el('span', { class: 'card__veil', 'aria-hidden': 'true' }) : null,
    el('span', { class: `badge badge--${badge.kind} card__badge` }, [badge.word]),
  ]);
  const link = el('a', { class: 'card__link', href: `#/products/${product.id}` }, [
    wrap,
    el('h3', { class: 'card__title' }, [product.name]),
    el('div', { class: 'card__foot' }, [
      priceNode(product.priceCents),
      el('p', { class: 'card__stock' }, [`现货 ${product.stock} 件`]),
    ]),
  ]);
  return el(
    'li',
    {
      class: product.stock === 0 ? 'card card--out' : 'card',
      dataset: { productId: product.id, productName: product.name },
    },
    [link],
  );
}

export function productGrid(products) {
  return el(
    'ul',
    { class: 'grid', id: 'product-grid' },
    products.map((product) => productCard(product)),
  );
}

/** 行件数控件：`+` 与上限绑定（达到上限即禁用），`−` 到 1 即禁用。 */
export function stepper({ quantity, max = MAX_QUANTITY, onChange }) {
  const minus = el('button', { class: 'stepper__btn', type: 'button', 'aria-label': '减少一件' }, ['−']);
  const plus = el('button', { class: 'stepper__btn', type: 'button', 'aria-label': '增加一件' }, ['+']);
  const value = el('span', { class: 'stepper__value', 'data-quantity': quantity }, [String(quantity)]);
  // 上限 = 调用方给的 `max`（详情页按现货）与全局 `MAX_QUANTITY`（8）取较小者：两处都不能越界。
  const cap = Math.min(max, MAX_QUANTITY);
  plus.disabled = quantity >= cap;
  minus.disabled = quantity <= 1;
  minus.addEventListener('click', () => onChange(quantity - 1));
  plus.addEventListener('click', () => onChange(quantity + 1));
  return el('div', { class: 'stepper' }, [minus, value, plus]);
}

export function banner(message, kind = 'error') {
  return el('p', { class: `banner banner--${kind}`, role: kind === 'error' ? 'alert' : 'status' }, [message]);
}

export function emptyState(title, hint) {
  return el('div', { class: 'empty' }, [
    el('p', { class: 'empty__title' }, [title]),
    hint ? el('p', { class: 'empty__hint' }, [hint]) : null,
  ]);
}

export function pageHead(title, subtitle) {
  return el('div', { class: 'page__head' }, [
    el('h1', { class: 'page__title' }, [title]),
    subtitle ? el('p', { class: 'page__subtitle' }, [subtitle]) : null,
  ]);
}

export function hero() {
  return el('section', { class: 'hero' }, [
    el('p', { class: 'promo' }, ['满 99 元包邮']),
    el('h1', { class: 'hero__title' }, ['手冲器材 · 今日现货']),
    el('p', { class: 'hero__note' }, ['演示站点：下单即视为已支付（假支付），不产生任何真实扣款。']),
  ]);
}

export function summary(label, cents) {
  return el('div', { class: 'summary' }, [
    el('span', { class: 'summary__label' }, [label]),
    el('span', { class: 'summary__value' }, [money(cents)]),
  ]);
}

/**
 * 订单卡：状态胶囊 / 订单号 / 商品行 / 合计 / 下单时间，整卡可点进详情。
 * 订单页与「我的」页共用同一份结构：两处各画一遍必然在改文案时漏掉一处。
 */
export function orderCard(order) {
  return el('article', { class: 'order', dataset: { orderNo: order.orderNo } }, [
    el('a', { class: 'order__link', href: `#/orders/${order.orderNo}` }, [
      el('div', { class: 'order__head' }, [
        el('span', { class: 'badge badge--success' }, ['已支付']),
        el('span', { class: 'order__no' }, [`订单号 ${order.orderNo}`]),
      ]),
      el('p', { class: 'order__items' }, [
        order.items.map((item) => `${item.productName} × ${item.quantity} 件`).join('，'),
      ]),
      el('p', { class: 'line__meta' }, [`下单时间 ${shortTime(order.createdAt)}`]),
      el('div', { class: 'summary' }, [
        el('span', { class: 'summary__label' }, ['合计']),
        el('span', { class: 'summary__value' }, [money(order.totalCents)]),
      ]),
    ]),
  ]);
}

export function lineThumb(productId, name) {
  return el('img', {
    class: 'line__thumb',
    src: productImageSrc(productId),
    alt: name,
    width: 72,
    height: 72,
    loading: 'lazy',
  });
}
