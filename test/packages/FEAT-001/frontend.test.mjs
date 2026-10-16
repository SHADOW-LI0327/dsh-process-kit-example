/**
 * Web 前端：同端口可达、HTML 结构、商品锚点、原生 ESM 脚本。
 *
 * 本包主动不做脚本执行断言（零依赖 / 快 / 可重复），因此这里只压静态结构与资源可达性；
 * 交互观感与脚本执行后的界面由真机黑盒承担，不由本文件背书。
 *
 * @prd FEAT-001
 * @prdVersion 2
 * @priority P0
 * @status active
 * @case TC-FEAT-001-27
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { listProducts, newClient, withApp } from './helpers/app.mjs';

async function loadRoot(app) {
  const res = await newClient(app).get('/');
  assert.equal(res.status, 200, '根路径必须 200');
  assert.ok(
    String(res.headers['content-type']).includes('text/html'),
    `content-type 必须含 text/html，实际：${res.headers['content-type']}`,
  );
  assert.ok(res.raw.includes('<html'), '响应体必须是 HTML');
  assert.ok(res.raw.includes('</html>'), '响应体必须是完整 HTML 文档');
  return { res, dom: new JSDOM(res.raw) };
}

test('前端同端口可达（AC-27）· 根路径出 HTML', async () => {
  await withApp(undefined, async (app) => {
    const { res } = await loadRoot(app);
    assert.equal(res.remotePort, app.port, '前端必须与 API 同端口');
  });
});

test('前端同端口可达（AC-27）· 含商品名称锚点', async () => {
  await withApp(undefined, async (app) => {
    const { dom } = await loadRoot(app);
    const anchors = dom.window.document.querySelectorAll('[data-product-name]').length;
    const { items } = await listProducts(newClient(app));
    const text = dom.window.document.body ? dom.window.document.body.textContent : '';
    const nameHits = items.filter((item) => text.includes(item.name)).length;
    assert.ok(
      anchors >= 1 || nameHits >= 1,
      `页面必须含至少一个可定位的商品锚点：data-product-name=${anchors}，商品名文本命中=${nameHits}`,
    );
  });
});

test('前端同端口可达（AC-27）· 原生 ESM 脚本可从 /src 取到', async () => {
  await withApp(undefined, async (app) => {
    const { dom } = await loadRoot(app);
    const scripts = [...dom.window.document.querySelectorAll('script[type="module"]')];
    assert.ok(scripts.length >= 1, '页面必须引用至少一个 type="module" 的脚本');
    const sourced = scripts.filter((s) => s.getAttribute('src'));
    assert.ok(sourced.length >= 1, '至少一个模块脚本必须通过 src 引用外部文件');
    const client = newClient(app);
    for (const script of sourced) {
      const url = new URL(script.getAttribute('src'), `http://127.0.0.1:${app.port}/`);
      assert.equal(url.port, String(app.port), '脚本必须由同一端口提供');
      assert.ok(
        url.pathname.startsWith('/src/'),
        `脚本必须从 /src 下提供（无构建产物路径），实际：${url.pathname}`,
      );
      const asset = await client.get(url.pathname);
      assert.equal(asset.status, 200, `${url.pathname} 必须可下载`);
      assert.ok(
        String(asset.headers['content-type']).includes('javascript'),
        `模块 content-type 必须含 javascript，实际：${asset.headers['content-type']}`,
      );
    }
  });
});

// 原「AC-27 · DOM 中不出现图片素材」判据已删除：其来源 FEAT-001 非目标 `N-6`（商品图片素材＝明确不做）
// 由 FEAT-002 PRD §1.5 `S-9` 解除，主图改由**本仓自托管商品照片**（`web/assets/products/P-00N.jpg`）提供 ⇒ 该面的正向判据归 FEAT-002
// `AC-40` / `AC-46` / `AC-48`。本文件不做反向断言，避免两包判据互相顶撞。
