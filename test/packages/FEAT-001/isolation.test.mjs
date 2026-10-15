/**
 * 隔离性：购物车按 cartId 归属，实例之间不共享内存态，重启即重置。
 *
 * @prd FEAT-001
 * @prdVersion 2
 * @priority P0
 * @status active
 * @case TC-FEAT-001-30
 * @case TC-FEAT-001-E09
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  data,
  getCart,
  getOrders,
  listProducts,
  newClient,
  startApp,
  withApp,
} from './helpers/app.mjs';

async function seedItems(app) {
  const { items } = await listProducts(newClient(app));
  return items;
}

const addItem = (client, productId, quantity) =>
  client.post('/api/v1/cart/items', { productId, quantity });

const namesOf = (cart) => cart.items.map((item) => item.productName);

test('刷新即重置（AC-30）', async () => {
  await withApp(undefined, async (app) => {
    const a = newClient(app);
    const target = (await seedItems(app))[0];
    const initialStock = data(await a.get(`/api/v1/products/${target.id}`)).stock;
    assert.equal((await addItem(a, target.id, 2)).status, 201);
    assert.equal((await a.post('/api/v1/orders')).status, 201);
    assert.equal((await getOrders(a)).orders.length, 1);

    // ① 同实例、全新客户端（新 cookie）：看不到别人的车与单
    const fresh = newClient(app);
    assert.equal((await getCart(fresh)).cart.items.length, 0);
    assert.equal((await getOrders(fresh)).orders.length, 0);

    // ② 同一份种子重建实例（模拟进程重启）：同一个 cookie 也拿不回旧状态
    const rebuilt = await startApp();
    try {
      const sameCookie = newClient(rebuilt, { cookie: a.cookie });
      assert.ok(sameCookie.cookie.startsWith('cartId='), '前置：必须带着原 cartId 访问新实例');
      assert.equal((await getCart(sameCookie)).cart.items.length, 0);
      assert.equal((await getOrders(sameCookie)).orders.length, 0);
      const stock = data(await sameCookie.get(`/api/v1/products/${target.id}`)).stock;
      assert.equal(stock, initialStock, '商品库存必须回到种子初值');
    } finally {
      await rebuilt.close();
    }
  });
});

test('跨客户端隔离（E-09）', async () => {
  await withApp(undefined, async (app) => {
    const a = newClient(app);
    const b = newClient(app);
    const [first, second] = await seedItems(app);

    assert.equal((await addItem(a, first.id, 1)).status, 201);
    const aTotalBefore = (await getCart(a)).cart.totalCents;
    assert.equal((await addItem(b, second.id, 2)).status, 201);

    const aCart = (await getCart(a)).cart;
    const bCart = (await getCart(b)).cart;
    assert.deepEqual(namesOf(aCart), [first.name], 'A 的车里只能有 A 加的货');
    assert.deepEqual(namesOf(bCart), [second.name], 'B 的车里只能有 B 加的货');
    assert.equal(aCart.totalCents, aTotalBefore, 'A 的总额不得受 B 的加购影响');
    assert.equal(
      namesOf(aCart).some((name) => namesOf(bCart).includes(name)),
      false,
      '两个客户端的行集合必须互斥',
    );
  });
});
