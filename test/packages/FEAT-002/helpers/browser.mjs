/**
 * 装置：在 jsdom 里**真执行**本仓前端 ES 模块（hash 路由 / 本地筛选 / 底部 Tab 的行为断言用）。
 *
 * 为什么需要它：jsdom **不支持** `<script type="module">` 执行，`new JSDOM(html)` 只能断首帧静态结构；
 * 而 `AC-57`~`AC-61` 的判据是「按 hash 路由渲染 / 输入搜索框本地筛选 / 切换筛选胶囊」这类**脚本接手后**的行为，
 * 用「源码里有没有这段字符串」去断会是**假绿**。故：把首帧 HTML 交给 jsdom，装上全局对象与 fetch 包装后
 * `import()` 真入口模块（原生 ESM，无构建步骤），再看真实 DOM。
 *
 * 纪律：
 *  · 只断 DOM / 文案 / hash / 请求序列（PRD 明写机器层口径）；布局、观感、真机交互归 UAT。
 *  · 前端发出的每个请求都记账（`requests`），用于「本地筛选不得产生请求」这类判据。
 *  · 需要登录态时由调用方传入 cookie（本装置不自己登录，避免把鉴权逻辑复制进前端测试）。
 *  · **装载隔离**（2026-10-16 修装置缺陷，dev 最小复现：`--test-name-pattern="订单详情页|空车结算页自动回购物车"` ⇒ 顺序相关假红）：
 *    ① 前端模块是**进程内单例**（ESM 模块只求值一次），只给 `main.mjs` 加 `?t=N` 破缓存时，`state.mjs` / 各页面模块
 *       仍被上一个 mount 复用 ⇒ 上一个用例的**迟到渲染会写进下一个用例的状态**。故本装置把 `web/src` **整棵树**
 *       拷到一个独立临时目录再 import —— 每个 mount 的**每一个模块 URL 都不同**，跨 mount 状态从根上不存在。
 *    ② `close()` 前必须**排空**：等在途请求归零 + DOM 连续稳定（`settle({ drain: true })`）并留一个静默期，
 *       否则「上一个 mount 的迟到续体」会通过 `globalThis.window` 改写**当前**窗口的 hash（`AC-59` 的形态就是
 *       前一个 mount 的 checkout 分支迟到地把 hash 置成 `#/cart`）。
 *  · 全局对象在 `close()`（**异步**）时恢复原状，不污染同文件内后续用例。
 *  · 关闭后落地的 Promise 拒绝只记入 `strayRejections`，绝不让测试进程因装置迟到而崩。
 */
import { JSDOM } from 'jsdom';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO_ROOT, getHtml } from './harness.mjs';

const HANDOFF_GLOBALS = [
  'document',
  'location',
  'history',
  'HTMLElement',
  'Event',
  'CustomEvent',
  'HashChangeEvent',
  'Node',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame',
];
const BORROWED = ['Response', 'Headers', 'Request', 'AbortController'];

/** 记录原值以便恢复（Node 里 `navigator` 等是只读访问器 ⇒ 只能用 defineProperty）。 */
function snapshot(names) {
  const saved = new Map();
  for (const name of names) saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  return saved;
}
function restore(saved) {
  for (const [name, desc] of saved) {
    if (desc === undefined) delete globalThis[name];
    else Object.defineProperty(globalThis, name, desc);
  }
}
/**
 * 条件式还原：只回退「本 mount 装上去、且当前仍是它」的全局名。
 * 仍在使用的更新 mount（或已被更新的 mount 覆盖的名字）不动 ⇒ 不会把别人的包装/窗口写回全局。
 */
function restoreOwn(installed) {
  for (const [name, mine] of installed) {
    if (globalThis[name] !== mine) continue;
    const desc = ORIGINAL.get(name);
    if (desc === undefined) delete globalThis[name];
    else Object.defineProperty(globalThis, name, desc);
  }
  if (globalThis.fetch === undefined) put('fetch', REAL_FETCH);
}
function put(name, value) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

let mountSeq = 0;

/**
 * 模块加载时**一次性**捕获原生全局。
 *
 * 为什么不能逐 mount 快照（2026-10-16 查明的**真正根因**）：一个用例**同时开着两个 mount** 时（AC-57 的 `pageB` + `pageX`），
 * 后者的快照会把**前者的 fetch 包装**记成「原值」⇒ AC-57 结束后全局 `fetch` 被还原成**仍绑着 AC-57 会话 cookie 的包装**，
 * 下一个用例（AC-59）的前端就带着**上一个用例的 sid** 发请求 ⇒ 服务端 401、页面按未登录渲染（0 张订单卡 / 空车回退）。
 * 症状：同一 app、同一 origin，客户端 `/auth/me` 200 而浏览器侧 401。⇒ 包装必须永远包在**原生** fetch 上，还原也必须回到原生。
 */
const ORIGINAL = snapshot([...HANDOFF_GLOBALS, 'window', 'navigator', 'fetch', ...BORROWED]);
const REAL_FETCH = ORIGINAL.get('fetch').value;
let fetchOwner = null;
/** 当前打开的 mount（正常情况下同一时刻只有一个）：未归属的 Promise 拒绝归给它们，便于定位前端异常。 */
const openMounts = new Set();
/** mount 关闭后才落地的拒绝（装置迟到）：只记录，不崩进程、不污染用例断言。 */
export const strayRejections = [];
process.on('unhandledRejection', (reason) => {
  const text = String(reason?.stack ?? reason);
  if (openMounts.size === 0) strayRejections.push(text);
  else for (const mount of openMounts) mount.errors.push(text);
});

/**
 * 装载一次前端：返回可驱动的句柄。
 *
 * @param {{port: number}} app 由 `startApp` / `withApp` 起的实例（或任意带 `port` 的对象）
 * @param {{hash?: string, cookie?: string, hold?: boolean, settleMs?: number, timeoutMs?: number}} options
 */
export async function mountBrowser(
  app,
  { hash = '#/products', cookie = '', hold = false, settleMs = 60, timeoutMs = 6000 } = {},
) {
  const html = await getHtml(app, '/');
  const raw = html.raw ?? html;

  // ① 整张模块图破缓存（见文件头「装载隔离」①）：拷贝整棵 web/src 到独立目录，import 副本入口。
  mountSeq += 1;
  const isolatedRoot = mkdtempSync(join(tmpdir(), `feat002-web-${mountSeq}-`));
  cpSync(join(REPO_ROOT, 'web/src'), isolatedRoot, { recursive: true });

  /** 本 mount 装到全局上的值：还原时只回退「当前仍是我的」那些，避免踩掉仍在使用的更新 mount。 */
  const installed = new Map();
  const dom = new JSDOM(raw, {
    url: `http://127.0.0.1:${app.port}/${hash}`,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const requests = [];
  /** 每个请求的 `{ path, status }`（诊断用：定位「页面为何看不到数据」——401？404？空集合？）。 */
  const exchanges = [];
  const errors = [];
  const inflight = new Set();
  const mount = { errors };
  openMounts.add(mount);
  let closed = false;

  const claim = (name, value) => {
    put(name, value);
    installed.set(name, value);
  };
  for (const name of HANDOFF_GLOBALS) if (window[name] !== undefined) claim(name, window[name]);
  claim('window', window);
  claim('navigator', window.navigator);
  const realFetch = REAL_FETCH; // **原生** fetch（不是上一个 mount 的包装）
  // `hold`：把前端发出的请求**全部挂起**，好在「数据未返回」这一瞬间取 DOM（UI-53 加载占位 / AC-57 ① 的时序判据）。
  let releaser = null;
  const gate = hold ? new Promise((resolve) => { releaser = resolve; }) : null;
  const wrapped = (input, init = {}) => {
    const url = new URL(String(input), `http://127.0.0.1:${app.port}`);
    requests.push(url.pathname + url.search);
    const headers = { ...(init.headers ?? {}) };
    if (cookie) headers.cookie = cookie;
    const fire = () => {
      const pending = realFetch(url, { ...init, headers });
      inflight.add(pending);
      const done = () => inflight.delete(pending);
      const note = (status) =>
        exchanges.push({
          origin: url.origin,
          path: url.pathname + url.search,
          status,
          // 只记「有没有注入、多长」，不记会话值本身（避免把凭据写进测试日志）
          cookie: headers.cookie ? `${String(headers.cookie).split('=')[0]}:${String(headers.cookie).length}` : 'none',
        });
      pending.then(
        (res) => {
          note(res.status);
          inflight.delete(pending);
        },
        (err) => {
          note(String(err?.name ?? err));
          inflight.delete(pending);
        },
      );
      return pending;
    };
    return gate ? gate.then(fire) : fire();
  };
  claim('fetch', wrapped);
  fetchOwner = wrapped;
  window.fetch = wrapped;
  for (const name of BORROWED) if (globalThis[name] === undefined && window[name] !== undefined) claim(name, window[name]);
  const onError = (event) => errors.push(String(event?.error?.stack ?? event?.message ?? event));
  window.addEventListener('error', onError);

  const bodyText = () => (window.document.body ? window.document.body.textContent : '');
  /**
   * 等 DOM **真**落定：在途请求归零（`drain` 时）+ 连续两次取样无变化。
   * 只断「文本稳定」不够 —— 首帧 HTML 本来就有内容 ⇒ 会抢在前端 boot 完成前返回（这正是迟到续体的来源）。
   */
  const settle = async ({ drain = false, stablePolls = 2, ms = settleMs } = {}) => {
    const deadline = Date.now() + timeoutMs;
    let prev = null;
    let stable = 0;
    for (;;) {
      const now = bodyText();
      const idle = !drain || inflight.size === 0;
      if (idle && now === prev) {
        stable += 1;
        if (stable >= stablePolls) return;
      } else {
        stable = 0;
      }
      prev = now;
      if (Date.now() > deadline) {
        throw new Error(
          `等待前端渲染稳定超时（${timeoutMs}ms）：正文 ${now.length} 字；在途请求 ${inflight.size} 个；` +
            `前端异常 ${JSON.stringify(errors).slice(0, 300)}；装置迟到拒绝 ${strayRejections.length} 条`,
        );
      }
      await new Promise((r) => setTimeout(r, ms));
    }
  };

  const releaseHold = () => {
    if (releaser) {
      const fire = releaser;
      releaser = null;
      fire();
    }
  };

  try {
    await import(`file://${join(isolatedRoot, 'main.mjs')}`);
    // `hold` 时首屏数据永远不返回 ⇒ 不自动等稳定（只在「数据未返回」这一刻取样）
    if (!hold) await settle({ drain: true });
  } catch (err) {
    openMounts.delete(mount);
    releaseHold();
    restoreOwn(installed);
    if (fetchOwner === wrapped) fetchOwner = null;
    rmSync(isolatedRoot, { recursive: true, force: true });
    throw err;
  }

  const assertOpen = () => {
    if (closed) throw new Error('mountBrowser 句柄已关闭（close() 之后不得再驱动）');
  };

  /** 只算**可见**文本：跳过 `hidden` 子树与 `display:none` / `visibility:hidden` 行内样式，避免隐藏占位造成假绿。 */
  const visibleText = () => {
    const walk = (node) => {
      if (node.nodeType === 3) return node.nodeValue ?? '';
      if (node.nodeType !== 1) return '';
      if (node.hasAttribute('hidden')) return '';
      const style = node.getAttribute('style') ?? '';
      if (/display\s*:\s*none/i.test(style) || /visibility\s*:\s*hidden/i.test(style)) return '';
      return [...node.childNodes].map(walk).join(' ');
    };
    return walk(window.document.body ?? window.document.documentElement);
  };

  return {
    window,
    document: window.document,
    get location() {
      return window.location;
    },
    requests,
    exchanges,
    errors,
    settle,
    /** 切路由：设 hash 并补发 hashchange（jsdom 对 hash 赋值的 hashchange 派发不保证同步）。 */
    async navigate(next) {
      assertOpen();
      window.location.hash = next;
      window.dispatchEvent(new window.HashChangeEvent('hashchange'));
      await settle({ drain: true });
      return window.location.hash;
    },
    text: bodyText,
    visibleText,
    /** 放行被 `hold` 挂起的请求，并等渲染落定。 */
    async release() {
      assertOpen();
      releaseHold();
      await settle({ drain: true });
    },
    /** 只改 hash + 派 hashchange，**不等**渲染（用于「数据未返回」这一刻取样）。 */
    poke(next) {
      assertOpen();
      window.location.hash = next;
      window.dispatchEvent(new window.HashChangeEvent('hashchange'));
    },
    count: (selector) => window.document.querySelectorAll(selector).length,
    /** 底部 Tab 的选中项（`data-tab` 值数组）。 */
    activeTab: () =>
      [...window.document.querySelectorAll('.tabbar__item')]
        .filter((a) => /\bis-active\b/.test(a.className))
        .map((a) => a.dataset.tab),
    /** 输入框里打字（派发 input 事件），用于本地筛选类判据。 */
    async type(selector, value) {
      assertOpen();
      const input = window.document.querySelector(selector);
      if (!input) throw new Error(`找不到输入框 ${selector}`);
      input.value = value;
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
      await settle({ drain: true });
    },
    /** 按逐字文案点元素（胶囊 / 按钮），返回是否点到。 */
    async clickText(label, selector = 'button, a, [role="tab"], [role="button"]') {
      assertOpen();
      // 匹配口径：**全等优先，子串回退**（2026-10-16 dev 只读取证：`W-39` 冻结的按钮字面是「提交订单 ¥ 129.00」
      //   ⇒ 只做全等会永远点不到，而 `ui.test.mjs` 要求子串 ⇒ 装置必须能按子串命中；全等优先以免误点更长的近义项）。
      const exact = label;
      const nodes = [...window.document.querySelectorAll(selector)];
      const hit = nodes.find((el) => el.textContent.trim() === exact) ?? nodes.find((el) => el.textContent.trim().includes(exact));
      if (!hit) return false;
      hit.click();
      await settle({ drain: true });
      return true;
    },
    /**
     * **异步**关闭：先排空在途请求与迟到渲染（`drain` + 静默期），再恢复全局、关窗口、删副本。
     * 排空必须在恢复全局**之前** —— 否则迟到续体会读到「下一个 mount」的 `window`/`document` 并改写它。
     */
    async close() {
      if (closed) return;
      closed = true;
      releaseHold();
      try {
        await settle({ drain: true, stablePolls: 3, ms: 40 });
      } catch {
        // 关不干净也不该让用例红：排空是**尽力而为**，真正的隔离由「整图破缓存」保证。
      }
      await new Promise((r) => setTimeout(r, 50)); // 静默期：让尾部 microtask / 短定时器落地
      window.removeEventListener('error', onError);
      openMounts.delete(mount);
      restoreOwn(installed);
      if (fetchOwner === wrapped) {
        fetchOwner = null;
        put('fetch', REAL_FETCH); // 全局 fetch 回到**原生**（绝不留在任何 mount 的包装上）
      }
      dom.window.close();
      rmSync(isolatedRoot, { recursive: true, force: true });
    },
  };
}
