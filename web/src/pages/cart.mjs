/**
 * 购物车管理页 / 空态页。
 *
 * 每一行的件数变化都以**服务端返回的整车**为准重绘，前端不自己加减；
 * 请求在途时只禁用该行控件，被拒时数字回退为服务端当前值并给出中文提示。
 */
import { api } from '../api.mjs';
import { banner, cartTable, emptyState, loading, settleCard } from '../components.mjs';

const EMPTY_CART_HTML = emptyState({
  icon: '空',
  text: '购物车是空的',
  sub: '去商品列表挑一件，加入购物车后可在这里提交订单',
});

export async function render(ctx) {
  ctx.ui.setActiveNav('cart');
  ctx.ui.setHeader({ title: '购物车', action: { label: '继续购物', href: '#/products' } });
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

  const paint = (nextCart, { busyId = null, message = null } = {}) => {
    const listPart =
      nextCart.items.length === 0
        ? `<section class="card table-card">${EMPTY_CART_HTML}</section>`
        : `<section class="card table-card">${cartTable(nextCart, busyId)}</section>`;
    ctx.root.innerHTML =
      `<div class="band">${message ? banner(message) : ''}${listPart}${settleCard(nextCart)}</div>`;
    bind(nextCart);
  };

  const change = async (productId, delta) => {
    const row = cart.items.find((item) => item.productId === productId);
    if (!row) return;
    const next = row.quantity + delta;
    if (next < 1 || next > 8) return;
    paint(cart, { busyId: productId });
    try {
      cart = await api.updateCartItem(productId, next);
      ctx.ui.setCart(cart);
      paint(cart);
    } catch (error) {
      // 不做乐观更新：失败即回到服务端当前值，附上服务端给的中文提示。
      paint(cart, { message: error.message });
    }
  };

  const remove = async (productId) => {
    paint(cart, { busyId: productId });
    try {
      cart = await api.deleteCartItem(productId);
      ctx.ui.setCart(cart);
      paint(cart);
    } catch (error) {
      paint(cart, { message: error.message });
    }
  };

  const bind = (current) => {
    ctx.root.querySelector('[data-action="retry"]')?.addEventListener('click', () => render(ctx));
    for (const row of ctx.root.querySelectorAll('tr[data-row]')) {
      const productId = row.getAttribute('data-row');
      row
        .querySelector('[data-action="inc"]')
        ?.addEventListener('click', () => change(productId, 1));
      row
        .querySelector('[data-action="dec"]')
        ?.addEventListener('click', () => change(productId, -1));
      row.querySelector('[data-action="remove"]')?.addEventListener('click', () => remove(productId));
    }
    ctx.ui.setSubtitle(`共 ${current.quantityTotal} 件商品，价格以元显示`);
  };

  paint(cart);
}
