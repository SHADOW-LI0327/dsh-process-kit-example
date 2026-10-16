/**
 * 商品详情页：主图 + 名称 + 描述 + 加购控件。
 *
 * 加购成功后停留在本页并提示「已加入购物车」，件数徽标按服务端返回的整车更新；
 * 失败时把服务端 `message` 原样显示（例如「该商品暂时缺货，无法加入购物车」）。
 */
import { api, errorMessage } from '../api.mjs';
import { banner, el, emptyState, pageHead, priceNode, productImageSrc, stepper } from '../components.mjs';
import { PATHS } from '../routes.mjs';
import { getState, MAX_QUANTITY, productById, setState, syncCartBadge } from '../state.mjs';

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
  const outOfStock = product.stock === 0;
  // 上限取「现货」与全局 8 的较小者：现货 4 的商品不该让「＋」放到 8、等服务端来拒。
  // 现货 0 时上限为 0 ⇒ 两端都禁用，与下面两个 CTA 的禁用态一起，缺货商品一眼就不可下单。
  const maxQuantity = Math.min(product.stock, MAX_QUANTITY);
  const price = priceNode(product.priceCents, 'detail__price');
  const stockLine = el('p', { class: 'line__meta' }, [
    product.stock > 0 ? `现货 ${product.stock} 件` : '暂时缺货',
  ]);

  const controls = el('div', { class: 'actions actions--cta' });
  const addButton = el('button', { class: 'btn btn--soft', type: 'button' }, ['加入购物车']);
  // 最高意图主 CTA：未登录与结算页同款口径（说明原因后去登录），已登录则加购后直奔结算。
  const buyButton = el('button', { class: 'btn btn--cta', type: 'button' }, ['立即购买']);
  const makeStepper = () =>
    stepper({
      quantity,
      max: maxQuantity,
      onChange: (next) => {
        quantity = next;
        controls.replaceChild(makeStepper(), controls.firstChild);
      },
    });
  const stepperNode = makeStepper();

  // 缺货商品：两个 CTA 在**点击前**就是禁用态（不要点了才提示「该商品暂时缺货」）。
  addButton.disabled = outOfStock;
  buyButton.disabled = outOfStock;

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

  buyButton.addEventListener('click', async () => {
    if (getState().user === null) {
      setState({ loginReason: '请先登录后再下单' });
      location.hash = PATHS.login;
      return;
    }
    buyButton.disabled = true;
    try {
      const cart = await api.addItem(product.id, quantity);
      setState({ cart, error: null, notice: null });
      syncCartBadge();
      location.hash = PATHS.checkout;
    } catch (caught) {
      renderProductDetail(root, { id, error: errorMessage(caught) });
    }
  });

  controls.append(stepperNode, addButton, buyButton);

  const head = pageHead(product.name, '商品详情');
  const body = el('section', { class: 'panel' }, [
    el('img', {
      class: 'detail__img',
      src: productImageSrc(product.id),
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
