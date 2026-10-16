/**
 * 订单详情页：整单快照（订单号 / 下单时间 / 商品行 / 合计）。
 *
 * 不存在、不属于当前账号、未登录 —— 三种情况共用同一张「订单不存在」空态：
 * 页面上不得出现任何订单内容，也不得用不同措辞暗示这一单到底存不存在。
 * 数据未返回时先给「加载中…」，避免出现一屏空白。
 */
import { el, emptyState, pageHead } from '../components.mjs';
import { money, shortTime } from '../format.mjs';
import { PATHS } from '../routes.mjs';

export function renderOrderDetail(root, { loading = false, order = null } = {}) {
  if (loading) {
    root.replaceChildren(
      pageHead('订单详情', '正在读取这一单'),
      el('section', { class: 'panel' }, [el('p', { class: 'loading' }, ['加载中…'])]),
    );
    return;
  }

  if (!order) {
    root.replaceChildren(
      pageHead('订单详情', '按订单号查看'),
      el('section', { class: 'panel' }, [
        emptyState('订单不存在', '回订单列表看看其它订单。'),
        el('div', { class: 'actions' }, [
          el('a', { class: 'btn', href: PATHS.orders }, ['回订单列表']),
        ]),
      ]),
    );
    return;
  }

  const lines = order.items.map((item) =>
    el('div', { class: 'line' }, [
      el('div', { class: 'line__body' }, [
        el('p', { class: 'line__name' }, [item.productName]),
        el('p', { class: 'line__meta' }, [`${money(item.unitPriceCents)} × ${item.quantity} 件`]),
      ]),
      el('p', { class: 'line__price' }, [money(item.lineTotalCents)]),
    ]),
  );

  root.replaceChildren(
    pageHead('订单详情', '按订单号查看'),
    el('section', { class: 'panel' }, [
      el('div', { class: 'order__head' }, [
        el('span', { class: 'badge badge--success' }, ['已支付']),
        el('span', { class: 'order__no' }, [`订单号 ${order.orderNo}`]),
      ]),
      el('p', { class: 'line__meta' }, [`下单时间 ${shortTime(order.createdAt)}`]),
      ...lines,
      el('div', { class: 'summary' }, [
        el('span', { class: 'summary__label' }, ['合计']),
        el('span', { class: 'summary__value' }, [money(order.totalCents)]),
      ]),
    ]),
  );
}
