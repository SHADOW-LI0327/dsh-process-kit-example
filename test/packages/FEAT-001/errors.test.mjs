/**
 * 错误响应：统一形态、封闭错误码词表、载荷与类型校验、不泄露内部结构。
 *
 * @prd FEAT-001
 * @prdVersion 2
 * @priority P0
 * @status active
 * @case TC-FEAT-001-29
 * @case TC-FEAT-001-E11
 * @case TC-FEAT-001-E13
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INTERNAL_LEAK_PATTERNS,
  data,
  getCart,
  listProducts,
  newClient,
  withApp,
} from './helpers/app.mjs';

const CODE_WORD = /^[A-Z][A-Z0-9_]*$/;
const ALLOWED_ERROR_KEYS = ['code', 'message', 'details'];

async function seedItems(app) {
  const { items } = await listProducts(newClient(app));
  return items;
}

test('统一错误响应（AC-29）', async () => {
  await withApp(undefined, async (app) => {
    const client = newClient(app);
    const items = await seedItems(app);
    const attempts = [
      { res: await client.get('/api/v1/products/no-such-product-id'), status: 404, code: 'NOT_FOUND' },
      {
        res: await client.post('/api/v1/cart/items', { productId: items[0].id, quantity: 1.5 }),
        status: 400,
        code: 'INVALID_QUANTITY',
      },
      // 契约 §4.4：未登录访问受保护面在**鉴权步**就返 401，先于「空车」判定。
      // 「已登录 + 空车 ⇒ 409 CART_EMPTY」这条能力由 TC-FEAT-001-22 保留（不在本词表用例里重复）。
      { res: await client.post('/api/v1/orders'), status: 401, code: 'UNAUTHENTICATED' },
    ];
    for (const { res, status, code } of attempts) {
      assert.equal(res.status, status, `${code} 的状态码必须是 ${status}，实际 ${res.status}`);
      assert.ok(res.json && typeof res.json === 'object', '错误响应必须是 JSON 对象');
      assert.equal(res.json.code, code);
      assert.ok(CODE_WORD.test(res.json.code), `code 必须是大写下划线串：${res.json.code}`);
      assert.equal(typeof res.json.message, 'string');
      assert.notEqual(res.json.message.trim(), '', 'message 必须非空');
      for (const key of Object.keys(res.json)) {
        assert.ok(ALLOWED_ERROR_KEYS.includes(key), `错误响应不得出现顶层字段 ${key}`);
      }
      assert.equal('data' in res.json, false, '错误响应不得同时携带 data 包裹');
    }
    const codes = attempts.map(({ res }) => res.json.code);
    assert.equal(new Set(codes).size, 3, '三种非法请求必须是三个不同的错误码');
  });
});

test('载荷与类型非法（E-11）', async () => {
  await withApp(undefined, async (app) => {
    const client = newClient(app);
    const items = await seedItems(app);
    const productId = items[0].id;
    // 变体一律「单因子」：坏 body 与缺请求头必须分列 —— 混在一条里，其中一个因子就永久免检。
    // 两档坏 body 都显式带 application/json，确保它们的红因只可能是 body 解析，而不是请求头。
    const variants = [
      {
        label: '带 application/json 的坏 JSON body（{）',
        run: () =>
          client.send('POST', '/api/v1/cart/items', {
            rawBody: '{',
            contentType: 'application/json',
          }),
      },
      {
        label: '带 application/json 的坏 JSON body（not-json）',
        run: () =>
          client.send('POST', '/api/v1/cart/items', {
            rawBody: 'not-json',
            contentType: 'application/json',
          }),
      },
      {
        label: 'quantity 为字符串',
        run: () => client.post('/api/v1/cart/items', { productId, quantity: '2' }),
      },
      {
        label: 'quantity 为 null',
        run: () => client.post('/api/v1/cart/items', { productId, quantity: null }),
      },
      { label: '缺 quantity', run: () => client.post('/api/v1/cart/items', { productId }) },
      { label: '缺 productId', run: () => client.post('/api/v1/cart/items', { quantity: 1 }) },
      {
        label: '缺 Content-Type + 合法 JSON body',
        run: () =>
          client.send('POST', '/api/v1/cart/items', {
            rawBody: JSON.stringify({ productId, quantity: 1 }),
            contentType: null,
          }),
      },
    ];
    const before = (await getCart(client)).cart;
    for (const variant of variants) {
      const res = await variant.run();
      assert.equal(res.status, 400, `${variant.label} 必须 400，实际 ${res.status}`);
      assert.ok(
        ['INVALID_BODY', 'INVALID_QUANTITY'].includes(res.json && res.json.code),
        `${variant.label} 的错误码必须属于载荷/件数非法两类，实际 ${res.json && res.json.code}`,
      );
      assert.equal(typeof res.json.message, 'string');
      assert.notEqual(res.json.message.trim(), '');
    }
    const after = (await getCart(client)).cart;
    assert.equal(after.items.length, before.items.length, '被拒请求不得改变购物车行数');
    assert.equal(after.totalCents, before.totalCents);
  });
});

test('未知统计字段不泄露（E-13）', async () => {
  await withApp(undefined, async (app) => {
    const client = newClient(app);
    const items = await seedItems(app);
    const errors = [
      await client.get('/api/v1/products/no-such-product-id'),
      await client.post('/api/v1/cart/items', { productId: items[0].id, quantity: 999 }),
      await client.post('/api/v1/orders'),
      await client.del('/api/v1/cart/items/no-such-product-id'),
    ];
    for (const res of errors) {
      for (const pattern of INTERNAL_LEAK_PATTERNS) {
        assert.equal(
          pattern.test(res.raw),
          false,
          `错误响应体不得匹配内部泄露特征 ${pattern}：${res.raw.slice(0, 200)}`,
        );
      }
      for (const key of Object.keys(res.json)) {
        assert.ok(ALLOWED_ERROR_KEYS.includes(key), `错误响应不得暴露内部字段 ${key}`);
      }
      for (const key of ['items', 'cart', 'products', 'orders', 'productId']) {
        assert.equal(key in res.json, false, `错误响应不得回吐内部存储对象字段 ${key}`);
      }
    }

    // 「越界行为」一侧：畸形 cookie 也只能得到正常形态的响应。
    const odd = await client.send('GET', '/api/v1/cart', {
      headers: { cookie: 'cartId=%%%broken%%%' },
      useJar: false,
    });
    assert.equal(odd.status, 200);
    assert.deepEqual(Object.keys(odd.json), ['data'], '成功响应只允许 data 包裹');
    for (const pattern of INTERNAL_LEAK_PATTERNS) {
      assert.equal(pattern.test(odd.raw), false);
    }
    assert.equal(Array.isArray(data(odd).items), true);
  });
});
