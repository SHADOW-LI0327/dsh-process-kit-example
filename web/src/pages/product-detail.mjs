/**
 * 商品详情页。
 *
 * 加购成功后**停留本页**并提示「已加入购物车」，页头件数徽标按服务端返回的整车更新；
 * 加购失败时把服务端 `message` 原样显示，页面上的库存与徽标保持服务端值不回弹。
 */
import { api } from '../api.mjs';
import { banner, detail, loading } from '../components.mjs';

export async function render(ctx, params) {
  ctx.ui.setActiveNav('products');
  ctx.ui.setHeader({
    title: '商品详情',
    subtitle: '价格以元显示，单次加购上限 8 件',
    action: { label: '去购物车', href: '#/cart' },
  });
  ctx.root.innerHTML = loading();

  let product;
  try {
    product = await api.getProduct(params.id);
  } catch (error) {
    // 商品不存在属「重试无意义」，给的是回列表的出口而不是重试按钮。
    ctx.root.innerHTML = banner(error.message, {
      link: { label: '返回商品列表', href: '#/products' },
    });
    return;
  }

  ctx.root.innerHTML = detail(product);
  const flashSlot = ctx.root.querySelector('#detail-flash');
  const button = ctx.root.querySelector('#add-to-cart');

  button?.addEventListener('click', async () => {
    const label = button.textContent;
    button.disabled = true;
    button.textContent = '提交中…';
    try {
      const cart = await api.addCartItem(product.id, 1);
      ctx.ui.setCart(cart);
      flashSlot.innerHTML = banner('已加入购物车', { kind: 'success' });
    } catch (error) {
      flashSlot.innerHTML = banner(error.message);
    } finally {
      button.disabled = product.stock === 0;
      button.textContent = label;
    }
  });

  await ctx.ui.refreshBadge();
}
