/**
 * 首页 · 商品列表。
 *
 * 加载态先于数据出现：内容区先写「加载中…」，拿到数据再换成卡片，
 * 期间不出现空态文案（种子是只读的，列表本身没有「空」这一态）。
 */
import { api } from '../api.mjs';
import { banner, loading, productCard } from '../components.mjs';

export async function render(ctx) {
  ctx.ui.setActiveNav('products');
  ctx.ui.setHeader({ title: '商品列表', action: { label: '去购物车', href: '#/cart' } });
  ctx.root.innerHTML = loading();

  let items;
  try {
    items = await api.listProducts();
  } catch (error) {
    ctx.root.innerHTML = banner(error.message, { retry: true });
    ctx.root.querySelector('[data-action="retry"]')?.addEventListener('click', () => render(ctx));
    return;
  }

  ctx.ui.setSubtitle(`共 ${items.length} 件商品，价格以元显示`);
  ctx.root.innerHTML =
    `<div class="band"><div class="cards-grid">${items.map(productCard).join('')}</div></div>`;
  await ctx.ui.refreshBadge();
}
