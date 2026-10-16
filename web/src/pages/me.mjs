/**
 * 「我的」页：账号信息 / 购物车件数 / 订单入口 / 退出登录。
 *
 * 件数取服务端 `quantityTotal`；退出登录后回到商品列表，购物车回到新的匿名车。
 */
import { api, errorMessage } from '../api.mjs';
import { banner, el, emptyState, pageHead } from '../components.mjs';
import { cartQuantity, getState, loadCart, setState } from '../state.mjs';
import { PATHS } from '../routes.mjs';

export function renderMe(root, { error = null } = {}) {
  const { user, orders, notice } = getState();
  const head = pageHead('我的', user ? '账号与订单都跟着这个账号走' : '未登录');

  if (user === null) {
    root.replaceChildren(
      head,
      el('section', { class: 'panel' }, [
        emptyState('还没有登录', '登录后购物车会并到账号里，订单也会记在名下。'),
        el('div', { class: 'actions' }, [
          el('a', { class: 'btn btn--cta', href: PATHS.login }, ['去登录 / 注册']),
          el('a', { class: 'btn btn--ghost', href: PATHS.products }, ['继续逛']),
        ]),
      ]),
    );
    return;
  }

  const logout = el('button', { class: 'btn btn--ghost', type: 'button' }, ['退出登录']);
  logout.addEventListener('click', async () => {
    try {
      await api.logout();
      setState({ user: null, orders: [], notice: '已退出登录' });
      await loadCart();
      renderMe(root, {});
    } catch (caught) {
      renderMe(root, { error: errorMessage(caught) });
    }
  });

  root.replaceChildren();
  if (notice) root.append(banner(notice, 'ok'));
  if (error) root.append(banner(error));
  root.append(
    head,
    el('section', { class: 'panel' }, [
      el('div', { class: 'line' }, [
        el('div', { class: 'line__body' }, [
          el('p', { class: 'line__name' }, [user.email]),
          el('p', { class: 'line__meta' }, [`注册时间 ${user.createdAt}`]),
        ]),
      ]),
      el('div', { class: 'line' }, [
        el('div', { class: 'line__body' }, [
          el('p', { class: 'line__name' }, [`购物车 ${cartQuantity()} 件`]),
          el('p', { class: 'line__meta' }, ['件数由服务端车汇总给出']),
        ]),
        el('a', { class: 'btn', href: PATHS.cart }, ['看购物车']),
      ]),
      el('div', { class: 'line' }, [
        el('div', { class: 'line__body' }, [
          el('p', { class: 'line__name' }, [`我的订单 ${orders.length} 单`]),
          el('p', { class: 'line__meta' }, ['只显示当前账号的订单']),
        ]),
        el('a', { class: 'btn', href: PATHS.orders }, ['看订单']),
      ]),
      el('div', { class: 'actions' }, [
        logout,
        el('a', { class: 'btn', href: PATHS.products }, ['继续逛']),
      ]),
      el('p', { class: 'line__meta' }, ['演示环境：下单为假支付，不产生真实扣款。']),
    ]),
  );
}
