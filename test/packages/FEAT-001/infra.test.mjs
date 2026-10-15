/**
 * 装置自检（锁定项）：这些用例不依赖被测源码，实现尚未落盘时即应为绿。
 * 它们回答的是「红是不是装置坏了」——若本文件变红，先修装置再谈缺口。
 *
 * @prd FEAT-001
 * @prdVersion 2
 * @priority P0
 * @status active
 * @case TC-FEAT-001-I01
 * @case TC-FEAT-001-I02
 * @case TC-FEAT-001-I03
 * @case TC-FEAT-001-I04
 * @case TC-FEAT-001-I05
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { JSDOM } from 'jsdom';
import { data, findByName, makeSeed, newClient } from './helpers/app.mjs';

test('node:test 与 node:assert 可用（装置自检 I01）', () => {
  assert.equal(1 + 1, 2);
  assert.deepEqual([1, 2, 3].map((n) => n * 2), [2, 4, 6]);
  // 断言必须真的能失败：把失败路径也跑一次，否则「全绿」可能只是装置不会红。
  assert.throws(() => assert.equal(1, 2), assert.AssertionError);
});

test('jsdom 能解析 HTML 并支持属性选择器（装置自检 I02）', () => {
  // 正反两向都放进来：能数到 1 个，也要能数到 0 个 —— 否则「数到 0」分不清是「没有」还是「选择器写错」。
  const dom = new JSDOM(
    '<!doctype html><html><body><h1>商品列表</h1><p data-product-name="甲">甲</p>' +
      '<img src="/x.png"><script type="module" src="/src/main.mjs"></script></body></html>',
  );
  const { document } = dom.window;
  assert.equal(document.querySelector('h1').textContent, '商品列表');
  assert.equal(document.querySelectorAll('[data-product-name]').length, 1);
  assert.equal(document.querySelectorAll('script[type="module"]').length, 1);
  assert.equal(document.querySelectorAll('img').length, 1);
  assert.equal(document.querySelectorAll('[data-nothing-here]').length, 0);
});

test('node:http 能在 listen(0) 的随机端口上应答，且不占 3000（装置自检 I03）', async () => {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('pong');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    assert.notEqual(port, 3000);
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'pong');
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
});

test('断言装置可失败（元负控 I04）', () => {
  // 合成夹具 + 内存变异：同一个谓词对「合规 8 条」必须绿、对「变异成 7 条」必须红。
  // 只断言合成数据，不断言被测实现的当前取值 —— 否则修好实现反而会把本条判红。
  const good = { data: makeSeed(8) };
  const mutated = { data: makeSeed(7) };
  const requireEight = (payload) => {
    assert.equal(payload.data.length, 8, '默认商品数必须是 8');
    return true;
  };
  assert.equal(requireEight(good), true);
  assert.throws(() => requireEight(mutated), assert.AssertionError);

  // 按名称定位的谓词同样必须有失败路径（否则「定位不到」会被静默当成通过）。
  assert.equal(findByName(good.data, '注入商品 03').name, '注入商品 03');
  assert.throws(() => findByName(mutated.data, '注入商品 99'), /定位不到目标/);
});

test('HTTP 取样装置可用（裸服务 I05）', async () => {
  // 拿一个裸 http 服务当被测对象：证明状态码 / JSON / data 包裹 / cookie jar / 端口归属
  // 这几件装置能力本身是好的 —— 需求用例全红时，红的才不是它们。
  const seenCookie = [];
  const server = createServer((req, res) => {
    seenCookie.push(req.headers.cookie ?? null);
    res.writeHead(200, {
      'content-type': 'application/json',
      'set-cookie': 'cartId=probe-1; HttpOnly',
    });
    res.end(JSON.stringify({ data: { echo: req.url } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  assert.notEqual(port, 3000);
  try {
    const client = newClient({ port });
    const first = await client.get('/api/v1/cart');
    assert.equal(first.status, 200);
    assert.equal(first.remotePort, port, '取样必须落在被指向的那个端口上');
    assert.deepEqual(first.json, { data: { echo: '/api/v1/cart' } });
    assert.equal(data(first).echo, '/api/v1/cart', 'data 包裹必须可解析');
    assert.ok(String(first.headers['set-cookie']).includes('HttpOnly'));
    assert.equal(client.cookie, 'cartId=probe-1', 'cookie jar 必须收下 Set-Cookie');
    const second = await client.get('/api/v1/orders');
    assert.equal(data(second).echo, '/api/v1/orders');
    assert.deepEqual(seenCookie, [null, 'cartId=probe-1'], '第二次请求必须回带 cartId');
  } finally {
    if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
    await new Promise((resolve) => server.close(() => resolve()));
  }
});
