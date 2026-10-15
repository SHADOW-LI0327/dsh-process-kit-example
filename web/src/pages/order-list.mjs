/**
 * 订单列表页：按下单时间倒序（服务端保证顺序，前端不再排序）。
 *
 * 空态给的是「去逛商品列表」这个出口，而不是一张空卡；
 * 页脚固定说明订单只存在内存里，重启即消失。
 */
import { api } from '../api.mjs';
import { banner, emptyState, loading, orderCard } from '../components.mjs';

const FOOTNOTE = '订单只保存在本次会话中，清除浏览器数据或重启服务后不再显示';

export async function render(ctx) {
  ctx.ui.setActiveNav('orders');
  ctx.ui.setHeader({
    title: '订单列表',
    subtitle: '按下单时间倒序，最近一单在最上面',
    action: { label: '继续购物', href: '#/products' },
  });
  const flash = ctx.ui.consumeFlash();
  ctx.root.innerHTML = loading();

  let orders;
  try {
    orders = await api.listOrders();
  } catch (error) {
    ctx.root.innerHTML = banner(error.message, { retry: true });
    ctx.root.querySelector('[data-action="retry"]')?.addEventListener('click', () => render(ctx));
    return;
  }

  const flashHtml = flash ? banner(flash, { kind: 'success' }) : '';
  // 空态直接落在列表区，不套订单卡外壳：空卡会让人以为「有一张没内容的订单」。
  const bodyHtml =
    orders.length === 0
      ? emptyState({
          icon: '单',
          text: '还没有订单',
          sub: FOOTNOTE,
          actionLabel: '去逛商品列表',
          actionHref: '#/products',
        })
      : `<div class="order-list">${orders.map(orderCard).join('')}</div>` +
        `<p class="page-footer-note">${FOOTNOTE}</p>`;

  ctx.root.innerHTML = `<div class="band">${flashHtml}${bodyHtml}</div>`;
  await ctx.ui.refreshBadge();
}
