/**
 * 视图构件：列表 / 详情 / 购物车 / 结算 / 订单五页共用的 HTML 片段。
 *
 * 每个构件都只吃服务端返回的数据，不在前端做任何金额或件数的再计算 ——
 * 前端自己算一遍就会出现「前端算错也算过」的假绿，也会让页面与响应体对不上。
 */
import { esc, initial, money, tileVariant } from './format.mjs';

export const LOADING_HTML = '<p class="loading">加载中…</p>';

export function loading() {
  return LOADING_HTML;
}

/**
 * 行内提示横幅：错误默认不可重试，页面级加载错误显式给「重试」按钮。
 * 文案原样取服务端 `message`，不在前端另拟句子。
 */
export function banner(message, { kind = 'danger', retry = false, link = null } = {}) {
  const retryButton = retry
    ? '<button class="btn btn--ghost" type="button" data-action="retry">重试</button>'
    : '';
  const linkButton = link
    ? `<a class="btn btn--ghost" href="${esc(link.href)}">${esc(link.label)}</a>`
    : '';
  return (
    `<div class="banner${kind === 'success' ? ' banner--success' : ''}" data-banner="${esc(kind)}">` +
    `<span>${esc(message)}</span><span class="banner__spacer"></span>${linkButton}${retryButton}</div>`
  );
}

export function tile(name, variant = null, size = '') {
  const kind = variant ?? tileVariant(name);
  const sizeClass = size === '' ? '' : ` tile--${size}`;
  return (
    `<span class="tile tile--${kind}${sizeClass}" aria-hidden="true">${esc(initial(name))}</span>`
  );
}

export function productCard(product) {
  return (
    `<article class="card product-card" data-product-name="${esc(product.name)}">` +
    '<div class="product-card__head">' +
    tile(product.name) +
    '<div class="product-card__meta">' +
    `<a class="product-card__name" href="#/products/${encodeURIComponent(product.id)}">${esc(product.name)}</a>` +
    `<span class="product-card__price">${money(product.priceCents)}</span>` +
    `<span class="product-card__stock">库存 ${product.stock} 件</span>` +
    '</div></div>' +
    `<p class="product-card__description">${esc(product.description)}</p>` +
    '</article>'
  );
}

export function cartTable(cart, busyId = null) {
  const rows = cart.items
    .map((row) => {
      const busy = busyId !== null && busyId === row.productId;
      const decDisabled = busy || row.quantity <= 1 ? ' disabled' : '';
      const incDisabled = busy || row.quantity >= 8 ? ' disabled' : '';
      return (
        `<tr data-row="${esc(row.productId)}">` +
        `<td class="col-name">${tile(row.productName, null, 'sm')}<span>${esc(row.productName)}</span></td>` +
        `<td>${money(row.unitPriceCents)}</td>` +
        '<td><div class="stepper">' +
        `<button class="stepper__btn" type="button" data-action="dec"${decDisabled}>－</button>` +
        `<span class="stepper__value">${row.quantity}</span>` +
        `<button class="stepper__btn" type="button" data-action="inc"${incDisabled}>＋</button>` +
        '</div></td>' +
        `<td>${money(row.lineTotalCents)}</td>` +
        `<td class="op"><button class="link-btn" type="button" data-action="remove"${busy ? ' disabled' : ''}>删除</button></td>` +
        '</tr>'
      );
    })
    .join('');
  return (
    '<table class="cart-table"><thead><tr>' +
    '<th>商品</th><th class="num">单价</th><th class="num">件数</th>' +
    '<th class="num">小计</th><th class="op">操作</th>' +
    `</tr></thead><tbody>${rows}</tbody></table>`
  );
}

export function settleCard(cart) {
  return (
    '<section class="card settle-card">' +
    '<div class="settle-card__left">' +
    `<span class="settle-card__count">共 ${cart.quantityTotal} 件商品</span>` +
    '<span class="settle-card__label">合计</span>' +
    `<span class="settle-card__amount">${money(cart.totalCents)}</span>` +
    '</div>' +
    '<div class="settle-card__right">' +
    '<a class="btn btn--primary" href="#/checkout">去结算</a>' +
    '<span class="settle-card__hint">下单即支付成功（假支付）</span>' +
    '</div></section>'
  );
}

export function emptyState({ icon = '空', text, sub, actionLabel = null, actionHref = null }) {
  const action = actionLabel
    ? `<a class="btn btn--primary" href="${esc(actionHref)}">${esc(actionLabel)}</a>`
    : '';
  return (
    '<div class="empty">' +
    `<span class="tile tile--muted" aria-hidden="true">${esc(icon)}</span>` +
    `<span class="empty__text">${esc(text)}</span>` +
    (sub ? `<span class="empty__sub">${esc(sub)}</span>` : '') +
    action +
    '</div>'
  );
}

export function orderCard(order) {
  const lines = order.items
    .map(
      (item) =>
        `<li class="order-card__line">${esc(item.productName)} × ${item.quantity} 件</li>`,
    )
    .join('');
  return (
    '<article class="card order-card" data-order-no="' +
    esc(order.orderNo) +
    '">' +
    '<div class="order-card__top"><div>' +
    `<div class="order-card__no">订单号 ${esc(order.orderNo)}</div>` +
    `<div class="order-card__time">下单时间 ${esc(order.createdAt)}</div>` +
    '</div>' +
    `<span class="capsule">${order.status === 'paid' ? '已支付' : esc(order.status)}</span>` +
    '</div>' +
    '<div class="rule"></div>' +
    `<ul class="order-card__lines">${lines}</ul>` +
    '<div class="rule"></div>' +
    '<div class="order-card__foot">' +
    '<span class="label">合计</span>' +
    `<span class="order-card__total">${money(order.totalCents)}</span>` +
    '</div></article>'
  );
}

export function detail(product) {
  const outOfStock = product.stock === 0;
  const stockBanner = outOfStock
    ? banner('该商品暂时缺货，无法加入购物车')
    : '';
  return (
    '<div class="band">' +
    '<div id="detail-flash"></div>' +
    stockBanner +
    '<div class="detail">' +
    tile(product.name, null, 'lg') +
    '<section class="card detail__info">' +
    `<h2 class="detail__name">${esc(product.name)}</h2>` +
    `<p class="detail__price">${money(product.priceCents)}</p>` +
    `<p class="detail__stock">库存 ${product.stock} 件</p>` +
    '<div class="detail__divider"></div>' +
    '<span class="label">商品描述</span>' +
    `<p class="detail__description">${esc(product.description)}</p>` +
    '<div class="btn-row">' +
    `<button class="btn btn--primary" type="button" id="add-to-cart"${outOfStock ? ' disabled' : ''}>加入购物车</button>` +
    '<a class="btn btn--secondary" href="#/products">返回商品列表</a>' +
    '</div></section></div></div>'
  );
}
