/**
 * UI 面：浅底橙红语言 / 商品流与卡片 / 底部 Tab / 按钮与搜索 / 首帧与行为继承。
 *
 * 判据分层（PRD §4.5 明写）：机器层 = 服务端返回的 CSS 字面值 + 首帧 DOM + 模块源码结构；
 * 真机层 = 视口渲染（列数、占比、浮起感、横向滚动、截图）归 UAT（jsdom 不算布局，
 * 用 jsdom 断「渲染后宽度 / 横向滚动」只会是假绿，故本文件不写这类断言）。
 * 字面值来源 = UI 规格（`prd/FEAT-002-ui-spec.md`）；本文件只断「与规格字面值一致」+「旧值不得残留」。
 *
 * @prd FEAT-002
 * @prdVersion 2
 * @priority P0
 * @status active
 * @case TC-FEAT-002-38
 * @case TC-FEAT-002-39
 * @case TC-FEAT-002-40
 * @case TC-FEAT-002-41
 * @case TC-FEAT-002-42
 * @case TC-FEAT-002-43
 * @case TC-FEAT-002-44
 * @case TC-FEAT-002-45
 * @case TC-FEAT-002-46
 * @case TC-FEAT-002-47
 * @case TC-FEAT-002-48
 * @case TC-FEAT-002-53
 * @case TC-FEAT-002-54
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { globSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { JSDOM } from 'jsdom';
import {
  REPO_ROOT,
  getHtml,
  getModuleText,
  getStyleText,
  listProducts,
  newClient,
  readRepoFile,
  repoFileExists,
  repoText,
  withApp,
  withTempDb,
} from './helpers/harness.mjs';

// ── 规格字面值（唯一来源：UI 规格） ───────────────────────────────────────────
const TOKEN = {
  bg: '#f5f5f5',
  surface: '#ffffff',
  border: '#e5e7eb',
  text: '#1f2329',
  textMuted: '#333940',
  accent: '#7a2200',
  accentFill: '#d93a00',
  accentFillDark: '#b33000',
  accentTint: '#ffe4d6',
  accentBadge: '#6e1e00',
  success: '#083d19',
  successTint: '#f0fdf4',
  danger: '#8f1414',
  disabled: '#52575e',
};
const OLD_TOKENS = ['#0d1117', '#161b22', '#1f6feb'];
const CTA_GRADIENT = /linear-gradient\(\s*180deg\s*,\s*#d93a00\s+0%\s*,\s*#b33000\s+100%\s*\)/i;
const BRAND = /(taobao|tmall|alicdn|tbcdn|alibaba|aliyun)/i;

// ── 极简 CSS 解析（块 → 选择器 / 声明 / @media 上下文） ────────────────────────
function parseDecls(body) {
  const out = new Map();
  let depth = 0;
  let buf = '';
  const parts = [];
  for (const ch of body) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ';' && depth === 0) {
      parts.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  parts.push(buf);
  for (const part of parts) {
    const idx = part.indexOf(':');
    if (idx <= 0) continue;
    const prop = part.slice(0, idx).trim().toLowerCase();
    const value = part.slice(idx + 1).trim();
    if (prop) out.set(prop, out.has(prop) ? `${out.get(prop)} ${value}` : value);
  }
  return out;
}

function parseCss(css) {
  const text = String(css).replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const stack = [];
  let buf = '';
  for (const ch of text) {
    if (ch === '{') {
      stack.push(buf.trim());
      buf = '';
      continue;
    }
    if (ch === '}') {
      const selector = stack[stack.length - 1] ?? '';
      const context = stack.slice(0, -1);
      rules.push({ selector, context, contextText: context.join(' '), body: buf.trim(), decls: parseDecls(buf) });
      stack.pop();
      buf = '';
      continue;
    }
    buf += ch;
  }
  return rules;
}

/** 解析 `var(--x)`（含 fallback 与多级引用），否则令牌化实现会被误判为「未使用字面值」。 */
function resolveVars(rules) {
  const vars = new Map();
  for (const rule of rules) {
    for (const [prop, value] of rule.decls) if (prop.startsWith('--')) vars.set(prop, value);
  }
  const sub = (value, depth = 0) => {
    if (depth > 6) return String(value);
    return String(value).replace(
      /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g,
      (match, name, fallback) => {
        if (vars.has(name)) return sub(vars.get(name), depth + 1);
        return fallback !== undefined ? sub(fallback.trim(), depth + 1) : match;
      },
    );
  };
  return rules.map((rule) => ({ ...rule, decls: new Map([...rule.decls].map(([k, v]) => [k, sub(v)])) }));
}

const px = (value) => {
  const m = String(value ?? '').match(/(-?\d+(?:\.\d+)?)\s*px/);
  return m ? Number(m[1]) : null;
};
const colorsIn = (text) => new Set([...String(text).matchAll(/#[0-9a-f]{3,8}/gi)].map((m) => m[0].toLowerCase()));

/** 一条阴影的 (y 偏移, 模糊, alpha)。 */
function shadowParts(value) {
  const nums = String(value).match(/-?\d+(?:\.\d+)?(?:px)?/g) ?? [];
  const pxNums = nums.map((n) => Number(String(n).replace('px', ''))).filter((n) => Number.isFinite(n));
  const alpha = Number((String(value).match(/rgba?\(([^)]+)\)/) ?? [])[1]?.split(',').pop() ?? '1');
  return { x: pxNums[0] ?? null, y: pxNums[1] ?? null, blur: pxNums[2] ?? null, alpha: Number.isFinite(alpha) ? alpha : 1 };
}

const mediaHas = (rules, pattern) =>
  rules.filter((r) => r.contextText && pattern.test(r.contextText));

const gridCols = (rules) =>
  rules
    .filter((r) => r.decls.has('grid-template-columns'))
    .map((r) => ({ selector: r.selector, context: r.contextText, value: r.decls.get('grid-template-columns') }));

async function face(app) {
  const client = newClient(app);
  const html = await client.get('/');
  const style = await getStyleText(app);
  const moduleGraph = await getModuleText(app);
  const modules = moduleGraph.text;
  const all = `${html.raw}\n${style.css}\n${modules}`;
  return { client, html, css: style.css, modules, all, rules: resolveVars(parseCss(style.css)) };
}

test('浅底白卡配色（AC-38）', async () => {
  await withTempDb(async ({ dbPath }) => {
    await withApp({ dbPath }, async (app) => {
      const { css, all, rules } = await face(app);
      const bodyRules = rules.filter((r) => /(^|,|\s)body\b/.test(r.selector));
      assert.ok(bodyRules.length > 0, '样式里必须有 body 规则（页面底色判据落点）');
      const bodyBg = bodyRules.map((r) => r.decls.get('background-color') ?? r.decls.get('background') ?? '').join(' ');
      assert.match(bodyBg.toLowerCase(), /#f5f5f5/, `body 底色必须为规格字面值 #F5F5F5，实际 "${bodyBg}"`);
      assert.ok(
        [...colorsIn(css)].includes(TOKEN.surface),
        `交付 CSS 必须含卡片白底字面值 #FFFFFF，实际色板：${JSON.stringify([...colorsIn(css)])}`,
      );
      assert.ok(
        /background[^;{}]*#ffffff/i.test(css),
        '必须存在以 #FFFFFF 作背景的卡片规则（白卡不得只出现在文字色上）',
      );
      for (const old of [OLD_TOKENS[0], OLD_TOKENS[1]]) {
        assert.equal(
          all.toLowerCase().includes(old),
          false,
          `交付面不得残留旧深色令牌 ${old}（逐处计数必须为 0）`,
        );
      }
    });
  });
});

test('主色橙红取值（AC-39）', async () => {
  await withTempDb(async ({ dbPath }) => {
    await withApp({ dbPath }, async (app) => {
      const { css, all, rules } = await face(app);
      const accentRules = rules.filter((r) => {
        const color = String(r.decls.get('color') ?? '').toLowerCase();
        return color.includes(TOKEN.accent);
      });
      assert.ok(accentRules.length > 0, `必须有使用价格主色字面值 #7A2200 的规则，实际色板：${JSON.stringify([...colorsIn(css)])}`);
      const big = accentRules.filter((r) => {
        const size = px(r.decls.get('font-size'));
        const weight = Number(r.decls.get('font-weight') ?? 0);
        return (size !== null && size >= 20) || /^bold|[6-9]00$/.test(String(r.decls.get('font-weight') ?? ''));
      });
      assert.ok(big.length > 0, `必须有「#7A2200 + ≥20px 或 ≥600 字重」的价格规则，实际：${JSON.stringify(accentRules.map((r) => r.body))}`);
      const weightOk = accentRules.some((r) => {
        const w = String(r.decls.get('font-weight') ?? '');
        return /^bold$/i.test(w) || Number(w) >= 600;
      });
      assert.ok(weightOk, `价格必须加粗（font-weight ≥ 600），实际：${JSON.stringify(accentRules.map((r) => r.body))}`);
      const sizeOk = accentRules.some((r) => (px(r.decls.get('font-size')) ?? 0) >= 20);
      assert.ok(sizeOk, `价格字号必须 ≥ 20px，实际：${JSON.stringify(accentRules.map((r) => r.body))}`);

      // 货币符号与数字必须是可分别定位的两个节点（符号更小）
      const symbolSmaller = accentRules.some((r) => {
        const raw = String(r.decls.get('font-size') ?? '');
        const size = px(raw);
        if (size !== null) return size < 20;
        const em = Number((raw.match(/([\d.]+)\s*(em|rem)/) ?? [])[1] ?? NaN);
        if (Number.isFinite(em)) return em < 1;
        const pct = Number((raw.match(/([\d.]+)\s*%/) ?? [])[1] ?? NaN);
        return Number.isFinite(pct) && pct < 100;
      });
      assert.ok(
        symbolSmaller,
        `货币符号必须是比数字更小的独立节点（规格：¥ 小于数字）⇒ 必须有一条更小字号的符号规则，实际：${JSON.stringify(accentRules.map((r) => r.body))}`,
      );
      assert.match(all, /¥/, '价格必须以 ¥ 呈现');
      assert.equal(all.toLowerCase().includes(OLD_TOKENS[2]), false, `交付面不得残留旧蓝色主色 ${OLD_TOKENS[2]}`);
    });
  });
});

test('双列商品卡片流（AC-40）', async () => {
  await withTempDb(async ({ dbPath }) => {
    await withApp({ dbPath }, async (app) => {
      const { css, all, rules, html } = await face(app);
      const cols = gridCols(rules);
      assert.ok(cols.length > 0, `必须有商品网格的 grid-template-columns 声明，实际 CSS 片段：${css.slice(0, 200)}`);
      const two = cols.filter((c) => /repeat\(\s*2\s*,/.test(c.value));
      assert.ok(
        two.length > 0,
        `窄屏商品流必须是两列（repeat(2, …)），实际列声明：${JSON.stringify(cols.map((c) => `${c.context} ${c.selector} ${c.value}`))}`,
      );
      const wide = mediaHas(rules, /min-width\s*:\s*769px/).filter((r) => /repeat\(\s*4\s*,/.test(r.decls.get('grid-template-columns') ?? ''));
      assert.ok(
        wide.length > 0,
        `≥769px 断点必须是四列（repeat(4, …)），实际：${JSON.stringify(cols.map((c) => `${c.context} ${c.value}`))}`,
      );
      for (const c of cols) {
        assert.equal(
          /auto-fill|auto-fit/.test(c.value) && /\bminmax\(\s*(288|304)px/.test(c.value),
          false,
          `旧栅格 repeat(auto-fill, minmax(288px, 304px)) 不得残留，实际 ${c.value}`,
        );
      }
      assert.ok(/line-clamp\s*:\s*2|max-height[^;]*42px/.test(css), '标题最多两行必须有截断声明（-webkit-line-clamp: 2 等）');

      // 卡内顺序：图 → 标题 → 价格（jsdom 首帧目录承载，JS 卡片的渲染顺序由 UAT 复核）
      const dom = new JSDOM(html.raw);
      const doc = dom.window.document;
      const rows = [...doc.querySelectorAll('img[src^="/assets/products/"]')];
      assert.ok(rows.length > 0, '首帧必须直写主图 <img>（禁用 JS 也可加载）');
      const first = rows[0];
      const text = first.parentElement ? first.parentElement.textContent : '';
      assert.ok(text.length > 0, '首帧主图所在行必须同时含标题与价格文本');
      assert.equal(
        /^\s*¥/.test(text.replace(/\s+/g, ' ').trim()),
        false,
        `价格不得排在标题之前（顺序必须是 图 → 标题 → 价格），实际行文本：${text.slice(0, 60)}`,
      );
    });
  });
});

test('底部Tab导航（AC-41）', async () => {
  await withTempDb(async ({ dbPath }) => {
    await withApp({ dbPath }, async (app) => {
      const { css, all, rules } = await face(app);
      const fixed = rules.filter((r) => /fixed/.test(String(r.decls.get('position') ?? '')));
      assert.ok(fixed.length > 0, '必须有 position:fixed 的贴底容器（底部 Tab）');
      const bottomBar = fixed.filter((r) => {
        const bottom = r.decls.get('bottom') ?? '';
        const height = px(r.decls.get('height') ?? '');
        return /^0(px)?$/.test(String(bottom).trim()) || height === 49;
      });
      assert.ok(
        bottomBar.length > 0,
        `底部 Tab 必须贴底（bottom:0）且栏高 49px，实际：${JSON.stringify(fixed.map((r) => `${r.selector} ${r.body}`))}`,
      );
      assert.match(css, /#7a2200/i, '当前 Tab 项高亮必须用主色字面值 #7A2200');
      assert.match(css, /#333940/i, '未选中 Tab 项必须用次深档字面值 #333940');
      // 入口：规格定稿四项文案（PRD AC-41 写「三项」，取超集判据以免自相矛盾）
      const entries = ['首页', '购物车', '订单', '我的'];
      const present = entries.filter((e) => all.includes(e));
      assert.ok(
        present.length >= 3 && present.includes('购物车') && present.includes('我的'),
        `底部 Tab 必须含规格定稿入口（购物车 / 我的 必备，共 ≥3 项），实际命中：${JSON.stringify(present)}`,
      );
      for (const hash of ['#/cart', '#/me']) {
        assert.ok(all.includes(hash), `Tab 跳转必须是前端可达的哈希路由，缺 ${hash}`);
      }
      assert.equal(/sidebar/i.test(all), false, '交付面不得残留旧左侧竖排导航（sidebar）');
    });
  });
});

test('圆角卡轻阴影（AC-42）', async () => {
  await withTempDb(async ({ dbPath }) => {
    await withApp({ dbPath }, async (app) => {
      const { css, rules } = await face(app);
      const rounded = rules.filter((r) => (px(r.decls.get('border-radius')) ?? 0) >= 16);
      assert.ok(rounded.length > 0, `卡片必须有圆角（规格 16px），实际圆角声明：${JSON.stringify(rules.map((r) => r.decls.get('border-radius')).filter(Boolean))}`);
      const list = rules.map((r) => r.decls.get('box-shadow')).filter(Boolean);
      assert.ok(list.length >= 1, `交付 CSS 中 box-shadow 声明处数必须 ≥ 1（现状基线 0 处），实际 ${list.length}`);
      const light = list.map(shadowParts).filter((s) => s.y !== null && s.y >= 1 && s.y <= 4 && (s.blur ?? 0) <= 8 && s.alpha <= 0.2);
      assert.ok(light.length >= 1, `至少一处卡片阴影必须满足 y∈[1,4]px / 模糊 ≤8px / alpha ≤0.2，实际：${JSON.stringify(list)}`);
      const heavy = list.map(shadowParts).filter((s) => (s.blur ?? 0) > 8 && s.alpha > 0.2);
      assert.deepStrictEqual(heavy, [], `不得出现「大而黑」的阴影（模糊 >8px 且 alpha >0.2），实际：${JSON.stringify(list)}`);
    });
  });
});

test('橙色胶囊CTA（AC-43）', async () => {
  await withTempDb(async ({ dbPath }) => {
    await withApp({ dbPath }, async (app) => {
      const { css, all, rules } = await face(app);
      const allGradients = rules
        .map((r) => String(r.decls.get('background-image') ?? r.decls.get('background') ?? ''))
        .filter((v) => /gradient/i.test(v));
      assert.ok(
        allGradients.some((v) => CTA_GRADIENT.test(v.replace(/\s+/g, ' '))),
        `主 CTA 必须是规格定稿渐变 linear-gradient(180deg, #D93A00 0%, #B33000 100%)，实际渐变声明：${JSON.stringify(allGradients)}`,
      );
      const gradientRules = rules.filter((r) => CTA_GRADIENT.test(String(r.decls.get('background-image') ?? r.decls.get('background') ?? '').replace(/\s+/g, ' ')));
      const pill = gradientRules.some((r) => {
        const raw = String(r.decls.get('border-radius') ?? '');
        const value = px(raw);
        return (value !== null && value >= 22) || /9999px|999px|9999|50%/.test(raw);
      });
      const anyPill = /border-radius\s*:\s*(9999px|999px|9999|50%|2[2-9]px|3\dpx)/i.test(css);
      assert.ok(pill || anyPill, `主 CTA 必须圆角拉满（胶囊：9999px 或 ≥ 高度一半的值），实际：${JSON.stringify(gradientRules.map((r) => r.body))}`);
      assert.match(css, /#ffffff/i, 'CTA 文字必须是白色（规格 #FFFFFF）');
      for (const text of ['加入购物车', '提交订单']) {
        assert.ok(all.includes(text), `主 CTA 文案必须与规格定稿一致，缺「${text}」`);
      }
      assert.equal(/--btn-primary/i.test(all), false, '旧按钮体系（--btn-primary-*）不得出现在主 CTA 上');
    });
  });
});

test('顶部搜索框存在（AC-44）', async () => {
  await withTempDb(async ({ dbPath }) => {
    await withApp({ dbPath }, async (app) => {
      const { all, css, html, modules } = await face(app);
      const dom = new JSDOM(html.raw);
      const doc = dom.window.document;
      const inDom = doc.querySelector('input[type="search"], [role="searchbox"], input[placeholder="搜索商品"]');
      const inSource = /type\s*[=:]\s*['"]search['"]|role\s*[=:]\s*['"]searchbox['"]/.test(modules);
      assert.ok(
        inDom !== null || inSource,
        '顶部必须存在可聚焦搜索控件（<input type="search"> 或 role="searchbox"），首帧 DOM 与模块源码均未命中',
      );
      assert.ok(all.includes('搜索商品'), '搜索框占位文字必须逐字为「搜索商品」');
      if (inDom) {
        assert.equal(
          inDom.getAttribute('placeholder'),
          '搜索商品',
          `首帧搜索框占位文字必须逐字为「搜索商品」，实际 ${inDom.getAttribute('placeholder')}`,
        );
      }
      assert.match(css, /#edeff2/i, '搜索框底色必须是规格字面值 #EDEFF2');

      // 本期不产生搜索请求：不得出现搜索语义查询串 / 搜索端点
      for (const pattern of [/[?&]q=/, /[?&]keyword=/, /[?&]search=/, /\/api\/v1\/search/, /['"`]\/search/]) {
        assert.equal(pattern.test(all), false, `前端不得存在搜索请求路径（本期不做搜索）：命中 ${pattern}`);
      }
      assert.equal(BRAND.test(all), false, '交付面不得出现淘宝系素材 / 商标关键字');
    });
  });
});

test('商品卡角标标签（AC-45）', async () => {
  await withTempDb(async ({ dbPath }) => {
    await withApp({ dbPath }, async (app) => {
      const { all, css, rules } = await face(app);
      const badgeWords = ['包邮', '秒杀'].filter((w) => all.includes(w));
      assert.ok(badgeWords.length > 0, '商品卡必须有本仓自撰角标文案（「包邮」「秒杀」类），实际一处未见');
      for (const word of badgeWords) {
        assert.ok(word.length <= 4, '角标文案必须是小尺寸通用电商词');
      }
      for (const hex of [TOKEN.successTint, TOKEN.success, TOKEN.accentTint, TOKEN.accentBadge]) {
        assert.ok(
          css.toLowerCase().includes(hex),
          `角标配色必须与规格字面值一致，缺 ${hex}，实际色板：${JSON.stringify([...colorsIn(css)])}`,
        );
      }
      const badgeRules = rules.filter((r) => {
        const h = px(r.decls.get('height') ?? '');
        const radius = px(r.decls.get('border-radius') ?? '');
        return h === 18 || radius === 9;
      });
      assert.ok(badgeRules.length > 0, '角标必须是小尺寸（高 18px / 圆角 9px 档）的独立元素');
      assert.equal(BRAND.test(all), false, '角标不得引用淘宝独创文案');
    });
  });
});

test('图片为主角卡片（AC-46）', async () => {
  await withTempDb(async ({ dbPath }) => {
    await withApp({ dbPath }, async (app) => {
      const { all, html, modules } = await face(app);
      const dom = new JSDOM(html.raw);
      const doc = dom.window.document;
      const images = [...doc.querySelectorAll('img[src^="/assets/products/"]')];
      assert.ok(images.length > 0, '商品卡主视觉必须是本仓自托管主图 <img src="/assets/products/**.jpg">');
      const first = images[0];
      const row = first.closest('li, tr, section, article, div');
      assert.ok(row, '主图必须处于卡片 / 列表行结构内');
      const inner = row.innerHTML;
      const rowText = row.textContent.replace(/\s+/g, ' ').trim();
      assert.ok(/¥/.test(rowText), `主图所在行必须同时承载价格（图片为主视觉而非纯色块），实际：${rowText.slice(0, 80)}`);
      assert.ok(
        rowText.replace(/[\s¥\d.,]/g, '').length > 0,
        `主图所在行必须同时承载标题文本，实际：${rowText.slice(0, 80)}`,
      );
      assert.ok(
        inner.indexOf('<img') < inner.search(/¥/),
        '卡片结构上图片必须位于标题与价格之前（DOM 顺序判据）',
      );
      assert.ok(modules.includes('/assets/products/'), 'JS 渲染的商品卡同样必须引用本仓主图路径');
      // 负向：不得再以「纯 CSS 色块 + 商品名首字」作主视觉
      for (const pattern of [/slice\(\s*0\s*,\s*1\s*\)/, /charAt\(\s*0\s*\)/, /\.firstChar/, /thumb--empty/]) {
        assert.equal(pattern.test(all), false, `不得残留「商品名首字色块」占位实现：命中 ${pattern}`);
      }
    });
  });
});

test('移动优先布局（AC-47）', async () => {
  await withTempDb(async ({ dbPath }) => {
    await withApp({ dbPath }, async (app) => {
      const { css, rules } = await face(app);
      const upscaling = mediaHas(rules, /min-width\s*:\s*769px/);
      assert.ok(
        upscaling.length > 0,
        `必须是窄屏优先（宽屏用 min-width 断点增强），实际媒体查询：${JSON.stringify([...new Set(rules.map((r) => r.contextText).filter(Boolean))])}`,
      );
      const container = rules.filter((r) => (px(r.decls.get('max-width')) ?? 0) >= 1160);
      assert.ok(
        container.length > 0,
        `宽屏内容容器 max-width 必须 ≥ 960px（规格定稿 1160px），实际：${JSON.stringify(rules.map((r) => r.decls.get('max-width')).filter(Boolean))}`,
      );
      const centered = container.some((r) => /auto/.test(String(r.decls.get('margin') ?? r.decls.get('margin-inline') ?? '')));
      assert.ok(centered, '宽屏内容容器必须居中（margin: 0 auto）');
      // ③ 无横向滚动的机器层替代判据：容器必须用 max-width 而非固定 width（固定宽会在窄屏溢出）
      const fixedWidths = rules.filter((r) => px(r.decls.get('width') ?? '') !== null && (px(r.decls.get('width')) ?? 0) > 480);
      assert.deepStrictEqual(
        fixedWidths.map((r) => `${r.selector} width:${r.decls.get('width')}`),
        [],
        '不得对内容容器使用固定大宽度（窄屏会横向溢出）',
      );
      assert.equal(/sidebar/i.test(css), false, '不得残留桌面优先的固定多列侧栏布局');
    });
  });
});

/**
 * 解析 JPEG 的 SOF 段取宽高（判据口径：ui-spec §九「正方形 400×400」+ `UI-12` aspect-ratio 1/1）。
 * 不引入任何无依据的体积阈值：只按 JPEG 结构本身判 —— 段长推进、跳过 APPn/DQT/DHT，命中的第一个 SOFn
 * （`FFC0`~`FFCF` 中除去 `C4`/`C8`/`CC`）里 precision(1) + height(2) + width(2)。
 */
function jpegSize(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let pos = 2;
  while (pos + 3 < buf.length) {
    if (buf[pos] !== 0xff) {
      pos += 1;
      continue;
    }
    const marker = buf[pos + 1];
    if (marker === 0xff) {
      pos += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      pos += 2;
      continue;
    }
    const length = buf.readUInt16BE(pos + 2);
    if (length < 2) return null;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (pos + 9 > buf.length) return null;
      return { marker, bits: buf[pos + 4], height: buf.readUInt16BE(pos + 5), width: buf.readUInt16BE(pos + 7) };
    }
    if (marker === 0xda) return null;
    pos += 2 + length;
  }
  return null;
}

test('本仓自托管商品主图（AC-48）', async () => {
  await withTempDb(async ({ dbPath }) => {
    // 判据（prdVersion 2 重开）：主图 = 本仓自托管**真实照片**（.jpg），不再是自制 SVG。
    // ① 8 张 P-00N.jpg 必须在盘上，且都是真 JPEG（头 3 字节 FF D8 FF）—— 改名文本 / 占位图即红。
    const MAIN_SRC = /^\/assets\/products\/P-00[1-8]\.jpg$/;
    const expected = Array.from({ length: 8 }, (_, i) => `P-00${i + 1}.jpg`);
    const onDisk = globSync('web/assets/products/*.jpg', { cwd: REPO_ROOT }).map((p) => basename(p)).sort();
    assert.deepStrictEqual(
      onDisk,
      expected,
      `web/assets/products/ 下必须恰是这 8 张自托管主图 P-001.jpg…P-008.jpg，实际 ${JSON.stringify(onDisk)}`,
    );
    // 接口原文是「.jpg **替换**原 8 张 .svg」⇒ 旧占位图不得残留（作用域限定在 web/assets/products/P-00N 这一点上）
    const staleSvg = globSync('web/assets/products/P-00[1-8].svg', { cwd: REPO_ROOT });
    assert.deepStrictEqual(
      staleSvg,
      [],
      `原自制 SVG 主图必须已被 .jpg 替换（不得残留），实际仍在：${JSON.stringify(staleSvg)}`,
    );
    for (const name of onDisk) {
      const buf = readFileSync(join(REPO_ROOT, 'web/assets/products', name));
      assert.ok(buf.length > 0, `${name} 不得是空文件`);
      assert.deepStrictEqual(
        [...buf.subarray(0, 3)],
        [0xff, 0xd8, 0xff],
        `${name} 必须是**真 JPEG**（SOI + 段标记，头 3 字节 FF D8 FF），实际 ${[...buf.subarray(0, 4)].map((b) => b.toString(16).padStart(2, '0')).join(' ')}`,
      );
      // 尺寸口径（有依据，不写无依据阈值）：ui-spec §九「正方形 400×400」+ `UI-12` 的 `aspect-ratio: 1/1`
      // ⇒ 按 JPEG 结构解析 SOF 段取宽高，断言「正方形 + 边长 ≥ 400（400 是**下限**，dev 实际可用 800×800）」。
      const size = jpegSize(buf);
      assert.ok(size, `${name} 必须含可解析的 JPEG SOF 段（真位图；只有文件头像 JPEG 不算），实际解析失败`);
      assert.equal(
        size.width,
        size.height,
        `${name} 必须正方形（ui-spec UI-12 的 aspect-ratio 1/1），实际 ${size.width}×${size.height}`,
      );
      assert.ok(
        size.width >= 400,
        `${name} 边长必须 ≥ 400（ui-spec §九 照片规格 400×400 作下限，允许 800×800 等更大正方形），实际 ${size.width}`,
      );
    }
    await withApp({ dbPath }, async (app) => {
      const client = newClient(app);
      const products = await listProducts(client);
      // ② 盘上 8 个文件与种子商品 id 双向一一对应（页面 src 判据以 id 为基，不靠标题文本 —— 照片没有 <title>）
      const ids = products.map((p) => String(p.id)).sort();
      assert.deepStrictEqual(
        ids,
        expected.map((n) => n.replace(/\.jpg$/, '')),
        `种子商品 id 必须恰为 P-001…P-008（页面主图 src 判据以此为基），实际 ${JSON.stringify(ids)}`,
      );
      // ③ 首帧主图 src 必须全是**同源 .jpg**（剥掉 ?v= 指纹后逐条命中冻结判据），且 8 张都在首帧直写
      const { html, css, modules } = await face(app);
      const dom = new JSDOM(html.raw);
      const frameSrcs = [...dom.window.document.querySelectorAll('img[src^="/assets/products/"]')].map((el) =>
        String(el.getAttribute('src')),
      );
      assert.equal(frameSrcs.length, 8, `首帧必须直写 8 张主图 <img>（禁用 JS 也可加载），实际 ${frameSrcs.length}`);
      assert.deepStrictEqual(
        [...new Set(frameSrcs.map((s) => s.split('?')[0]))].sort(),
        expected.map((n) => `/assets/products/${n}`),
        `首帧主图 src 必须恰是这 8 个同源 .jpg 路径，实际 ${JSON.stringify(frameSrcs)}`,
      );
      for (const src of frameSrcs) {
        const [path, query] = src.split('?');
        assert.match(
          path,
          MAIN_SRC,
          `首帧主图 src（剥掉查询串后的路径部分）必须逐字命中 ${MAIN_SRC}（本仓自托管 .jpg + 同源相对路径），实际 ${src}`,
        );
        assert.equal(/^(?:https?:)?\/\//i.test(src), false, `主图 src 不得指向外部 host（自托管的收益就是零外链），实际 ${src}`);
        // 查询串**只允许**内容指纹 `?v=<hash>`（契约 §七）。不追加这条，「先剥查询串再匹配路径」就成了万能放行口。
        // hash 形态按 `[A-Za-z0-9_-]{6,}` 判（不锁死十六进制：契约只写 `<hash>`）：`?x=1` / `?v=0`（指纹退化成常量）都红。
        if (query !== undefined) {
          assert.match(
            query,
            /^v=[A-Za-z0-9_-]{6,}$/,
            `主图 src 的查询串只允许内容指纹 ?v=<hash>（≥6 位 hash 形态），实际 ?${query}`,
          );
        }
      }
      // 一一对应只按「卡 ↔ 卡内商品 id」断：照片是二进制、读不出商品名，题材是否对货属语义判断（机器判不了，归人工看图留痕）。
      const cards = [...dom.window.document.querySelectorAll('li.card[data-product-id]')];
      assert.equal(cards.length, 8, `首帧必须有 8 张商品卡（逐卡配对判据的分母），实际 ${cards.length}`);
      for (const card of cards) {
        const id = String(card.getAttribute('data-product-id'));
        const img = card.querySelector('img[src^="/assets/products/"]');
        assert.ok(img, `商品卡 ${id} 必须含主图 <img>`);
        assert.equal(
          String(img.getAttribute('src')).split('?')[0],
          `/assets/products/${id}.jpg`,
          `商品卡 ${id} 的主图 src 必须与本卡商品 id 一致（对应关系只能按卡断），实际 ${img.getAttribute('src')}`,
        );
      }
      // ④ 运行期引用（JS 模块模板串 / CSS）不得再残留非 .jpg 主图 —— 否则 JS 渲染的卡片会 404（首帧判据看不见）
      //    作用域限定在 `/assets/products/` 这一点上，绝不写成「全文不得有 .svg」（favicon.svg 是合法的）。
      const runtimeRefs = new Set([
        ...[...String(modules).matchAll(/\/assets\/products\/[^"'`)\s\\]*/g)].map((m) => m[0]),
        ...[...String(css).matchAll(/\/assets\/products\/[^"'`)\s\\)]*/g)].map((m) => m[0]),
      ]);
      for (const ref of runtimeRefs) {
        const clean = ref.split('?')[0];
        if (/\.(svg|png|webp|gif|jpeg)$/i.test(clean)) {
          assert.fail(`/assets/products/ 下的运行期主图引用不得是 ${clean.split('.').pop()}（本包主图统一 .jpg），实际 ${ref}`);
        }
        const at = String(modules).indexOf(ref);
        const spliced = at >= 0 ? String(modules).slice(at, at + 120) : '';
        assert.ok(
          /\.jpg$/.test(clean) || (clean === '/assets/products/' && /\.jpg/.test(spliced)),
          `/assets/products/ 下的运行期主图引用必须以 .jpg 结尾（允许模板 ${'${…}'} 插值 / 字符串拼接），实际 ${ref}`,
        );
      }
      // ⑤ 来源与许可：CREDITS.md 必须存在；8 个本地文件名各有**一条**登记，且同一条内含许可名；
      //    登记的文件名与盘上 8 张一一对应（多登记盘上不存在的文件即红）。
      assert.ok(
        repoFileExists('web/assets/products/CREDITS.md'),
        '必须有 web/assets/products/CREDITS.md（8 张照片的来源与许可登记）',
      );
      const credits = repoText('web/assets/products/CREDITS.md');
      // UI-67 + 主控 2026-10-16 裁定（收紧为**逐行 6 项**）：每张图**各自那一行**必须同时给出
      //   ① 本地文件名 ② **商品名** ③ **作者** ④ **来源页 URL**（照片页，非许可类）⑤ **许可名** ⑥ **许可 URL**。
      // 为什么必须逐行：CREDITS 是合规署名件（`by` / `by-sa` 要求署名），只有全文一条 URL 时「哪个 URL 属于哪张图」无法复核，达不到署名目的。
      // 解析口径做成格式无关：表格行（`|`）/ 破折号·间隔号·全角竖线分隔 / 项目符号行都读；markdown 链接 `[文本](url)` 与尖括号自动链接按**链接文本**剥壳后再分类。
      // 「商品名」按**结构**判（该行除作者外还有一个非 URL / 非许可 / 非文件名的文本字段），**不**按种子商品名硬匹配 —— 商品改名 / 文案调整不该判红。
      // 注意：CREDITS.md 里的来源站 URL **不属于** AC-52 的禁用清单（那断淘宝系域名与运行期引用），两处不打架。
      const license = /(CC[\s-]?BY|CC0|public\s*domain|公有领域|Unsplash|Pexels|Pixabay|License|许可|授权|版权)/i;
      // ⚠ 作者判定**不得**用裸 `by` 作标注：`CC BY 2.0` 里就有「BY」，会让「无作者」的行被误判为合规（自查抓到的洞）⇒ 只认「作者 / 摄影 / Photo by / credit / ©」。
      const licenseUrl = /(creativecommons|licen[cs]e|publicdomain|public-domain|\/cc0|by-sa|by-nc|by-nd)/i;
      const isUrl = (cell) => /https?:\/\//i.test(cell);
      const labelValue = (line, re) => (line.match(re) ?? [])[1]?.trim();
      const PRODUCT_LABEL = /(?:商品名|商品|品名|product\s*name)\s*[:：]\s*([^|｜—–·\t]+)/i;
      const AUTHOR_LABEL = /(?:作者|摄影|拍摄|Photo\s*by|credit)\s*[:：]\s*([^|｜—–·\t]+)/i;
      const fieldsOf = (line) =>
        line
          .replace(/^\s*[-*+]\s*/, '')
          .replace(/^\s*\|/, '')
          .replace(/\|\s*$/, '')
          .split(/\s*\|\s*|\s*(?:—|–|·|｜)\s*|\s+\/\s+|\t+/)
          .map((cell) =>
            cell
              .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
              .replace(/^<(.*)>$/, '$1')
              .replace(/\\\|/g, '|')
              .trim(),
          )
          .filter((cell) => cell.length > 0 && !/^[:\-|\s]+$/.test(cell));
      const lineOf = (text, idx) => text.slice(text.lastIndexOf('\n', idx) + 1).split('\n')[0];
      for (const name of expected) {
        const at = credits.indexOf(name);
        assert.ok(at >= 0, `CREDITS.md 必须登记 ${name} 的来源与许可`);
        const line = lineOf(credits, at);
        assert.match(line, license, `CREDITS.md 里 ${name} **那一行**必须含许可名（6 项之一），实际：「${line.trim()}」`);
        // **来源页** URL 必须逐行各自登记，且**不能拿「许可 URL」顶替**：只写 `creativecommons.org/licenses/...` 时「哪个来源页属于哪张图」依然无法复核
        // （本轮自查抓到的第二个洞：原判据只看行内有没有 `https://`，许可 URL 就能顶掉来源页）。许可类 URL 按关键词识别；带「来源页：<URL>」显式标注的写法仍接受。
        const urls = [...line.matchAll(/https?:\/\/[^\s|)]+/gi)].map((m) => m[0]);
        assert.ok(
          urls.some((u) => !licenseUrl.test(u)) ||
            /(来源页|来源|出处|source|photo\s*page)\s*[:：]?\s*https?:\/\//i.test(line),
          `CREDITS.md 里 ${name} **那一行**必须含**来源页 URL**（照片页，6 项之一；逐行各自登记，不得只在文件某处给一条，也不得用许可 URL 顶替，UI-67 / R-2）。该行 URL：${JSON.stringify(urls)}，实际：「${line.trim()}」`,
        );
        // ⑥ **许可 URL**（6 项之一）：该行须另有许可类 URL（`creativecommons.org/licenses/...` 等）—— 缺它 = 真源判不合格。
        assert.ok(
          urls.some((u) => licenseUrl.test(u)),
          `CREDITS.md 里 ${name} **那一行**必须含**许可 URL**（6 项之一：\`creativecommons.org\` 等许可类 URL）。该行 URL：${JSON.stringify(urls)}，实际：「${line.trim()}」`,
        );
        // R-4（主控裁定**只机器化这一半**）：URL 不得写成 HTML 实体 —— `&amp;` 是真错（URL 里的 `&` 应为字面 `&`），可判定；
        // 「URL 被换行 / 空格截断」无可靠机器判据，**不造假护栏**，维持文档要求。
        assert.ok(
          urls.every((u) => !/&amp;/i.test(u)),
          `CREDITS.md 里 ${name} **那一行**的 URL 不得写成 HTML 实体（R-4：\`&amp;\` 应为字面 \`&\`）。该行 URL：${JSON.stringify(urls)}`,
        );
        const fields = fieldsOf(line);
        const textFields = fields.filter((cell) => !isUrl(cell) && !license.test(cell) && !cell.includes(name));
        // ② **商品名**（6 项之一）：带「商品名：」标注，或该行有 ≥2 个非 URL / 非许可 / 非文件名的文本字段（商品名 + 作者，R-1 / R-3）。
        assert.ok(
          Boolean(labelValue(line, PRODUCT_LABEL)) || textFields.length >= 2,
          `CREDITS.md 里 ${name} **那一行**必须含**商品名**（6 项之一）：或带「商品名：」标注，或该行含 ≥2 个非 URL / 非许可 / 非文件名的文本字段（= 商品名 + 作者）。实际字段：${JSON.stringify(fields)}`,
        );
        // ③ **作者**（6 项之一，R-3）：带「作者 / 摄影 / Photo by / credit」标注、含 `©`，或同上 ≥2 个文本字段。
        assert.ok(
          Boolean(labelValue(line, AUTHOR_LABEL)) || textFields.length >= 2 || /©/.test(line),
          `CREDITS.md 里 ${name} **那一行**必须含**作者**（6 项之一；R-3）：或带「作者 / 摄影 / Photo by / credit / ©」等标注，或该行含 ≥2 个非 URL / 非许可 / 非文件名的文本字段（= 商品名 + 作者）。实际字段：${JSON.stringify(fields)}`,
        );
      }
      for (const name of new Set([...credits.matchAll(/P-00[1-8]\.jpg/gi)].map((m) => m[0]))) {
        assert.ok(expected.includes(name), `CREDITS.md 不得登记盘上不存在的文件 ${name}`);
      }
    });
  });
});

test('演示标注显式（AC-53）', async () => {
  await withTempDb(async ({ dbPath }) => {
    await withApp({ dbPath }, async (app) => {
      const { all } = await face(app);
      assert.ok(all.includes('演示'), '界面至少一处必须出现含「演示」的支付标注');
      const docs = globSync('docs/*.md', { cwd: REPO_ROOT }).concat(['README.md'].filter((p) => repoFileExists(p)));
      assert.ok(docs.length > 0, '交付仓必须含使用 / 部署文档');
      const docText = docs.map((rel) => repoText(rel)).join('\n');
      assert.ok(/假支付|演示/.test(docText), '文档必须出现「假支付 / 演示」说明');
      // 不得把真实资金流当事实陈述（「实付」是规格定稿的购物车行标签，不计入本负向清单，见报告口径分歧）
      for (const claim of ['已收款', '真实扣款完成', '实际支付成功', '真实支付成功', '已到账']) {
        assert.equal(all.includes(claim), false, `界面不得出现暗示真实资金流的表述「${claim}」`);
      }
    });
  });
});

test('UI行为继承（AC-54）', async () => {
  await withTempDb(async ({ dbPath }) => {
    await withApp({ dbPath }, async (app) => {
      const { all, html, modules } = await face(app);
      const products = await listProducts(newClient(app));
      // ① 首帧不裸模板 + 件数与种子一致
      assert.equal(html.raw.includes('{{'), false, '首帧 HTML 不得残留裸模板占位符 {{');
      assert.ok(
        html.raw.includes(`共 ${products.length} 件商品`),
        `首帧必须出现逐字「共 N 件商品」（N=种子条数），实际首帧缺少该文案`,
      );
      // ② 上限禁用态：源码必须有与上限 8 绑定的 disabled 判定
      assert.match(
        modules,
        /disabled[\s\S]{0,200}(8|quantityLimit|MAX_QUANTITY)|(8|quantityLimit|MAX_QUANTITY)[\s\S]{0,200}disabled/,
        '上限 8 件的「＋」必须带禁用态判定（disabled 与上限绑定）',
      );
      // ③ 三类错误提示关键字（文案取自服务端 message，故断服务端词表字面）
      const serverText = globSync('server/**/*.mjs', { cwd: REPO_ROOT }).map((rel) => readRepoFile(rel)).join('\n');
      for (const keyword of ['购物车是空的', '库存不足', '找不到该商品']) {
        assert.ok(serverText.includes(keyword), `三类错误提示必须含既定关键字「${keyword}」`);
      }
      assert.ok(/message/.test(modules), '错误提示必须原样使用服务端 message');
      // ④ 件数徽标 = 服务端 quantityTotal
      assert.ok(modules.includes('quantityTotal'), '件数徽标必须取服务端 quantityTotal');
      // ⑤ 五个功能面的哈希路由均可达
      const routes = ['#/cart', '#/orders', '#/me', '#/login'];
      for (const route of routes) {
        assert.ok(all.includes(route), `哈希路由必须可达，缺 ${route}`);
      }
      assert.ok(
        all.includes('#/products') || /#\/["'`]/.test(all),
        '首页哈希路由必须存在（#/products 或 #/）',
      );
      assert.equal((await newClient(app).get('/')).status, 200, '五个哈希路由共用同一首帧文档，GET / 必须 200');
    });
  });
});
