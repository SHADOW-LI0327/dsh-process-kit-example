/**
 * 装置自检（锁定项）：不依赖被测源码，实现尚未落盘时即应为绿。
 * 它们回答「红是不是装置坏了」——本文件一旦变红，先修装置再谈缺口。
 *
 * 固化的四条装置事实（都实测过，写错会制造假红/假绿）：
 *  ① 断言必须真的能失败（元负控）——否则「全绿」可能只是装置不会红；
 *  ② jsdom 的阳性/阴性双向计数都要能分辨；
 *  ③ `node:sqlite` 行对象是 null 原型 ⇒ 断言前必须展开，且模块级 `backup()` 可用；
 *  ④ 子进程退出码必须不经管道直接读（管道会把 7 读成 0）。
 *
 * @prd FEAT-002
 * @prdVersion 2
 * @priority P0
 * @status active
 * @case TC-FEAT-002-I01
 * @case TC-FEAT-002-I02
 * @case TC-FEAT-002-I03
 * @case TC-FEAT-002-I04
 * @case TC-FEAT-002-I05
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { backup } from 'node:sqlite';
import { JSDOM } from 'jsdom';
import { freePort, isPortFree, openDb, startServerProcess, withTempDb } from './helpers/harness.mjs';

test('装置自检：断言装置可失败（元负控 I01）', () => {
  assert.equal(1 + 1, 2);
  assert.deepEqual([1, 2, 3].map((n) => n * 2), [2, 4, 6]);
  // 失败路径必须真的走一次：同一个谓词对「对」绿、对「错」红，才证明装置会红。
  assert.throws(() => assert.equal(1, 2), assert.AssertionError);
  assert.throws(() => assert.equal('a', 'b'), assert.AssertionError);
  let caught = null;
  try {
    assert.equal({ a: 1 }, { a: 2 });
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof assert.AssertionError, '深比较不等必须抛 AssertionError');
});

test('装置自检：jsdom 能解析 HTML 且阴阳双向可分辨（I02）', () => {
  const dom = new JSDOM(
    '<!doctype html><html><body><nav data-tab="home">首页</nav>' +
      '<img src="/assets/products/P-001.jpg" alt="种子商品1">' +
      '<script type="module" src="/src/main.mjs"></script></body></html>',
  );
  const { document } = dom.window;
  assert.equal(document.querySelectorAll('[data-tab]').length, 1);
  assert.equal(document.querySelectorAll('img[src^="/assets/products/"]').length, 1);
  assert.equal(document.querySelectorAll('script[type="module"][src]').length, 1);
  // 阴性方向：选择器写错时要能数到 0，否则「数到 0」不可信。
  assert.equal(document.querySelectorAll('[data-tab-missing]').length, 0);
  assert.equal(document.querySelectorAll('img[src^="http"]').length, 0);
});

test('装置自检：node:sqlite 临时库可读写、行对象须展开、backup 可用（I03）', async () => {
  await withTempDb(async ({ dbPath, path }) => {
    const db = openDb(dbPath);
    try {
      db.exec('PRAGMA journal_mode = WAL');
      db.exec('CREATE TABLE probe (name TEXT PRIMARY KEY, qty INTEGER NOT NULL)');
      const run = db.prepare('INSERT INTO probe (name, qty) VALUES (?, ?)').run('甲', 3);
      assert.equal(run.changes, 1, 'run().changes 必须是防超卖判据（够量 = 1）');
      const miss = db.prepare('UPDATE probe SET qty = qty - ? WHERE name = ? AND qty >= ?').run(5, '甲', 5);
      assert.equal(miss.changes, 0, '不够量必须是 changes === 0（不是抛异常）');
      const row = db.prepare('SELECT name, qty FROM probe').get();
      assert.equal(Object.getPrototypeOf(row), null, '装置事实：行对象是 null 原型');
      assert.deepStrictEqual({ ...row }, { name: '甲', qty: 3 }, '断言前必须展开行对象');
      // PRAGMA 的 get() 陷阱：foreign_keys=ON 不返回行，校验要另取。
      db.exec('PRAGMA foreign_keys = ON');
      const fk = db.prepare('PRAGMA foreign_keys').get();
      assert.equal({ ...fk }.foreign_keys, 1);
    } finally {
      db.close();
    }
    const dest = path('snapshot.db');
    const src = openDb(dbPath);
    try {
      await backup(src, dest);
    } finally {
      src.close();
    }
    const snap = openDb(dest);
    try {
      assert.deepStrictEqual({ ...snap.prepare('SELECT name, qty FROM probe').get() }, { name: '甲', qty: 3 });
    } finally {
      snap.close();
    }
  }, 'feat002-infra');
});

test('装置自检：子进程退出码不经管道可读且能分辨 0 与 7（I04）', async () => {
  const ok = startServerProcess({}, { args: ['-e', 'process.exit(0)'] });
  assert.deepStrictEqual(await ok.exited, { code: 0, signal: null });

  const bad = startServerProcess({}, { args: ['-e', 'process.exit(7)'] });
  const result = await bad.exited;
  assert.equal(result.code, 7, '退出码必须原样读到 7（管道写法会读成 0）');
  await ok.stop('SIGKILL', 1000);
  await bad.stop('SIGKILL', 1000);
});

test('装置自检：随机端口不落在常驻 3000（I05）', async () => {
  const port = await freePort();
  assert.notEqual(port, 3000, '取样端口不得是常驻 3000');
  assert.equal(await isPortFree(port), true, '刚释放的端口应可复用');
});
