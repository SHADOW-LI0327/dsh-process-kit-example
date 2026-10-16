/**
 * 视图构件：商品卡 / 行件数控件 / 提示条 / 空态，五页共用。
 *
 * 构件只吃服务端数据：件数控件的变化一律由调用方发请求、用响应重绘，
 * 前端不自己加减，避免「前端算错也算过」的假绿。
 */
import { MAX_QUANTITY } from './state.mjs';
import { money, yuanParts } from './format.mjs';

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

/** 商品卡：主图在上，标题与价格在下（图 → 标题 → 价格的 DOM 顺序）。 */
export function productCard(product) {
  const image = el('img', {
    class: 'card__img',
    src: `/assets/products/${product.id}.jpg`,
    alt: product.name,
    width: 300,
    height: 300,
    loading: 'lazy',
    decoding: 'async',
  });
  const link = el('a', { class: 'card__link', href: `#/products/${product.id}` }, [
    image,
    el('h3', { class: 'card__title' }, [product.name]),
    priceNode(product.priceCents),
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

/** 行件数控件：`+` 与上限绑定（达到 8 件即禁用），`−` 到 1 即禁用。 */
export function stepper({ quantity, max = MAX_QUANTITY, onChange }) {
  const minus = el('button', { class: 'stepper__btn', type: 'button', 'aria-label': '减少一件' }, ['−']);
  const plus = el('button', { class: 'stepper__btn', type: 'button', 'aria-label': '增加一件' }, ['+']);
  const value = el('span', { class: 'stepper__value', 'data-quantity': quantity }, [String(quantity)]);
  plus.disabled = quantity >= MAX_QUANTITY;
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
    el('p', { class: 'hero__tags' }, [
      el('span', { class: 'badge badge--success' }, ['包邮']),
      el('span', { class: 'badge badge--accent' }, ['秒杀']),
    ]),
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

export function lineThumb(productId, name) {
  return el('img', {
    class: 'line__thumb',
    src: `/assets/products/${productId}.jpg`,
    alt: name,
    width: 64,
    height: 64,
    loading: 'lazy',
  });
}
