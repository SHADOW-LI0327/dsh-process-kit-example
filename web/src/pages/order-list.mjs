/**
 * 订单列表页：按下单时间倒序（顺序由服务端保证，前端不再排序）。
 *
 * 未登录时给「去登录」出口而不是一张空表；空态给「去逛商品列表」出口。
 */
import { banner, el, emptyState, pageHead } from '../components.mjs';
import { money, shortTime } from '../format.mjs';
import { getState } from '../state.mjs';
import { PATHS } from '../routes.mjs';

export function renderOrders(root, { error = null } = {}) {
  const { orders, user, notice } = getState();
  const head = pageHead('我的订单', `共 ${orders.length} 单`);

  if (user === null) {
    root.replaceChildren(
      head,
      el('section', { class: 'panel' }, [
        emptyState('登录后查看订单', '订单与购物车都会跟着账号走。'),
        el('div', { class: 'actions' }, [el('a', { class: 'btn btn--cta', href: PATHS.login }, ['去登录'])]),
      ]),
    );
    return;
  }

  if (orders.length === 0) {
    root.replaceChildren(
      head,
      el('section', { class: 'panel' }, [
        emptyState('还没有订单', '挑几件器材，下单后就会出现在这里。'),
        el('div', { class: 'actions' }, [el('a', { class: 'btn btn--cta', href: PATHS.products }, ['去挑商品'])]),
      ]),
    );
    return;
  }

  const cards = orders.map((order) =>
    el('article', { class: 'order', dataset: { orderNo: order.orderNo } }, [
      el('div', { class: 'order__head' }, [
        el('span', { class: 'badge badge--success' }, ['已支付']),
        el('span', { class: 'order__no' }, [order.orderNo]),
      ]),
      el('p', { class: 'order__items' }, [
        order.items.map((item) => `${item.productName} × ${item.quantity}`).join('，'),
      ]),
      el('p', { class: 'order__total' }, [`共 ${order.itemCount} 件 · ${money(order.totalCents)}`]),
      el('p', { class: 'line__meta' }, [`下单时间 ${shortTime(order.createdAt)}`]),
    ]),
  );

  root.replaceChildren();
  if (notice) root.append(banner(notice, 'ok'));
  if (error) root.append(banner(error));
  root.append(head, ...cards);
}
