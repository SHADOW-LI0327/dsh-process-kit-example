/**
 * 首页 · 商品列表。
 *
 * 首帧由服务端渲染，脚本接手后用同一份结构重绘；顶部搜索是**本地筛选**，
 * 不产生任何搜索请求（本期不做搜索端点）。
 */
import { banner, el, emptyState, hero, productGrid } from '../components.mjs';
import { getState } from '../state.mjs';

export function renderProductList(root, ctx = {}) {
  const { products, error } = getState();
  const keyword = String(ctx.keyword ?? '').trim().toLowerCase();
  const list =
    keyword === ''
      ? products
      : products.filter((product) => `${product.name} ${product.description}`.toLowerCase().includes(keyword));

  const top = hero();
  top.append(el('p', { class: 'hero__count', id: 'product-count' }, [`共 ${list.length} 件商品`]));

  const section = el('section', { class: 'catalog' }, [el('h2', { class: 'catalog__title' }, ['全部商品'])]);
  if (list.length === 0) {
    section.append(
      emptyState(
        products.length === 0 ? '商品加载中…' : '没有匹配的商品',
        products.length === 0 ? '稍候刷新，或检查服务是否在运行。' : '换个词再试，或清空顶部搜索框。',
      ),
    );
  } else {
    section.append(productGrid(list));
  }

  root.replaceChildren();
  if (error) root.append(banner(error));
  root.append(top, section);
}
