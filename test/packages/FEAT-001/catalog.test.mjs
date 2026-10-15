/**
 * 商品列表 / 商品详情：字段、顺序、只读性，以及默认种子与注入种子的条数口径。
 *
 * @prd FEAT-001
 * @prdVersion 2
 * @priority P0
 * @status active
 * @case TC-FEAT-001-01
 * @case TC-FEAT-001-02
 * @case TC-FEAT-001-03
 * @case TC-FEAT-001-04
 * @case TC-FEAT-001-05
 * @case TC-FEAT-001-06
 * @case TC-FEAT-001-28
 * @case TC-FEAT-001-E01
 * @case TC-FEAT-001-E03
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  data,
  findByName,
  isPositiveInt,
  listProducts,
  makeSeed,
  newClient,
  withApp,
} from './helpers/app.mjs';

const shape = (items) => items.map(({ name, priceCents, stock }) => ({ name, priceCents, stock }));

test('列表展示八件商品（AC-01）', async () => {
  await withApp(undefined, async (app) => {
    const client = newClient(app);
    const res = await client.get('/api/v1/products');
    assert.equal(res.status, 200);
    const items = data(res);
    assert.ok(Array.isArray(items), 'data 必须是数组');
    assert.equal(items.length, 8, '默认种子必须恰好 8 件');
    for (const item of items) {
      assert.equal(typeof item.name, 'string');
      assert.notEqual(item.name.trim(), '', '商品名不得为空');
      assert.equal(Number.isInteger(item.priceCents), true, `价格分必须是整数：${item.name}`);
      assert.ok(item.priceCents > 0, `价格分必须为正：${item.name}`);
    }
    const names = items.map((item) => item.name);
    assert.equal(new Set(names).size, names.length, '商品名必须唯一，否则按名称无法唯一定位');
  });
});

test('列表字段齐全（AC-02）', async () => {
  await withApp(undefined, async (app) => {
    const { res, items } = await listProducts(newClient(app));
    assert.equal(res.status, 200);
    for (const item of items) {
      for (const field of ['id', 'name', 'description', 'priceCents', 'stock']) {
        assert.notEqual(item[field], undefined, `${item.name} 缺少字段 ${field}`);
      }
      assert.equal(typeof item.description, 'string');
      assert.notEqual(item.description, '', '描述必须是非空字符串');
      assert.equal(isPositiveInt(item.stock), true, `库存必须是正整数：${item.name}`);
    }
  });
});

test('列表名称有序（AC-03）', async () => {
  await withApp(undefined, async (app) => {
    const client = newClient(app);
    const namesOf = (result) => result.items.map((item) => item.name);
    const first = await listProducts(client);
    const second = await listProducts(client);
    assert.equal(namesOf(first).length, 8);
    // 「与内置种子给定顺序一致」这一半在 HTTP 面上不可观测（种子定义不在响应里），
    // 故只断言可观测的那一半：同一服务连续两次返回的顺序逐位一致。
    assert.deepEqual(namesOf(second), namesOf(first));
  });
});

test('列表只读不可改（AC-04）', async () => {
  await withApp(undefined, async (app) => {
    const client = newClient(app);
    const first = (await listProducts(client)).items;
    const second = (await listProducts(client)).items;
    assert.deepEqual(shape(second), shape(first), '两次只读请求之间不得有差异');
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const res = await client.send(method, '/api/v1/products');
      assert.ok(res.status < 500, `${method} /api/v1/products 不得 5xx，实际 ${res.status}`);
    }
    const third = (await listProducts(client)).items;
    assert.deepEqual(shape(third), shape(first), '写方法不得改变商品集合或取值');
  });
});

test('库存字段可见（AC-05）', async () => {
  await withApp(undefined, async (app) => {
    const client = newClient(app);
    const { items } = await listProducts(client);
    const listed = findByName(items, items[0].name);
    assert.equal(isPositiveInt(listed.stock), true);
    const res = await client.get(`/api/v1/products/${listed.id}`);
    assert.equal(res.status, 200);
    const detail = data(res);
    assert.equal(isPositiveInt(detail.stock), true, '详情库存也必须是正整数');
    assert.equal(detail.stock, listed.stock, '同一商品的库存两处必须相等');
  });
});

test('详情与列表一致（AC-06）', async () => {
  await withApp(undefined, async (app) => {
    const client = newClient(app);
    const { items } = await listProducts(client);
    const listed = findByName(items, items[1].name);
    const res = await client.get(`/api/v1/products/${listed.id}`);
    assert.equal(res.status, 200);
    const detail = data(res);
    assert.equal(detail.name, listed.name);
    assert.equal(detail.priceCents, listed.priceCents);
    assert.equal(detail.stock, listed.stock);
  });
});

test('种子商品可读（AC-28）', async () => {
  await withApp(undefined, async (app) => {
    const { res, items } = await listProducts(newClient(app));
    assert.equal(res.status, 200);
    assert.equal(items.length, 8);
    items.forEach((item, index) => {
      assert.notEqual(item.name.trim(), '', `第 ${index} 条名称不得为空`);
      assert.equal(Number.isInteger(item.priceCents) && item.priceCents > 0, true);
      assert.equal(Number.isInteger(item.stock) && item.stock > 0, true);
    });
  });
});

test('默认种子八条（E-01）', async () => {
  await withApp(undefined, async (app) => {
    const { res, items } = await listProducts(newClient(app));
    assert.equal(res.status, 200);
    assert.equal(items.length, 8, '不注入种子时默认种子恰为 8 条');
  });
});

test('默认种子八条（E-01）· 注入任意条数都不得抛错', async () => {
  for (const count of [0, 7, 8, 9, 10]) {
    await withApp({ seed: makeSeed(count) }, async (app) => {
      const { res, items } = await listProducts(newClient(app), { allowEmpty: true });
      assert.equal(res.status, 200, `注入 ${count} 条时列表必须 200`);
      assert.equal(items.length, count, `列表长度必须等于注入条数 ${count}`);
    });
  }
});

test('不存在商品详情（E-03）', async () => {
  await withApp(undefined, async (app) => {
    const client = newClient(app);
    // 正对照：存在的商品必须读得出来 —— 否则「对一切都回 404」的实现也能骗过本条。
    const { items } = await listProducts(client);
    const existing = items[0];
    const positive = await client.get(`/api/v1/products/${existing.id}`);
    assert.equal(positive.status, 200, '正对照：存在的商品详情必须 200');
    assert.equal(data(positive).name, existing.name, '正对照：详情必须指向同一件商品');

    const res = await client.get('/api/v1/products/no-such-product-id');
    assert.equal(res.status, 404);
    assert.equal(res.json.code, 'NOT_FOUND');
    assert.equal(typeof res.json.message, 'string');
    assert.ok(res.json.message.includes('找不到该商品'), `message 实际为：${res.json.message}`);
  });
});
