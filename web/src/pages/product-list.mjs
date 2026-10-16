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
  // 只按**名称**过滤：描述里出现同一个字（例如「附滤纸」）会把不相干的商品也拖进结果，
  // 用户按名字找东西时那是噪声。
  const list =
    keyword === ''
      ? products
      : products.filter((product) => product.name.toLowerCase().includes(keyword));

  const top = hero();
  top.append(el('p', { class: 'hero__count', id: 'product-count' }, [`共 ${list.length} 件商品`]));

  // 首帧那份 HTML 里区块标题带 `id`、section 用 `aria-labelledby` 指向它；
  // 脚本接手后若把 `id` 丢了，首帧与重绘后就不是同一份结构（无障碍引用也会断）。
  const section = el('section', { class: 'catalog', 'aria-labelledby': 'catalog-title' }, [
    el('h2', { class: 'catalog__title', id: 'catalog-title' }, ['商品列表']),
  ]);
  if (list.length === 0) {
    section.append(
      emptyState(
        products.length === 0 ? '商品加载中…' : '没有找到相关商品',
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
