/**
 * 结算下单页（下单面 = 独立页面，两步下单的第二跳）。
 *
 * 「提交订单」在途期间按钮禁用且文案变「提交中…」，重复点击不产生第二次请求；
 * 空车也**不禁用**该按钮 —— 空车被拒（`购物车是空的，无法提交订单`）正是用户要看到的行为。
 */
import { api } from '../api.mjs';
import { banner, emptyState, loading } from '../components.mjs';
import { esc, money } from '../format.mjs';

const EMPTY_LINES_HTML = emptyState({
  icon: '空',
  text: '购物车是空的',
  sub: '去商品列表挑一件，加入购物车后可在这里提交订单',
});

function linesHtml(cart) {
  if (cart.items.length === 0) return EMPTY_LINES_HTML;
  const rows = cart.items
    .map(
      (row) =>
        '<li class="checkout-line">' +
        `<span class="checkout-line__name">${esc(row.productName)}</span>` +
        `<span class="checkout-line__qty">× ${row.quantity} 件</span>` +
        `<span class="checkout-line__total">${money(row.lineTotalCents)}</span>` +
        '</li>',
    )
    .join('');
  return `<ul class="checkout-lines">${rows}</ul>`;
}

export async function render(ctx) {
  ctx.ui.setActiveNav('cart');
  ctx.ui.setHeader({
    title: '结算',
    subtitle: '确认订单内容后提交，下单即支付成功',
    action: { label: '返回购物车', href: '#/cart' },
  });
  ctx.root.innerHTML = loading();

  let cart;
  try {
    cart = await api.getCart();
  } catch (error) {
    ctx.root.innerHTML = banner(error.message, { retry: true });
    ctx.root.querySelector('[data-action="retry"]')?.addEventListener('click', () => render(ctx));
    return;
  }
  ctx.ui.setCart(cart);
  ctx.ui.setSubtitle('确认订单内容后提交，下单即支付成功');

  let submitting = false;

  const paint = (message = null) => {
    ctx.root.innerHTML =
      `<div class="band">${message ? banner(message) : ''}` +
      '<section class="card">' +
      '<h2 class="section-title">订单内容</h2>' +
      '<div class="rule"></div>' +
      linesHtml(cart) +
      '<div class="rule"></div>' +
      '<div class="checkout-total">' +
      '<span class="settle-card__label">应付合计</span>' +
      `<span class="settle-card__amount">${money(cart.totalCents)}</span>` +
      '</div></section>' +
      '<div class="checkout-actions">' +
      '<span class="settle-card__hint">下单即支付成功（假支付），无需填写收货信息</span>' +
      '<span class="banner__spacer"></span>' +
      '<a class="btn btn--secondary" href="#/cart">返回购物车</a>' +
      `<button class="btn btn--primary" type="button" id="submit-order"${submitting ? ' disabled' : ''}>` +
      `${submitting ? '提交中…' : '提交订单'}</button>` +
      '</div></div>';
    ctx.root
      .querySelector('#submit-order')
      ?.addEventListener('click', () => submit());
  };

  const submit = async () => {
    if (submitting) return;
    submitting = true;
    paint();
    try {
      await api.createOrder();
      ctx.ui.flash('下单成功');
      await ctx.ui.refreshBadge();
      ctx.ui.navigate('#/orders');
    } catch (error) {
      submitting = false;
      paint(error.message);
    }
  };

  paint();
}
