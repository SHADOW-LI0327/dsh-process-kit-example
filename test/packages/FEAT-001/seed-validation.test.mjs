/**
 * 注入种子的字段合法性：非法字段必须在构造期就同步抛错，不得启动半残实例。
 *
 * @prd FEAT-001
 * @prdVersion 2
 * @priority P0
 * @status active
 * @case TC-FEAT-001-E14
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCreateApp, makeSeed } from './helpers/app.mjs';

/** 捕获同步抛错；返回 Promise 时顺手吞掉拒绝，避免污染进程级未处理拒绝。 */
function captureSync(fn) {
  try {
    const value = fn();
    if (value && typeof value.then === 'function') value.catch(() => {});
    return { threw: false, value };
  } catch (err) {
    return { threw: true, err };
  }
}

test('种子字段非法（E-14）', async () => {
  const createApp = await loadCreateApp();
  const [template] = makeSeed(1, { stock: 3 });

  // 对照组：与负分支完全同形状，只把字段换回合法值 ⇒ 必须创建成功。
  const control = captureSync(() => createApp({ seed: [template] }));
  assert.equal(
    control.threw,
    false,
    `字段合法的种子必须能创建实例，实际抛错：${control.err && control.err.message}`,
  );

  const illegal = [
    { label: '价格非整数分', field: 'priceCents', mutate: (p) => ({ ...p, priceCents: 10.5 }) },
    { label: '价格为零', field: 'priceCents', mutate: (p) => ({ ...p, priceCents: 0 }) },
    { label: '价格为负', field: 'priceCents', mutate: (p) => ({ ...p, priceCents: -1 }) },
    { label: '库存为负', field: 'stock', mutate: (p) => ({ ...p, stock: -1 }) },
    { label: '名称为空', field: 'name', mutate: (p) => ({ ...p, name: '' }) },
    { label: 'id 为空', field: 'id', mutate: (p) => ({ ...p, id: '' }) },
  ];

  for (const variant of illegal) {
    const seed = [variant.mutate(template)];
    const attempt = captureSync(() => createApp({ seed }));
    assert.equal(
      attempt.threw,
      true,
      `种子字段非法（${variant.label}）必须同步抛错，实际返回了实例：${JSON.stringify(seed)}`,
    );
    const err = attempt.err;
    const namesField =
      err instanceof TypeError || String(err && err.message).includes(variant.field);
    assert.ok(
      namesField,
      `抛出的错误必须点名字段 ${variant.field}，实际：${err && err.name}: ${err && err.message}`,
    );
  }
});
