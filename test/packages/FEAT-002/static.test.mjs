/**
 * 静态面：缓存策略 / 主图可达 / 路径不越界 / 静态 404 与图标 / 零第三方素材。
 *
 * 装置纪律：路径穿越用例**原样发送请求目标**（rawGet），避免客户端归一化把穿越形态吃掉；
 * 主图逐个文件跑，不以一个代表八个；真机网络抓包与断网渲染归 UAT（本文件只做可机器判定的替代判据）。
 *
 * @prd FEAT-002
 * @prdVersion 3
 * @priority P1
 * @status active
 * @case TC-FEAT-002-31
 * @case TC-FEAT-002-49
 * @case TC-FEAT-002-50
 * @case TC-FEAT-002-51
 * @case TC-FEAT-002-52
 * @case TC-FEAT-002-62
 * @case TC-FEAT-002-E12
 * @case TC-FEAT-002-E16
 * @case TC-FEAT-002-E17
 * @case TC-FEAT-002-UI64
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { globSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { DEFAULT_SEED } from '../../../server/src/seed.mjs';
import {
  REPO_ROOT,
  contentFingerprint,
  getHtml,
  getModuleText,
  getStyleText,
  jpegStructure,
  listProducts,
  newClient,
  rawGet,
  rawGetBytes,
  readRepoFile,
  repoText,
  withApp,
  withTempDb,
} from './helpers/harness.mjs';

const SOURCE_MARKERS = ['export ', 'createApp', 'nextOrderNo', 'import '];
const BRAND_TOKENS = /(taobao|tmall|alicdn|tbcdn|alibaba|aliyun)/i;
const EXTERNAL_URL = /(?:src|href)\s*=\s*["'](?:https?:)?\/\/|url\(\s*["']?(?:https?:)?\/\/|@import\s+(?:url\()?\s*["']?(?:https?:)?\/\//i;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 主图已统一为 .jpg（prdVersion 2）：这里扫**所有图片扩展名**，好让残留的 .svg 引用落在可取集合之外被判红。
const assetUrls = (text) => [
  ...new Set([...String(text).matchAll(/\/assets\/[A-Za-z0-9_\-./%]+\.(?:svg|jpg|jpeg|png|webp)/g)].map((m) => m[0])),
];
const textFiles = (patterns) => {
  const out = [];
  for (const pattern of patterns) {
    for (const rel of globSync(pattern, { cwd: REPO_ROOT })) {
      if (!statSync(join(REPO_ROOT, rel)).isFile()) continue; // glob 会带出目录
      out.push(rel);
    }
  }
  return out;
};

test('静态缓存策略（AC-31）', async () => {
  await withTempDb(async ({ dbPath }) => {
    await withApp({ dbPath }, async (app) => {
      const client = newClient(app);
      const home = await client.get('/');
      assert.equal(home.status, 200, `GET / 必须 200，实际 ${home.status}`);
      const homeCc = String(home.headers['cache-control'] ?? '');
      assert.ok(
        /no-cache/.test(homeCc) || (/max-age=0/.test(homeCc) && /must-revalidate/.test(homeCc)),
        `HTML 必须是协商缓存（no-cache 或 max-age=0+must-revalidate），实际 "${homeCc}"`,
      );
      assert.ok(home.headers.etag, 'HTML 必须带 ETag');

      const refs = [...home.raw.matchAll(/(?:src|href)="([^"]+)"/g)]
        .map((m) => m[1])
        .filter((u) => /^\/(src|assets)\//.test(u));
      assert.ok(refs.length > 0, '首帧 HTML 必须引用 /src/** 或 /assets/** 静态资源');

      // ② 无指纹静态：no-cache + ETag + 条件请求可 304
      const bare = refs[0].split('?')[0];
      const first = await client.get(bare);
      assert.equal(first.status, 200, `无指纹静态 ${bare} 必须 200，实际 ${first.status}`);
      const bareCc = String(first.headers['cache-control'] ?? '');
      assert.match(bareCc, /no-cache|max-age=0/, `无指纹静态必须协商缓存，实际 "${bareCc}"`);
      const etag = first.headers.etag;
      assert.ok(etag, `无指纹静态必须带 ETag（${bare}）`);
      const second = await client.get(bare, { headers: { 'if-none-match': etag } });
      assert.equal(second.status, 304, `回带 If-None-Match 必须 304，实际 ${second.status}`);
      assert.equal(second.raw, '', '304 响应体必须为空');

      // ③ 带**真**指纹：public + immutable + max-age ≥ 31536000
      //    v3 口径（主控裁定；PRD `AC-31` ⑤ + 契约 §7.2）：`?v=` 的值**必须等于该资源文件字节的 `sha256` 前 10 位 hex（小写）**。
      //    「形态合法的正则」降级为**前置**（不再是判据本身）—— 形态合法但退化的值（`?v=0` / `?v=000000`）走下面 ⑤ 档判红。
      const fingerprinted = refs.find((u) => /[?&]v=/.test(u));
      assert.ok(
        fingerprinted,
        '前置未成立：首帧 HTML 未给脚本 / 样式 / 主图注入内容指纹查询串（契约 §七 前置）⇒ 带指纹档不可构造，须在报告如实标注',
      );
      const fpPath = fingerprinted.split('?')[0];
      const fpWant = contentFingerprint(readFileSync(join(REPO_ROOT, 'web', fpPath.replace(/^\//, ''))));
      const fpGot = (fingerprinted.match(/[?&]v=([^&]*)/) ?? [])[1];
      assert.equal(
        fpGot,
        fpWant,
        `首帧注入的指纹必须等于该文件**字节**的 sha256 前 10 位 hex（小写；契约 §7.2 v3 定义钉死）：${fpPath} 期望 ${fpWant}，实际 ${fpGot}`,
      );
      const fp = await client.get(fingerprinted);
      assert.equal(fp.status, 200, `带指纹静态 ${fingerprinted} 必须 200，实际 ${fp.status}`);
      const fpCc = String(fp.headers['cache-control'] ?? '');
      assert.match(fpCc, /public/, `带指纹静态必须 public，实际 "${fpCc}"`);
      assert.match(fpCc, /immutable/, `带指纹静态必须 immutable，实际 "${fpCc}"`);
      const maxAge = Number((fpCc.match(/max-age=(\d+)/) ?? [])[1] ?? -1);
      assert.ok(maxAge >= 31536000, `带指纹静态 max-age 必须 ≥ 31536000，实际 ${maxAge}（"${fpCc}"）`);

      // ⑤ 退化指纹档（v3 新增，判据来源 = 发布前评审 🔴）：长度 / 形态合法但**不等于**该文件真指纹的值
      //    ⇒ **不得**换来一年强缓存。真源口径（PRD `AC-31` ⑤ **同版收口** + 契约 §7.2，主控 2026-10-16 裁定）：
      //    **必须仍返回 `200`** 且按无指纹档处置（`no-cache` + `ETag`），并且不得返回 `public, max-age=31536000, immutable`；
      //    **不接受 `404`**（或任何「把已存在的资源说成不存在」的处置）—— 该档真正要断的是「不得得到 `immutable`」，不是「可以 404」。
      for (const value of ['0', '000000']) {
        const url = `${fpPath}?v=${value}`;
        const res = await client.get(url);
        assert.notEqual(
          res.status,
          404,
          `退化指纹 ${url} **不得 404**（资源文件确实存在，伪造查询串不得把已存在的资源说成不存在；真源明写 404 判红），实际 ${res.status}`,
        );
        assert.equal(res.status, 200, `退化指纹 ${url} 必须仍 200，实际 ${res.status}`);
        const cc = String(res.headers['cache-control'] ?? '');
        assert.ok(
          /no-cache|max-age=0/.test(cc),
          `退化指纹 ${url} 必须按**无指纹档**处置（no-cache + ETag 协商缓存），实际 "${cc}"`,
        );
        assert.ok(res.headers.etag, `退化指纹 ${url} 必须带 ETag（无指纹档协商缓存），实际 ${res.headers.etag}`);
        assert.equal(
          /immutable/.test(cc),
          false,
          `退化指纹 ${url} 不得返回 immutable（一次伪造 / 退化指纹不得把错误版本钉在客户端一年），实际 "${cc}"`,
        );
        const ma = Number((cc.match(/max-age=(\d+)/) ?? [])[1] ?? -1);
        assert.ok(ma < 31536000, `退化指纹 ${url} 的 max-age 必须落进无指纹档（< 31536000），实际 ${ma}（"${cc}"）`);
      }
    });
  });
});

test('商品主图可访问（AC-49）', async () => {
  await withTempDb(async ({ dbPath }) => {
    await withApp({ dbPath }, async (app) => {
      const client = newClient(app);
      const products = await listProducts(client);
      assert.equal(products.length, 8, `种子商品必须 8 件（逐图判据的分母），实际 ${products.length}`);
      const resolved = new Set();
      for (const product of products) {
        // 主图路径由**冻结接口**钉死：/assets/products/<id>.jpg（不再按商品名解析 —— 名称带不出扩展名变更，
        // 且照片没有 <title> 可回填）。每个商品逐个文件跑，不以一个代表八个。
        const url = `/assets/products/${product.id}.jpg`;
        const res = await client.get(url);
        assert.equal(res.status, 200, `商品「${product.name}」的主图 ${url} 必须可取到 200，实际 ${res.status}`);
        assert.match(
          String(res.headers['content-type'] ?? ''),
          /^image\/jpeg\b/i,
          `${url} 的 content-type 必须是 image/jpeg，实际 ${res.headers['content-type']}`,
        );
        // JPEG 是二进制：不能用 utf8 文本比对内容（raw 是 utf8 解码结果，长度≠字节数）。
        // 改用「整份文件真被送出」的硬判据：content-length 必须等于盘上字节数（实测静态面确实发该头）。
        const diskBytes = statSync(join(REPO_ROOT, 'web', 'assets', 'products', `${product.id}.jpg`)).size;
        assert.equal(
          Number(res.headers['content-length']),
          diskBytes,
          `${url} 必须送出整份文件（content-length 应等于盘上 ${diskBytes} 字节），实际 ${res.headers['content-length']}`,
        );
        assert.equal(/^\s*[{<]/.test(res.raw), false, `${url} 不得返回 JSON / HTML 错误体，实际 ${res.raw.slice(0, 60)}`);
        // 二进制的**真判据**只能按线上原始字节判（raw 是 utf8 解码结果 ⇒ 坏字节会被静默换成 U+FFFD）：
        // socket 级取样，逐字节必须等于盘上文件 —— utf8 再编码 / 截断 / 头体不一致全部落网。
        const wire = await rawGetBytes(app.port, url);
        assert.deepStrictEqual(
          [...wire.body.subarray(0, 3)],
          [0xff, 0xd8, 0xff],
          `${url} 线上响应体头 3 字节必须是 JPEG SOI（FF D8 FF），实际 ${[...wire.body.subarray(0, 3)].map((b) => b.toString(16).padStart(2, '0')).join(' ')}`,
        );
        assert.equal(
          wire.body.length,
          diskBytes,
          `${url} 线上必须原样送出整份文件：收到 ${wire.body.length} 字节，盘上 ${diskBytes} 字节（utf8 再编码 / 截断都算红）`,
        );
        // v3（发布前评审 🔴）：服务端**忠实转发**的字节本身也必须**结构完整** —— 旧口径下「忠实转发一个坏文件」
        // ⚠ 口径现状（主控 2026-10-16 裁定）：该要求**尚未写进 `AC-49` 字面**（已派 pm 补），当前为「`AC-48` ③ 同一口径 + 字节相等」的**推导口径**；
        //   对合规实现**不会判红**（结构完整是字节相等的必要延伸），pm 落字面后核对口径一致即可。
        // （content-length 相符 + 逐字节相等都成立）仍会绿。这里复用 `AC-48` ③ 的同一份结构走查（同一口径，不另抄一份）。
        // ⚠ 机器只保证结构完整；「能否被真实解码器解出图像」属人工 / 真机判断（PRD `AC-48` ③ 明写）。
        const wireWalk = jpegStructure(wire.body);
        assert.ok(
          wireWalk.ok,
          `${url} 线上转发的字节必须结构完整（与 AC-48 ③ 同一口径：段长自洽 + SOS 后有非空熵数据 + 以 EOI 结束），实际：${wireWalk.reason}`,
        );
        resolved.add(url.split('?')[0]);
      }

      // 首帧引用的主图路径必须全部落在可取的这 8 个之内（残留 .svg 引用按此会落在集合外 ⇒ 红）
      const home = await client.get('/');
      const htmlAssets = assetUrls(home.raw);
      for (const url of htmlAssets) {
        if (!url.includes('/products/')) continue;
        assert.ok(
          [...resolved].some((r) => r === url.split('?')[0]),
          `首帧引用的主图 ${url} 不在可取到的 8 个之内（主图已统一为 /assets/products/P-00N.jpg）`,
        );
      }
    });
  });
});

test('静态路径不越界（AC-50）', async () => {
  await withTempDb(async ({ dbPath }) => {
    await withApp({ dbPath }, async (app) => {
      const paths = [
        '/assets/../server/src/app.mjs',
        '/%2e%2e/server/src/app.mjs',
        '/assets/%2e%2e%2fserver%2fsrc%2fapp.mjs',
        '/server/src/app.mjs',
        '/assets/products/x.png',
      ];
      for (const target of paths) {
        const res = await rawGet(app.port, target);
        assert.equal(res.status, 404, `穿越 / 越界路径 ${target} 必须 404，实际 ${res.status}`);
        for (const marker of SOURCE_MARKERS) {
          assert.equal(res.body.includes(marker), false, `${target} 不得返回源码内容（命中 ${marker}）`);
        }
        assert.equal(res.body.includes(REPO_ROOT), false, `${target} 响应体不得含仓库绝对路径`);
      }
    });
  });
});

test('静态404与图标（AC-51）', async () => {
  await withTempDb(async ({ dbPath }) => {
    await withApp({ dbPath }, async (app) => {
      const client = newClient(app);
      const products = await listProducts(client);

      // ① 静态 404：纯文本、无业务文案
      const miss = await rawGet(app.port, '/no-such-static-path');
      assert.equal(miss.status, 404, `未知静态路径必须 404，实际 ${miss.status}`);
      assert.equal(
        /application\/json/i.test(String(miss.headers['content-type'] ?? '')),
        false,
        `静态 404 不得是 JSON（不得套用 API 错误体），实际 ${miss.headers['content-type']}`,
      );
      assert.match(String(miss.headers['content-type'] ?? ''), /text\/plain/i, '静态 404 必须是 text/plain');
      assert.equal(miss.body.includes('找不到该商品'), false, '静态 404 不得带商品文案「找不到该商品」');
      for (const product of products) {
        assert.equal(new RegExp(product.name).test(miss.body), false, `静态 404 不得带商品名「${product.name}」`);
      }

      // ② 任意静态资源可 304
      const home = await client.get('/');
      assert.ok(home.headers.etag, 'HTML 必须带 ETag（条件请求前置）');
      const notModified = await client.get('/', { headers: { 'if-none-match': home.headers.etag } });
      assert.equal(notModified.status, 304, `静态资源回带 If-None-Match 必须 304，实际 ${notModified.status}`);

      // ③ /favicon.ico：自制 SVG + 缓存口径 + ETag/304
      const favicon = await client.get('/favicon.ico');
      assert.equal(favicon.status, 200, `/favicon.ico 必须 200，实际 ${favicon.status}`);
      assert.match(
        String(favicon.headers['content-type'] ?? ''),
        /image\/svg\+xml/,
        `/favicon.ico 的 content-type 必须是 image/svg+xml，实际 ${favicon.headers['content-type']}`,
      );
      assert.ok(favicon.raw.trimStart().startsWith('<svg'), '图标内容必须是 SVG（自制）');
      assert.equal(
        /(?:https?:)?\/\//.test(favicon.raw.replace(/xmlns="[^"]*"/g, '')),
        false,
        '自制图标不得引用任何外部地址',
      );
      const favCc = String(favicon.headers['cache-control'] ?? '');
      assert.match(favCc, /public/, `favicon 必须 public 缓存，实际 "${favCc}"`);
      const favMaxAge = Number((favCc.match(/max-age=(\d+)/) ?? [])[1] ?? -1);
      assert.ok(favMaxAge >= 86400, `favicon max-age 必须 ≥ 86400，实际 ${favMaxAge}（"${favCc}"）`);
      assert.ok(favicon.headers.etag, 'favicon 必须带 ETag');
      const favSecond = await client.get('/favicon.ico', { headers: { 'if-none-match': favicon.headers.etag } });
      assert.equal(favSecond.status, 304, `favicon 条件请求必须 304，实际 ${favSecond.status}`);
      assert.equal(favSecond.raw, '', '304 响应体必须为空');
    });
  });
});

test('不引第三方素材（AC-52）', async () => {
  await withTempDb(async ({ dbPath }) => {
    // ① 文本扫描：交付面（不含流程产物目录 docs/process/** —— 送审材料内可能引用竞品域名作为证据）
    const files = textFiles(['web/**/*', 'server/**/*', 'deploy/**/*', 'scripts/ops/**/*', 'docs/*.md']);
    assert.ok(files.length > 0, '交付面文本文件必须存在');
    const hits = [];
    for (const rel of files) {
      const text = repoText(rel);
      for (const line of text.split('\n')) {
        if (BRAND_TOKENS.test(line)) hits.push(`${rel}: ${line.trim().slice(0, 120)}`);
      }
    }
    assert.deepStrictEqual(hits, [], `交付物不得出现淘宝系域名 / 商标关键字，命中：\n${hits.join('\n')}`);

    await withApp({ dbPath }, async (app) => {
      const client = newClient(app);
      // ② 运行期零第三方请求的机器层替代判据：静态面不得出现任何外部 URL
      const home = await client.get('/');
      const style = await getStyleText(app);
      const modules = (await getModuleText(app)).text;
      for (const [label, text] of [
        ['首帧 HTML', home.raw],
        ['样式文本', style.css],
        ['模块源码', modules],
      ]) {
        assert.equal(EXTERNAL_URL.test(text), false, `${label} 不得引用任何外部地址（第三方请求面必须为零）`);
        assert.equal(BRAND_TOKENS.test(text), false, `${label} 不得出现淘宝系域名 / 商标关键字`);
      }
    });
  });
});

test('零第三方请求（E-12）', async () => {
  await withTempDb(async ({ dbPath }) => {
    await withApp({ dbPath }, async (app) => {
      const home = await getHtml(app);
      const modules = (await getModuleText(app)).text;
      const externalFetches = [...String(modules).matchAll(/fetch\(\s*[`'"]([^`'"]+)/g)]
        .map((m) => m[1])
        .filter((u) => /^(?:https?:)?\/\//.test(u));
      assert.deepStrictEqual(externalFetches, [], `运行期不得 fetch 任何外部地址，实际 ${JSON.stringify(externalFetches)}`);

      const hosts = [...String(home.raw).matchAll(/(?:src|href)="([^"]+)"/g)]
        .map((m) => m[1])
        .filter((u) => /^(?:https?:)?\/\//.test(u));
      assert.deepStrictEqual(hosts, [], `首帧不得引用外部 host，实际 ${JSON.stringify(hosts)}`);

      // 服务端源码不得内置外部素材地址
      for (const rel of globSync('server/**/*.mjs', { cwd: REPO_ROOT })) {
        const text = repoText(rel);
        assert.equal(BRAND_TOKENS.test(text), false, `${rel} 不得内置第三方素材地址`);
      }
      await wait(10);
    });
  });
});

test('静态白名单外（E-16）', async () => {
  await withTempDb(async ({ dbPath }) => {
    await withApp({ dbPath }, async (app) => {
      const cases = [
        '/server/src/app.mjs',
        '/src/../server/src/app.mjs',
        '/assets/products/x.png',
        '/web/index.html',
        '/../package.json',
      ];
      for (const target of cases) {
        const res = await rawGet(app.port, target);
        assert.equal(res.status, 404, `白名单外路径 ${target} 必须 404，实际 ${res.status}`);
        assert.ok(res.status < 500, `${target} 不得 5xx`);
        for (const marker of [...SOURCE_MARKERS, '"name"', 'dependencies']) {
          assert.equal(res.body.includes(marker), false, `${target} 不得返回 web/ 之外的文件内容（命中 ${marker}）`);
        }
        assert.equal(
          /text\/html/i.test(String(res.headers['content-type'] ?? '')),
          false,
          `${target} 不得返回 HTML 首帧`,
        );
      }
    });
  });
});

test('主图缺失（E-17）', async () => {
  await withTempDb(async ({ dbPath }) => {
    await withApp({ dbPath }, async (app) => {
      const client = newClient(app);
      const products = await listProducts(client);
      // 缺失的**当前格式**主图（.jpg）必须 404：白名单把 .jpg 纳入后，这条才是真判据
      const res = await client.get('/assets/products/__no-such-image__.jpg');
      assert.equal(res.status, 404, `缺失主图必须 404，实际 ${res.status}`);
      assert.equal(
        /text\/html/i.test(String(res.headers['content-type'] ?? '')),
        false,
        `缺失主图不得返回 HTML 首帧，实际 ${res.headers['content-type']}`,
      );
      assert.equal(/<!DOCTYPE|<html/i.test(res.raw), false, `缺失主图响应体不得是页面首帧：${res.raw.slice(0, 80)}`);
      assert.equal(res.raw.includes('找不到该商品'), false, '缺失主图不得套用 API 商品文案');
      for (const product of products) {
        assert.equal(res.raw.includes(product.name), false, `缺失主图响应体不得含商品名「${product.name}」`);
      }
    });
  });
});

test('favicon 链接元素（UI-64）', async () => {
  // 窄判据：只断 web/index.html 的 <head> 内那个 <link> 元素本身。
  // /favicon.ico 的路由面已由 AC-51 覆盖；本条补的是「dev 不写 <link> 也能全绿」的缺口。
  const html = readRepoFile('web/index.html');
  const dom = new JSDOM(html);
  const document = dom.window.document;
  const icon = document.head.querySelector('link[rel~="icon"]');
  assert.ok(
    icon,
    'web/index.html 的 <head> 内必须有 <link rel="icon">（图标链接不得只靠 /favicon.ico 兜底）',
  );
  assert.equal(icon.getAttribute('rel'), 'icon', '图标链接的 rel 必须逐字为 "icon"');
  assert.equal(icon.getAttribute('type'), 'image/svg+xml', '图标链接的 type 必须逐字为 "image/svg+xml"（自制 SVG）');
  assert.equal(icon.getAttribute('href'), '/assets/favicon.svg', '图标链接的 href 必须逐字为 "/assets/favicon.svg"');
  assert.ok(icon.closest('head'), '图标链接必须位于 <head> 内（放进 <body> 不生效）');
});

test('首帧 noscript 目录封顶（AC-62）', async () => {
  // 判据（PRD `AC-62`；字面值以 ui-spec `UI-51` 为准，本用例只断「与规格字面值一致」）：
  //  · `<noscript>` 目录**最多输出 7 行**，每行形如「<商品名>　¥ x.xx」（**全角空格**分隔）；
  //  · `N > 7` 时末尾出现逐字「还有 N−7 件商品（<第 8 件商品名>）」；`N ≤ 7` **不出现**该行；`N = 0` 目录为空且不出现该行；
  //  · **禁止全量输出**（`N = 8` 时不得出现 8 行）。
  //  商品名**以 `DEFAULT_SEED` 为准**：这里直接注入种子切片、按名称断言，**不硬编码名字**、不依赖夹具主键（PROJECT.md 口径）。
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const cases = [
    {
      n: 8,
      seed: DEFAULT_SEED.slice(0, 8),
      expectLines: 7,
      expectSummary: `还有 1 件商品（${DEFAULT_SEED[7].name}）`,
    },
    { n: 7, seed: DEFAULT_SEED.slice(0, 7), expectLines: 7, expectSummary: null },
    { n: 0, seed: [], expectLines: 0, expectSummary: null },
  ];
  for (const item of cases) {
    await withTempDb(async ({ dbPath }) => {
      await withApp({ dbPath, seed: item.seed }, async (app) => {
        const html = await getHtml(app, '/');
        const raw = html.raw ?? html;
        assert.match(raw, /<noscript[\s\S]*?<\/noscript>/i, `N=${item.n}：首帧必须含 <noscript>`);
        const noscript = new JSDOM(raw).window.document.querySelector('noscript');
        const rows = [...noscript.querySelectorAll('li')];
        assert.equal(
          rows.length,
          item.expectLines,
          `N=${item.n}：目录行数必须 = min(N,7) = ${item.expectLines}（**禁止全量输出**），实际 ${rows.length} 行`,
        );
        for (const [i, row] of rows.entries()) {
          const expect = item.seed[i];
          const price = `¥ ${(expect.priceCents / 100).toFixed(2)}`;
          const text = row.textContent.replace(/\s+/g, ' ').trim();
          assert.ok(text.includes(expect.name), `N=${item.n} 第 ${i + 1} 行必须含商品名「${expect.name}」，实际「${text}」`);
          assert.ok(text.includes(price), `N=${item.n} 第 ${i + 1} 行必须含价格「${price}」，实际「${text}」`);
          assert.ok(
            new RegExp(`${escapeRe(expect.name)}\\u3000\\s*¥`).test(row.textContent),
            `N=${item.n} 第 ${i + 1} 行必须形如「<商品名>　¥ x.xx」（**全角空格**分隔，ui-spec UI-51 字面），实际「${text}」`,
          );
        }
        const flat = noscript.textContent.replace(/\s+/g, ' ');
        if (item.expectSummary) {
          assert.ok(
            flat.includes(item.expectSummary),
            `N=${item.n}：目录末尾必须出现逐字「${item.expectSummary}」封顶行，实际「${flat.slice(0, 200)}」`,
          );
        } else {
          assert.equal(
            /还有\s*\d+\s*件商品/.test(flat),
            false,
            `N=${item.n}：N ≤ 7（含 N=0）时**不得**出现「还有 N−7 件商品」封顶行，实际「${flat.slice(0, 200)}」`,
          );
        }
      });
    });
  }
});