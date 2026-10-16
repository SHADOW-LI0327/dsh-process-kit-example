/**
 * 商品详情页：主图 + 名称 + 描述 + 加购控件。
 *
 * 加购成功后停留在本页并提示「已加入购物车」，件数徽标按服务端返回的整车更新；
 * 失败时把服务端 `message` 原样显示（例如「该商品暂时缺货，无法加入购物车」）。
 */
import { api, errorMessage } from '../api.mjs';
import { banner, el, emptyState, pageHead, priceNode, stepper } from '../components.mjs';
import { getState, productById, setState, syncCartBadge } from '../state.mjs';

export function renderProductDetail(root, { id, notice = null, error = null } = {}) {
  const product = productById(id);
  if (!product) {
    const back = el('a', { class: 'btn', href: '#/products' }, ['去商品列表']);
    root.replaceChildren(
      pageHead('商品详情'),
      emptyState('找不到该商品', '可能已下架，去列表看看别的器材。'),
      el('div', { class: 'actions' }, [back]),
    );
    return;
  }

  let quantity = 1;
  const price = priceNode(product.priceCents, 'detail__price');
  const stockLine = el('p', { class: 'line__meta' }, [
    product.stock > 0 ? `现货 ${product.stock} 件` : '暂时缺货',
  ]);

  const controls = el('div', { class: 'actions' });
  const addButton = el('button', { class: 'btn btn--cta', type: 'button' }, ['加入购物车']);
  const makeStepper = () =>
    stepper({
      quantity,
      onChange: (next) => {
        quantity = next;
        controls.replaceChild(makeStepper(), controls.firstChild);
      },
    });
  const stepperNode = makeStepper();

  addButton.addEventListener('click', async () => {
    addButton.disabled = true;
    try {
      const cart = await api.addItem(product.id, quantity);
      setState({ cart, error: null, notice: `已加入购物车：${product.name} × ${quantity}` });
      syncCartBadge();
      renderProductDetail(root, { id, notice: getState().notice });
    } catch (caught) {
      renderProductDetail(root, { id, error: errorMessage(caught) });
    }
  });

  controls.append(stepperNode, addButton);

  const head = pageHead(product.name, '商品详情');
  const body = el('section', { class: 'panel' }, [
    el('img', {
      class: 'detail__img',
      src: `/assets/products/${product.id}.jpg`,
      alt: product.name,
      width: 600,
      height: 600,
    }),
    el('h2', { class: 'detail__name' }, [product.name]),
    el('p', { class: 'detail__desc' }, [product.description]),
    price,
    stockLine,
    controls,
    el('div', { class: 'actions' }, [el('a', { class: 'btn btn--ghost', href: '#/products' }, ['继续逛'])]),
  ]);

  root.replaceChildren();
  if (notice) root.append(banner(notice, 'ok'));
  if (error) root.append(banner(error));
  root.append(head, body);
}
