/**
 * 「我的」页：账号卡 / 订单区块（状态筛选）/ 退出登录。
 *
 * 件数取服务端 `quantityTotal`；订单集合也全部来自服务端，筛选只在已取回的集合里挑子集，
 * 不重新发请求（服务端返回的集合本来就不变）。
 */
import { api, errorMessage } from '../api.mjs';
import { banner, el, emptyState, orderCard, pageHead } from '../components.mjs';
import { cartQuantity, getState, loadCart, setState } from '../state.mjs';
import { PATHS } from '../routes.mjs';

/**
 * 三个筛选档。`已完成` 在本期没有来源：下单即已支付、且不含收货与完成流转，
 * 所以该档匹配到的是空集 —— 这不是写死的空，而是按状态真的筛出来是空。
 */
const ORDER_FILTERS = [
  { key: 'all', label: '全部', match: () => true },
  { key: 'paid', label: '已支付', match: (order) => order.status === 'paid' },
  { key: 'done', label: '已完成', match: (order) => order.status === 'completed' },
];

export function renderMe(root, { error = null } = {}) {
  const { user, orders, notice, orderFilter } = getState();
  const activeKey = ORDER_FILTERS.some((item) => item.key === orderFilter) ? orderFilter : 'all';
  const active = ORDER_FILTERS.find((item) => item.key === activeKey);
  const visible = orders.filter((order) => active.match(order));

  const logout = el('button', { class: 'btn btn--ghost', type: 'button' }, ['退出登录']);
  logout.addEventListener('click', async () => {
    try {
      await api.logout();
      setState({ user: null, orders: [], orderFilter: 'all', notice: '已退出登录' });
      await loadCart();
      renderMe(root, {});
    } catch (caught) {
      renderMe(root, { error: errorMessage(caught) });
    }
  });

  // 账号卡：未登录时也要给出「这是什么」与唯一的下一步动作。
  const accountCard = el('section', { class: 'panel' }, [
    el('div', { class: 'line' }, [
      el('div', { class: 'line__body' }, [
        el('p', { class: 'line__name' }, [user ? `已登录 · 购物车 ${cartQuantity()} 件` : '未登录']),
        el('p', { class: 'line__meta' }, [
          user ? user.email : '登录后购物车会并到账号里，订单也会记在名下。',
        ]),
      ]),
      user
        ? el('a', { class: 'btn', href: PATHS.cart }, ['看购物车'])
        : el('a', { class: 'btn btn--cta', href: PATHS.login }, ['登录']),
    ]),
    user ? el('div', { class: 'actions' }, [logout]) : null,
  ]);

  const pills = el(
    'div',
    { class: 'pills', role: 'group', 'aria-label': '订单状态筛选' },
    ORDER_FILTERS.map((item) => {
      const isActive = item.key === activeKey;
      const pill = el(
        'button',
        {
          class: isActive ? 'pill is-active' : 'pill',
          type: 'button',
          dataset: { filter: item.key },
          'aria-pressed': isActive ? 'true' : 'false',
        },
        [item.label],
      );
      pill.addEventListener('click', () => {
        // 纯本地换挡：订单集合不动，也不重发请求。
        setState({ orderFilter: item.key });
        renderMe(root, {});
      });
      return pill;
    }),
  );

  const orderCards =
    user === null
      ? [emptyState('登录后查看订单', '订单会跟着账号走。')]
      : visible.length > 0
        ? visible.map((order) => orderCard(order))
        : [emptyState(orders.length === 0 ? '还没有订单' : '该状态暂无订单', '换个状态看看，或去商品列表挑几件。')];

  const orderSection = el('section', { class: 'panel' }, [
    el('div', { class: 'line' }, [
      el('div', { class: 'line__body' }, [
        el('p', { class: 'line__name' }, ['我的订单']),
        el('p', { class: 'line__meta' }, [`${orders.length} 单`]),
      ]),
      el('a', { class: 'btn', href: PATHS.orders }, ['查看全部订单']),
    ]),
    el('p', { class: 'line__meta' }, ['按状态查看（本期只读，全部为演示数据）']),
    pills,
    ...orderCards,
  ]);

  const demoCard = el('section', { class: 'panel' }, [
    el('p', { class: 'line__name' }, ['演示环境']),
    el('p', { class: 'line__meta' }, [
      '支付为演示行为（下单即已支付），不产生真实扣款，也不含收货与退款流程。',
    ]),
  ]);

  root.replaceChildren();
  if (notice) root.append(banner(notice, 'ok'));
  if (error) root.append(banner(error));
  root.append(pageHead('我的', user ? '账号与订单都跟着这个账号走' : '未登录'), accountCard, orderSection, demoCard);
}
