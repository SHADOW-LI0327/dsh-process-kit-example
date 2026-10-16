/**
 * 购物车页：行件数调整 / 删除 / 去结算。
 *
 * 每一次件数变化都以服务端返回的**整车**重绘，前端不自己加减；
 * 被拒时把服务端 `message` 原样显示（例如「已达上限：单件商品最多买 8 件」）。
 */
import { api, errorMessage } from '../api.mjs';
import { banner, el, emptyState, lineThumb, pageHead, stepper, summary } from '../components.mjs';
import { money } from '../format.mjs';
import { getState, setState, syncCartBadge } from '../state.mjs';

export function renderCart(root, { error = null, notice = null } = {}) {
  const cart = getState().cart;
  const items = cart && Array.isArray(cart.items) ? cart.items : [];
  const quantityTotal = cart && Number.isInteger(cart.quantityTotal) ? cart.quantityTotal : 0;

  const head = pageHead('购物车', '件数与金额均以服务端返回为准');

  if (items.length === 0) {
    root.replaceChildren();
    if (notice) root.append(banner(notice, 'ok'));
    if (error) root.append(banner(error));
    root.append(
      head,
      el('section', { class: 'panel' }, [
        emptyState('购物车还是空的', '先去挑几件器材，再回来结算。'),
        el('div', { class: 'actions' }, [
          el('a', { class: 'btn btn--cta', href: '#/products' }, ['去逛商品列表']),
        ]),
      ]),
    );
    return;
  }

  const repaint = (patch) => renderCart(root, patch);
  const failure = (caught) => repaint({ error: errorMessage(caught) });

  const lines = items.map((item) => {
    const remove = el(
      'button',
      { class: 'btn btn--link', type: 'button', 'aria-label': `删除 ${item.productName}` },
      ['删除'],
    );
    remove.addEventListener('click', async () => {
      try {
        const fresh = await api.removeItem(item.productId);
        setState({ cart: fresh, error: null });
        syncCartBadge();
        repaint({});
      } catch (caught) {
        failure(caught);
      }
    });

    // 单价与实付都带标签：裸金额分不清「一件的钱」还是「这一行的钱」（只有后者随件数变）。
    const row = el('div', { class: 'line', dataset: { productId: item.productId } }, [
      lineThumb(item.productId, item.productName),
      el('div', { class: 'line__body' }, [
        el('p', { class: 'line__name' }, [item.productName]),
        el('p', { class: 'line__meta' }, [`单价 ${money(item.unitPriceCents)}`]),
        el('p', { class: 'line__price' }, [`实付 ${money(item.lineTotalCents)}`]),
        stepper({
          quantity: item.quantity,
          onChange: async (next) => {
            try {
              const fresh = await api.setItem(item.productId, next);
              setState({ cart: fresh, error: null });
              syncCartBadge();
              repaint({});
            } catch (caught) {
              failure(caught);
            }
          },
        }),
      ]),
      el('div', { class: 'line__side' }, [remove]),
    ]);
    return row;
  });

  // 宽屏的右侧结算卡：件数与金额都取自服务端整车，前端不再算一遍。
  const summaryCard = el('aside', { class: 'panel summary-card' }, [
    el('h2', { class: 'summary-card__title' }, ['订单摘要']),
    el('p', { class: 'summary-card__meta' }, [`商品件数 ${quantityTotal} 件`]),
    summary('应付合计', cart.totalCents),
    el('div', { class: 'actions' }, [
      el('a', { class: 'btn btn--cta', href: '#/checkout' }, [`去结算(${quantityTotal})`]),
    ]),
  ]);

  root.replaceChildren();
  if (notice) root.append(banner(notice, 'ok'));
  if (error) root.append(banner(error));
  root.append(
    head,
    el('div', { class: 'cart-layout' }, [el('section', { class: 'panel' }, lines), summaryCard]),
  );
}
