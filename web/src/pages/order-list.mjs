/**
 * 订单列表页：按下单时间倒序（顺序由服务端保证，前端不再排序）。
 *
 * 未登录时给「去登录」出口而不是一张空表；空态给「去逛商品列表」出口。
 */
import { banner, el, emptyState, orderCard, pageHead } from '../components.mjs';
import { getState } from '../state.mjs';
import { PATHS } from '../routes.mjs';

export function renderOrders(root, { error = null } = {}) {
  const { orders, user, notice } = getState();
  const head = pageHead('订单', '按下单时间倒序，最近一单在最上面');

  if (user === null) {
    root.replaceChildren(
      head,
      el('section', { class: 'panel' }, [
        emptyState('登录后查看订单', '订单与购物车都会跟着账号走。'),
        el('div', { class: 'actions' }, [el('a', { class: 'btn btn--cta', href: PATHS.login }, ['登录'])]),
      ]),
    );
    return;
  }

  if (orders.length === 0) {
    root.replaceChildren(
      head,
      el('section', { class: 'panel' }, [
        emptyState('还没有订单', '挑几件器材，下单后就会出现在这里。'),
        el('div', { class: 'actions actions--cta' }, [
          el('a', { class: 'btn btn--soft', href: PATHS.products }, ['去逛商品列表']),
        ]),
      ]),
    );
    return;
  }

  root.replaceChildren();
  if (notice) root.append(banner(notice, 'ok'));
  if (error) root.append(banner(error));
  root.append(head, ...orders.map((order) => orderCard(order)));
}
