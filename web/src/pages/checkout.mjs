/**
 * 结算页：展示整车快照 + 「提交订单」。
 *
 * 提交成功即假支付成功（订单状态 `paid`），随后跳订单列表；
 * 被拒时把服务端 `message` 原样显示（「购物车是空的，无法提交订单」/「库存不足，请调整购买件数」）。
 */
import { api, errorMessage } from '../api.mjs';
import { banner, el, emptyState, pageHead, summary } from '../components.mjs';
import { money } from '../format.mjs';
import { getState, setState, syncCartBadge } from '../state.mjs';
import { PATHS } from '../routes.mjs';

export function renderCheckout(root, { error = null } = {}) {
  const { cart, user } = getState();
  const items = cart && Array.isArray(cart.items) ? cart.items : [];

  const head = pageHead('确认订单', '演示环境：提交即视为已支付（假支付）');
  const submit = el('button', { class: 'btn btn--cta', type: 'button' }, ['提交订单']);
  submit.addEventListener('click', async () => {
    submit.disabled = true;
    submit.textContent = '提交中…';
    try {
      const order = await api.submitOrder();
      const fresh = await api.cart();
      setState({ cart: fresh, error: null, notice: `下单成功：${order.orderNo}` });
      syncCartBadge();
      location.hash = PATHS.orders;
    } catch (caught) {
      submit.disabled = false;
      submit.textContent = '提交订单';
      renderCheckout(root, { error: errorMessage(caught) });
    }
  });

  const rows = items.map((item) =>
    el('div', { class: 'line' }, [
      el('div', { class: 'line__body' }, [
        el('p', { class: 'line__name' }, [item.productName]),
        el('p', { class: 'line__meta' }, [`${money(item.unitPriceCents)} × ${item.quantity}`]),
      ]),
      el('p', { class: 'line__price' }, [money(item.lineTotalCents)]),
    ]),
  );

  const panel = el('section', { class: 'panel' }, [
    ...(items.length > 0 ? rows : [emptyState('购物车是空的，无法提交订单', '回购物车加几件再来。')]),
    summary('实付', cart ? cart.totalCents : 0),
    el('div', { class: 'actions' }, [
      submit,
      el('a', { class: 'btn btn--ghost', href: PATHS.cart }, ['回购物车']),
    ]),
    user === null
      ? el('p', { class: 'line__meta' }, [
          '未登录：下单需要先登录，',
          el('a', { class: 'btn btn--link', href: PATHS.login }, ['去登录']),
        ])
      : el('p', { class: 'line__meta' }, [`下单账号：${user.email}`]),
  ]);

  root.replaceChildren();
  if (error) root.append(banner(error));
  root.append(head, el('div', { class: 'cart-layout' }, [panel]));
}
