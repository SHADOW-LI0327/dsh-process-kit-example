/**
 * 购物车：增 / 改 / 删 / 查，件数与行数两道量程，以及库存与原子性。
 *
 * @prd FEAT-001
 * @prdVersion 2
 * @priority P0
 * @status active
 * @case TC-FEAT-001-07
 * @case TC-FEAT-001-08
 * @case TC-FEAT-001-09
 * @case TC-FEAT-001-10
 * @case TC-FEAT-001-11
 * @case TC-FEAT-001-12
 * @case TC-FEAT-001-13
 * @case TC-FEAT-001-14
 * @case TC-FEAT-001-15
 * @case TC-FEAT-001-16
 * @case TC-FEAT-001-17
 * @case TC-FEAT-001-E02
 * @case TC-FEAT-001-E04
 * @case TC-FEAT-001-E05
 * @case TC-FEAT-001-E06
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  data,
  findBy,
  getCart,
  listProducts,
  makeSeed,
  newClient,
  sumBy,
  withApp,
} from './helpers/app.mjs';

const rows = (cart) => cart.items.map((i) => ({ name: i.productName, qty: i.quantity, line: i.lineTotalCents }));
const hasName = (cart, name) => cart.items.some((i) => i.productName === name);

async function seedNames(app) {
  const { items } = await listProducts(newClient(app));
  return items;
}

async function addItem(client, productId, quantity) {
  return client.post('/api/v1/cart/items', { productId, quantity });
}

test('详情价与总额相符（AC-07）', async () => {
  await withApp(undefined, async (app) => {
    const client = newClient(app);
    const items = await seedNames(app);
    const target = items[0];
    const detail = data(await client.get(`/api/v1/products/${target.id}`));
    const unitPrice = detail.priceCents;
    const quantity = 3;
    assert.equal((await addItem(client, target.id, quantity)).status, 201);
    const { cart } = await getCart(client);
    const row = findBy(cart.items, 'productName', target.name);
    assert.equal(row.unitPriceCents, unitPrice);
    assert.equal(Number.isInteger(row.lineTotalCents), true, '行小计必须是整数分');
    // 严格整数相等：任何 Math.round / 转元再乘除都会在这里露出来。
    assert.equal(row.lineTotalCents, unitPrice * quantity);
  });
});

test('首访下发购物车（AC-08）', async () => {
  await withApp(undefined, async (app) => {
    const client = newClient(app);
    assert.equal(client.cookie, '', '前置：全新客户端不得自带 cookie');
    const res = await client.get('/api/v1/cart');
    assert.equal(res.status, 200);
    const setCookie = res.headers['set-cookie'];
    assert.ok(setCookie, '首访必须下发 Set-Cookie');
    const lines = Array.isArray(setCookie) ? setCookie : [setCookie];
    const cartLine = lines.find((line) => /(?:^|;\s*)cartId=/.test(line));
    assert.ok(cartLine, `Set-Cookie 必须含 cartId，实际：${lines.join(' | ')}`);
    assert.ok(/HttpOnly/i.test(cartLine), `cartId 必须带 HttpOnly，实际：${cartLine}`);
    const cart = data(res);
    assert.ok(Array.isArray(cart.items));
    assert.equal(cart.items.length, 0);
    assert.equal(cart.totalCents, 0);
    assert.equal(cart.quantityTotal, 0);
    assert.ok(client.cookie.startsWith('cartId='), '客户端必须能回带该 cookie');
  });
});

test('购物车结构完整（AC-09）', async () => {
  await withApp(undefined, async (app) => {
    const client = newClient(app);
    const items = await seedNames(app);
    assert.equal((await addItem(client, items[0].id, 2)).status, 201);
    assert.equal((await addItem(client, items[1].id, 3)).status, 201);
    const { cart } = await getCart(client);
    assert.equal(cart.items.length, 2);
    for (const row of cart.items) {
      for (const field of ['productName', 'unitPriceCents', 'quantity', 'lineTotalCents']) {
        assert.notEqual(row[field], undefined, `购物车行缺少字段 ${field}`);
      }
      assert.notEqual(row.productId, undefined, '购物车行必须带内部引用键');
      assert.equal(Number.isInteger(row.quantity), true);
      assert.equal(Number.isInteger(row.unitPriceCents), true);
      assert.equal(Number.isInteger(row.lineTotalCents), true);
    }
    assert.equal(cart.quantityTotal, sumBy(cart.items, 'quantity'));
    assert.equal(cart.totalCents, sumBy(cart.items, 'lineTotalCents'));
    assert.equal(Number.isInteger(cart.quantityTotal), true);
    assert.equal(Number.isInteger(cart.totalCents), true);
  });
});

test('加购单件成功（AC-10）', async () => {
  await withApp(undefined, async (app) => {
    const client = newClient(app);
    const items = await seedNames(app);
    const target = items[0];
    const res = await addItem(client, target.id, 1);
    assert.equal(res.status, 201);
    const { cart } = await getCart(client);
    assert.equal(cart.items.length, 1);
    const row = findBy(cart.items, 'productName', target.name);
    assert.equal(row.quantity, 1);
    assert.equal(row.lineTotalCents, row.unitPriceCents);
  });
});

test('重复加购累加（AC-11）', async () => {
  await withApp(undefined, async (app) => {
    const client = newClient(app);
    const items = await seedNames(app);
    const target = items[0];
    assert.equal((await addItem(client, target.id, 2)).status, 201);
    assert.equal((await addItem(client, target.id, 1)).status, 201);
    const { cart } = await getCart(client);
    assert.equal(cart.items.length, 1, '同一商品必须合并为一行');
    const row = findBy(cart.items, 'productName', target.name);
    assert.equal(row.quantity, 3);
    assert.equal(row.lineTotalCents, row.unitPriceCents * 3);
  });
});

test('非整数件数拒绝（AC-12）', async () => {
  await withApp(undefined, async (app) => {
    const client = newClient(app);
    const items = await seedNames(app);
    const target = items[0];
    assert.equal((await addItem(client, target.id, 1)).status, 201);
    const before = (await getCart(client)).cart;
    const totalBefore = before.totalCents;
    for (const quantity of [1.5, '2']) {
      const res = await client.post('/api/v1/cart/items', { productId: target.id, quantity });
      assert.equal(res.status, 400, `quantity=${JSON.stringify(quantity)} 必须 400`);
      assert.equal(res.json.code, 'INVALID_QUANTITY');
    }
    const after = (await getCart(client)).cart;
    assert.equal(after.totalCents, totalBefore);
    assert.deepEqual(rows(after), rows(before), '被拒请求不得改变任何一行');
  });
});

test('件数上下限拒绝（AC-13）', async () => {
  await withApp(undefined, async (app) => {
    const client = newClient(app);
    const items = await seedNames(app);
    // 每次尝试换一件商品：把「件数量程」与「同一行累加上限」两件事隔离开，
    // 否则 8 + 1 会先撞上累加规则，落不到本条的判据上。
    const attempts = [
      { quantity: 8, accepted: true },
      { quantity: 1, accepted: true },
      { quantity: 5, accepted: true },
      { quantity: 0, accepted: false },
      { quantity: -1, accepted: false },
      { quantity: 9, accepted: false },
    ];
    for (const [index, attempt] of attempts.entries()) {
      const target = items[index];
      const snapshot = (await getCart(client)).cart;
      const res = await addItem(client, target.id, attempt.quantity);
      if (attempt.accepted) {
        assert.equal(res.status, 201, `quantity=${attempt.quantity} 应被接受`);
        const cart = data(res);
        const row = findBy(cart.items, 'productName', target.name);
        assert.equal(row.quantity, attempt.quantity);
        assert.equal(row.lineTotalCents, row.unitPriceCents * attempt.quantity);
      } else {
        assert.equal(res.status, 400, `quantity=${attempt.quantity} 应被拒绝`);
        assert.equal(res.json.code, 'INVALID_QUANTITY');
        const after = (await getCart(client)).cart;
        assert.deepEqual(rows(after), rows(snapshot), '被拒请求不得改变任何一行');
        assert.equal(after.totalCents, snapshot.totalCents);
      }
    }
  });
});

test('单品上限拒绝（AC-14）', async () => {
  await withApp(undefined, async (app) => {
    const client = newClient(app);
    const items = await seedNames(app);
    const target = items[0];
    assert.equal((await addItem(client, target.id, 8)).status, 201);
    const res = await addItem(client, target.id, 1);
    assert.equal(res.status, 409);
    assert.equal(res.json.code, 'QUANTITY_LIMIT_EXCEEDED');
    assert.ok(
      res.json.message.includes('单件商品最多买 8 件'),
      `message 必须含契约关键字，实际：${res.json.message}`,
    );
    const { cart } = await getCart(client);
    assert.equal(cart.items.length, 1);
    assert.equal(findBy(cart.items, 'productName', target.name).quantity, 8, '被拒后原行不得部分写入');
  });
});

test('加购无货拒绝（AC-15）', async () => {
  // 库存下端点只能靠注入独立种子构造：默认种子每件都有货。
  await withApp({ seed: makeSeed(1, { stock: 0 }) }, async (app) => {
    const client = newClient(app);
    const items = await seedNames(app);
    const target = items[0];
    assert.equal(target.stock, 0, '前置：注入的这件商品库存必须为 0（且该注入不得触发字段校验）');
    const res = await addItem(client, target.id, 1);
    assert.equal(res.status, 409);
    assert.equal(res.json.code, 'OUT_OF_STOCK');
    assert.ok(
      res.json.message.includes('该商品暂时缺货'),
      `message 必须含契约关键字，实际：${res.json.message}`,
    );
    const { cart } = await getCart(client);
    assert.equal(cart.items.length, 0, '被拒后购物车必须仍为空');
    assert.equal(cart.totalCents, 0);
  });
});

test('购物车行数上限（AC-16）', async () => {
  // 默认种子只有 8 件商品 ⇒ 第 9 行天然不可达，必须注入 ≥9 条的独立种子。
  await withApp({ seed: makeSeed(10, { stock: 5 }) }, async (app) => {
    const client = newClient(app);
    const items = await seedNames(app);
    assert.equal(items.length, 10);
    for (const item of items.slice(0, 8)) {
      assert.equal((await addItem(client, item.id, 1)).status, 201, `${item.name} 应可加入`);
    }
    const ninth = items[8];
    const res = await addItem(client, ninth.id, 1);
    assert.equal(res.status, 409);
    assert.equal(res.json.code, 'CART_FULL');
    assert.ok(
      res.json.message.includes('购物车最多放 8 种商品'),
      `message 必须含契约关键字，实际：${res.json.message}`,
    );
    const { cart } = await getCart(client);
    assert.equal(cart.items.length, 8);
    assert.equal(cart.quantityTotal, 8);
    assert.equal(hasName(cart, ninth.name), false, '第 9 种商品不得进车');
    assert.equal(new Set(cart.items.map((i) => i.productName)).size, 8);
  });
});

test('购物车改与删（AC-17）', async () => {
  await withApp(undefined, async (app) => {
    const client = newClient(app);
    const items = await seedNames(app);
    const [first, second] = items;
    assert.equal((await addItem(client, first.id, 1)).status, 201);
    assert.equal((await addItem(client, second.id, 2)).status, 201);
    const t0 = (await getCart(client)).cart.totalCents;

    const patched = await client.patch(`/api/v1/cart/items/${first.id}`, { quantity: 3 });
    assert.equal(patched.status, 200);
    const afterPatch = data(patched);
    const firstRow = findBy(afterPatch.items, 'productName', first.name);
    assert.equal(firstRow.quantity, 3);
    assert.equal(firstRow.lineTotalCents, firstRow.unitPriceCents * 3);
    assert.ok(afterPatch.totalCents > t0, '改成更多件后总额必须变大');
    const recheck = (await getCart(client)).cart;
    assert.deepEqual(rows(recheck), rows(afterPatch), '响应里的整车必须与服务端一致');

    const deleted = await client.del(`/api/v1/cart/items/${second.id}`);
    assert.equal(deleted.status, 200);
    const finalCart = (await getCart(client)).cart;
    assert.equal(finalCart.items.length, 1);
    assert.equal(hasName(finalCart, second.name), false, '被删商品必须按名称定位不到');
    assert.equal(finalCart.totalCents, finalCart.items[0].lineTotalCents);
  });
});

test('行数上限退化（E-02）· 注入 9 条后第 9 行仍可压到', async () => {
  await withApp({ seed: makeSeed(9, { stock: 5 }) }, async (app) => {
    const client = newClient(app);
    const items = await seedNames(app);
    assert.equal(items.length, 9, '注入 9 条必须被接受（否则本条边界不可构造）');
    for (const item of items.slice(0, 8)) {
      assert.equal((await addItem(client, item.id, 1)).status, 201);
    }
    const res = await addItem(client, items[8].id, 1);
    assert.equal(res.status, 409);
    assert.equal(res.json.code, 'CART_FULL');
    assert.equal((await getCart(client)).cart.items.length, 8);
  });
});

test('不存在商品加购（E-04）', async () => {
  await withApp(undefined, async (app) => {
    const client = newClient(app);
    const before = (await getCart(client)).cart;
    const res = await addItem(client, 'no-such-product-id', 1);
    assert.equal(res.status, 404);
    assert.equal(res.json.code, 'NOT_FOUND');
    assert.ok(res.json.message.includes('找不到该商品'), `实际：${res.json.message}`);
    const after = (await getCart(client)).cart;
    assert.deepEqual(rows(after), rows(before));
    assert.equal(after.totalCents, before.totalCents);
  });
});

test('改删不存在行（E-05）', async () => {
  await withApp(undefined, async (app) => {
    const client = newClient(app);
    const items = await seedNames(app);
    const inCart = items[0];
    const notInCart = items[1];
    assert.equal((await addItem(client, inCart.id, 1)).status, 201);
    const before = (await getCart(client)).cart;

    const patchMissingRow = await client.patch(`/api/v1/cart/items/${notInCart.id}`, { quantity: 2 });
    assert.equal(patchMissingRow.status, 404);
    assert.equal(patchMissingRow.json.code, 'NOT_FOUND');
    assert.ok(
      patchMissingRow.json.message.includes('购物车里没有这件商品'),
      `实际：${patchMissingRow.json.message}`,
    );
    const deleteMissingRow = await client.del(`/api/v1/cart/items/${notInCart.id}`);
    assert.equal(deleteMissingRow.status, 404);
    assert.equal(deleteMissingRow.json.code, 'NOT_FOUND');

    const patchUnknown = await client.patch('/api/v1/cart/items/no-such-product-id', { quantity: 2 });
    assert.equal(patchUnknown.status, 404);
    assert.equal(patchUnknown.json.code, 'NOT_FOUND');
    const deleteUnknown = await client.del('/api/v1/cart/items/no-such-product-id');
    assert.equal(deleteUnknown.status, 404);
    assert.equal(deleteUnknown.json.code, 'NOT_FOUND');

    const after = (await getCart(client)).cart;
    assert.deepEqual(rows(after), rows(before), '被拒请求不得改变任何一行');
    assert.equal(after.totalCents, before.totalCents);
  });
});

test('畸形 cartId（E-06）', async () => {
  await withApp(undefined, async (app) => {
    const malformed = ['cartId=%%%not-a-cart%%%', 'cartId=00000000000000000000000000000000'];
    for (const cookie of malformed) {
      const client = newClient(app);
      const res = await client.send('GET', '/api/v1/cart', { headers: { cookie }, useJar: false });
      assert.equal(res.status, 200, `${cookie} 必须按「无购物车」处置而不是报错`);
      const setCookie = res.headers['set-cookie'];
      assert.ok(setCookie, `${cookie} 必须下发新的 cartId`);
      const lines = Array.isArray(setCookie) ? setCookie : [setCookie];
      assert.ok(
        lines.some((line) => /(?:^|;\s*)cartId=[^;]/.test(line)),
        `必须下发新的 cartId，实际：${lines.join(' | ')}`,
      );
      const cart = data(res);
      assert.equal(cart.items.length, 0);
      assert.equal(cart.totalCents, 0);
    }
  });
});
