/**
 * 下单（假支付）与订单列表：状态、库存扣减、原子性、金额口径、订单号唯一性、同端口。
 *
 * @prd FEAT-001
 * @prdVersion 2
 * @priority P0
 * @status active
 * @case TC-FEAT-001-18
 * @case TC-FEAT-001-19
 * @case TC-FEAT-001-20
 * @case TC-FEAT-001-21
 * @case TC-FEAT-001-22
 * @case TC-FEAT-001-23
 * @case TC-FEAT-001-24
 * @case TC-FEAT-001-25
 * @case TC-FEAT-001-26
 * @case TC-FEAT-001-E07
 * @case TC-FEAT-001-E08
 * @case TC-FEAT-001-E10
 * @case TC-FEAT-001-E12
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  data,
  findBy,
  findByName,
  getCart,
  getOrders,
  listProducts,
  makeSeed,
  newClient,
  withApp,
} from './helpers/app.mjs';

async function seedItems(app) {
  const { items } = await listProducts(newClient(app));
  return items;
}

const addItem = (client, productId, quantity) =>
  client.post('/api/v1/cart/items', { productId, quantity });

const isMoneyKey = (key) => /price|total|amount/i.test(key);

test('下单即支付成功（AC-18）', async () => {
  await withApp(undefined, async (app) => {
    const client = newClient(app);
    const items = await seedItems(app);
    assert.equal((await addItem(client, items[0].id, 1)).status, 201);
    const res = await client.post('/api/v1/orders');
    assert.equal(res.status, 201);
    const order = data(res);
    assert.equal(order.status, 'paid');
    assert.equal(typeof order.paidAt, 'string');
    assert.equal(Number.isNaN(Date.parse(order.paidAt)), false, `paidAt 必须可解析：${order.paidAt}`);
    assert.equal(typeof order.orderNo, 'string');
    assert.notEqual(order.orderNo.trim(), '', '订单号必须非空');
    assert.equal(['pending', 'unpaid'].includes(order.status), false, '不得出现中间态');
    // 订单实体的行 / 件数合计 / 总额三个字段在此顺带锁住类型。
    assert.ok(Array.isArray(order.items) && order.items.length >= 1);
    assert.equal(Number.isInteger(order.itemCount), true);
    assert.equal(Number.isInteger(order.totalCents), true);
  });
});

test('下单扣减库存（AC-19）', async () => {
  await withApp(undefined, async (app) => {
    const client = newClient(app);
    const items = await seedItems(app);
    const target = items[0];
    const quantity = 3;
    const stockBefore = data(await client.get(`/api/v1/products/${target.id}`)).stock;
    assert.equal((await addItem(client, target.id, quantity)).status, 201);
    assert.equal((await client.post('/api/v1/orders')).status, 201);
    const stockAfter = data(await client.get(`/api/v1/products/${target.id}`)).stock;
    assert.equal(stockAfter, stockBefore - quantity);
  });
});

test('缺货下单拒绝（AC-20）', async () => {
  await withApp(undefined, async (app) => {
    const items = await seedItems(app);
    const target = items[0];
    const readStock = async () =>
      data(await newClient(app).get(`/api/v1/products/${target.id}`)).stock;
    const initial = await readStock();
    // 买多少由「观测到的库存」推导，判据写成相对 S 的关系式，不写死库存初值。
    assert.ok(
      initial >= 4 && initial <= 11,
      `库存初值 ${initial} 超出本用例可构造区间 [4, 11]：区间外无法用闭区间与两端外各一单位压边界`,
    );

    // ① 先下单一部分，把库存压到 3（默认种子单行上限 8，一次买不完两头）
    const first = newClient(app);
    assert.equal((await addItem(first, target.id, initial - 3)).status, 201);
    assert.equal((await first.post('/api/v1/orders')).status, 201);
    assert.equal(await readStock(), 3);

    // ② 内一点 Q = S - 1 → 通过
    const inner = newClient(app);
    assert.equal((await addItem(inner, target.id, 2)).status, 201);
    assert.equal((await inner.post('/api/v1/orders')).status, 201);
    const remaining = await readStock();
    assert.equal(remaining, 1);

    // ③ 外点 Q = S + 1 → 拒绝，且库存 / 订单 / 购物车三处都不得变化
    const over = newClient(app);
    const outPoint = remaining + 1;
    assert.equal((await addItem(over, target.id, outPoint)).status, 201, '加购阶段允许超过库存');
    const ordersBefore = (await getOrders(over)).orders.length;
    assert.ok(outPoint > remaining, `前置：外点必须满足 Q > S（Q=${outPoint}, S=${remaining}）`);
    const rejected = await over.post('/api/v1/orders');
    assert.equal(rejected.status, 409);
    assert.equal(rejected.json.code, 'INSUFFICIENT_STOCK');
    assert.ok(
      rejected.json.message.includes('库存不足'),
      `message 必须含契约关键字，实际：${rejected.json.message}`,
    );
    assert.equal(await readStock(), remaining, '被拒后库存不得变化');
    assert.equal((await getOrders(over)).orders.length, ordersBefore, '被拒后订单不得新增');
    const cartAfterReject = (await getCart(over)).cart;
    assert.equal(cartAfterReject.items.length, 1, '被拒后购物车不得被清空');

    // ④ 端点 Q = S → 恰好买完，库存归零
    const exact = newClient(app);
    assert.equal((await addItem(exact, target.id, remaining)).status, 201);
    assert.equal((await exact.post('/api/v1/orders')).status, 201);
    assert.equal(await readStock(), 0);
  });
});

test('总额分为单位（AC-21）', async () => {
  await withApp(undefined, async (app) => {
    const client = newClient(app);
    const items = await seedItems(app);
    const [first, second] = items;
    assert.equal((await addItem(client, first.id, 1)).status, 201);
    assert.equal((await addItem(client, second.id, 2)).status, 201);
    const cartBefore = (await getCart(client)).cart;
    const unit1 = findBy(cartBefore.items, 'productName', first.name).unitPriceCents;
    const unit2 = findBy(cartBefore.items, 'productName', second.name).unitPriceCents;

    const res = await client.post('/api/v1/orders');
    assert.equal(res.status, 201);
    const order = data(res);
    assert.equal(order.totalCents, unit1 * 1 + unit2 * 2);
    assert.equal(order.totalCents, cartBefore.totalCents);
    for (const row of order.items) {
      assert.equal(row.lineTotalCents, row.unitPriceCents * row.quantity);
      for (const key of Object.keys(row).filter(isMoneyKey)) {
        assert.ok(/Cents$/.test(key), `订单行金额字段必须以 Cents 结尾：${key}`);
      }
    }
    for (const key of Object.keys(order).filter(isMoneyKey)) {
      assert.ok(/Cents$/.test(key), `订单金额字段必须以 Cents 结尾（接口层不得返回元）：${key}`);
    }
  });
});

test('空车下单拒绝（AC-22）', async () => {
  await withApp(undefined, async (app) => {
    const client = newClient(app);
    assert.equal((await getCart(client)).cart.items.length, 0);
    const res = await client.post('/api/v1/orders');
    assert.equal(res.status, 409);
    assert.equal(res.json.code, 'CART_EMPTY');
    assert.ok(
      res.json.message.includes('购物车是空的'),
      `message 必须含中文提示关键字，实际：${res.json.message}`,
    );
    assert.equal((await getOrders(client)).orders.length, 0);
  });
});

test('下单后清空车（AC-23）', async () => {
  await withApp(undefined, async (app) => {
    const client = newClient(app);
    const items = await seedItems(app);
    const target = items[0];
    const quantity = 2;
    const stockBefore = data(await client.get(`/api/v1/products/${target.id}`)).stock;
    assert.equal((await addItem(client, target.id, quantity)).status, 201);
    assert.equal((await client.post('/api/v1/orders')).status, 201);

    const cart = (await getCart(client)).cart;
    assert.equal(cart.items.length, 0);
    assert.equal(cart.quantityTotal, 0);
    assert.equal(cart.totalCents, 0);

    const again = await client.post('/api/v1/orders');
    assert.equal(again.status, 409);
    assert.equal(again.json.code, 'CART_EMPTY');
    const stockAfter = data(await client.get(`/api/v1/products/${target.id}`)).stock;
    assert.equal(stockAfter, stockBefore - quantity, '库存只允许扣一次');
  });
});

test('订单列表可读（AC-24）', async () => {
  await withApp(undefined, async (app) => {
    const client = newClient(app);
    const items = await seedItems(app);
    assert.equal((await addItem(client, items[0].id, 1)).status, 201);
    const first = data(await client.post('/api/v1/orders'));
    assert.equal((await addItem(client, items[1].id, 2)).status, 201);
    const second = data(await client.post('/api/v1/orders'));
    assert.notEqual(first.orderNo, second.orderNo);

    const { res, orders } = await getOrders(client);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(orders));
    assert.equal(orders.length, 2);
    assert.equal(orders[0].orderNo, second.orderNo, '最近一单必须排在最上面');
    for (const order of orders) {
      for (const field of ['orderNo', 'status', 'totalCents', 'itemCount', 'createdAt']) {
        assert.notEqual(order[field], undefined, `订单缺少字段 ${field}`);
      }
      assert.equal(order.status, 'paid');
      assert.equal(Number.isInteger(order.totalCents), true);
      assert.equal(Number.isInteger(order.itemCount), true);
      assert.equal(Number.isNaN(Date.parse(order.createdAt)), false);
    }
  });
});

test('订单号唯一（AC-25）', async () => {
  // 连续 20 次下单需要 20 件以上库存；默认种子每件只有 8 件，故注入足量库存的独立种子。
  await withApp({ seed: makeSeed(1, { stock: 40 }) }, async (app) => {
    const client = newClient(app);
    const target = (await seedItems(app))[0];
    const numbers = [];
    for (let i = 0; i < 20; i += 1) {
      assert.equal((await addItem(client, target.id, 1)).status, 201, `第 ${i + 1} 轮加购应成功`);
      const res = await client.post('/api/v1/orders');
      assert.equal(res.status, 201, `第 ${i + 1} 轮下单应成功`);
      numbers.push(data(res).orderNo);
    }
    assert.equal(numbers.length, 20, '最小样本量 20');
    assert.notEqual(numbers[0], numbers[1]);
    assert.equal(new Set(numbers).size, 20, `20 个订单号必须两两互不相同：${numbers.join(', ')}`);
    for (const orderNo of numbers) {
      assert.equal(typeof orderNo, 'string');
      assert.notEqual(orderNo.trim(), '');
    }
  });
});

test('订单列表同端口（AC-26）', async () => {
  await withApp(undefined, async (app) => {
    const client = newClient(app);
    const products = await client.get('/api/v1/products');
    const orders = await client.get('/api/v1/orders');
    assert.equal(products.status, 200);
    assert.equal(orders.status, 200);
    for (const res of [products, orders]) {
      assert.ok(
        String(res.headers['content-type']).includes('application/json'),
        `content-type 必须含 application/json，实际：${res.headers['content-type']}`,
      );
      // 两者都必须由同一个实例端口应答：出现第二个端口就会在这里对不上。
      assert.equal(res.remotePort, app.port);
    }
    assert.equal(products.remotePort, orders.remotePort);
  });
});

test('库存临界清零（E-07）', async () => {
  await withApp({ seed: makeSeed(1, { stock: 1 }) }, async (app) => {
    const client = newClient(app);
    const target = (await seedItems(app))[0];
    assert.equal((await addItem(client, target.id, 1)).status, 201);
    assert.equal((await client.post('/api/v1/orders')).status, 201);
    assert.equal(data(await client.get(`/api/v1/products/${target.id}`)).stock, 0);
    const res = await addItem(client, target.id, 1);
    assert.equal(res.status, 409);
    assert.equal(res.json.code, 'OUT_OF_STOCK');
  });
});

test('并发抢最后一件（E-08）', async () => {
  await withApp({ seed: makeSeed(1, { stock: 1 }) }, async (app) => {
    const target = (await seedItems(app))[0];
    const a = newClient(app);
    const b = newClient(app);
    assert.equal((await addItem(a, target.id, 1)).status, 201);
    assert.equal((await addItem(b, target.id, 1)).status, 201);
    const [ra, rb] = await Promise.all([a.post('/api/v1/orders'), b.post('/api/v1/orders')]);
    assert.deepEqual([ra.status, rb.status].sort(), [201, 409], '必须恰好一单成功、一单被拒');
    const loser = ra.status === 409 ? ra : rb;
    assert.equal(loser.json.code, 'INSUFFICIENT_STOCK');
    assert.equal(data(await a.get(`/api/v1/products/${target.id}`)).stock, 0, '库存不得为负');
    const totalOrders = (await getOrders(a)).orders.length + (await getOrders(b)).orders.length;
    assert.equal(totalOrders, 1, '成功订单数必须恰好为 1');
  });
});

test('重复提交下单（E-10）', async () => {
  await withApp(undefined, async (app) => {
    const client = newClient(app);
    const target = (await seedItems(app))[0];
    assert.equal((await addItem(client, target.id, 1)).status, 201);
    assert.equal((await client.post('/api/v1/orders')).status, 201);
    assert.equal((await getOrders(client)).orders.length, 1);
    const second = await client.post('/api/v1/orders');
    assert.equal(second.status, 409);
    assert.equal(second.json.code, 'CART_EMPTY');
    assert.equal((await getOrders(client)).orders.length, 1, '订单数净增必须为 1');
  });
});

test('无界面直连可用（E-12）', async () => {
  await withApp(undefined, async (app) => {
    const client = newClient(app);
    // 全程只用 HTTP：五个功能面一个不落，不存在「只有点界面才能触发」的动作。
    const { items: products } = await listProducts(client);
    const target = findByName(products, products[0].name);
    assert.equal((await client.get(`/api/v1/products/${target.id}`)).status, 200);
    assert.equal((await addItem(client, target.id, 1)).status, 201);
    assert.equal((await client.patch(`/api/v1/cart/items/${target.id}`, { quantity: 2 })).status, 200);
    assert.equal((await client.get('/api/v1/cart')).status, 200);
    assert.equal((await client.del(`/api/v1/cart/items/${target.id}`)).status, 200);
    assert.equal((await addItem(client, target.id, 1)).status, 201);
    assert.equal((await client.post('/api/v1/orders')).status, 201);
    const orders = await client.get('/api/v1/orders');
    assert.equal(orders.status, 200);
    assert.equal(data(orders).length, 1);
  });
});
