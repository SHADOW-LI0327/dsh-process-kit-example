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

  const head = pageHead('购物车', '件数与金额均以服务端返回为准');

  if (items.length === 0) {
    root.replaceChildren();
    if (notice) root.append(banner(notice, 'ok'));
    if (error) root.append(banner(error));
    root.append(
      head,
      el('section', { class: 'panel' }, [
        emptyState('购物车是空的，无法提交订单', '先去挑几件器材，再回来结算。'),
        el('div', { class: 'actions' }, [el('a', { class: 'btn btn--cta', href: '#/products' }, ['去挑商品'])]),
      ]),
    );
    return;
  }

  const repaint = (patch) => renderCart(root, patch);
  const failure = (caught) => repaint({ error: errorMessage(caught) });

  const lines = items.map((item) => {
    const remove = el(
      'button',
      { class: 'btn btn--link', type: 'button', 'aria-label': `从购物车移除 ${item.productName}` },
      ['移除'],
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

    const row = el('div', { class: 'line', dataset: { productId: item.productId } }, [
      lineThumb(item.productId, item.productName),
      el('div', { class: 'line__body' }, [
        el('p', { class: 'line__name' }, [item.productName]),
        el('p', { class: 'line__meta' }, [`单价 ${money(item.unitPriceCents)}`]),
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
      el('div', {}, [el('p', { class: 'line__price' }, [money(item.lineTotalCents)]), remove]),
    ]);
    return row;
  });

  const panel = el('section', { class: 'panel' }, [
    ...lines,
    summary('合计', cart.totalCents),
    el('div', { class: 'actions' }, [
      el('a', { class: 'btn btn--cta', href: '#/checkout' }, ['去结算']),
      el('a', { class: 'btn btn--ghost', href: '#/products' }, ['继续逛']),
    ]),
  ]);

  root.replaceChildren();
  if (notice) root.append(banner(notice, 'ok'));
  if (error) root.append(banner(error));
  root.append(head, el('div', { class: 'cart-layout' }, [panel]));
}
