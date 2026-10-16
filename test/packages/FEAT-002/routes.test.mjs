/**
 * 路由与本地过滤的行为面：订单详情页 / 账号三页 / 空车结算页 / 本地筛选不出网 / 订单状态筛选。
 *
 * 装置纪律：这五条判据要的是**脚本接手后**的真实 DOM / hash / 请求序列，故用 `helpers/browser.mjs`
 * 在 jsdom 里真执行本仓前端 ESM（jsdom 不支持 `<script type="module">`，首帧静态断言覆盖不到这些行为）。
 * 只断 DOM / 文案 / hash / 请求序列（PRD 明写的机器层口径）；布局、观感与真机交互归 UAT。
 * 商品名一律**按 `DEFAULT_SEED` 推导**，不硬编码名字、不依赖夹具主键（PROJECT.md 口径）。
 *
 * @prd FEAT-002
 * @prdVersion 3
 * @priority P0
 * @status active
 * @case TC-FEAT-002-57
 * @case TC-FEAT-002-58
 * @case TC-FEAT-002-59
 * @case TC-FEAT-002-60
 * @case TC-FEAT-002-61
 * @case TC-FEAT-002-66
 * @case TC-FEAT-002-67
 * @case TC-FEAT-002-68
 * @case TC-FEAT-002-69
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SEED } from '../../../server/src/seed.mjs';
import {
  getStyleText,
  addItem,
  getHtml,
  getOrders,
  newClient,
  payload,
  productAt,
  registerOrFail,
  uniqueEmail,
  withApp,
  withTempDb,
} from './helpers/harness.mjs';
import { mountBrowser } from './helpers/browser.mjs';

const PW = 'Pw-FEAT002-abcdefgh';
const money = (cents) => (cents / 100).toFixed(2);
/** 下单一次，返回订单对象（`orderNo` 是详情路由的唯一键）。 */
async function placeOrder(client, index = 0) {
  const target = await productAt(client, index);
  assert.equal((await addItem(client, target.id, 1)).status, 201, '前置：加购必须 201');
  const res = await client.post('/api/v1/orders');
  assert.equal(res.status, 201, `前置：下单必须 201，实际 ${res.status}：${res.raw.slice(0, 160)}`);
  return payload(res);
}

test('订单详情页（AC-57）', async () => {
  // 判据（PRD `AC-57`）：`#/orders/N_A` 先出逐字「加载中…」→ 数据返回后出订单内容（逐字「订单号 N_A」+ 时间 + 商品行 + 「合计」）、
  // 底部 Tab「订单」选中；`N_B`（他人订单）与 `N_X`（不存在）都必须**逐字「订单不存在」**、**不得出现任何订单内容**、
  // 不得差别化成「无权访问」；②③ 的文案与结构**完全一致**（不暴露存在性）。
  await withTempDb(async ({ dbPath }) => {
    await withApp({ dbPath }, async (app) => {
      const ownerA = newClient(app);
      await registerOrFail(ownerA, uniqueEmail('ac57a'), PW);
      const orderA = await placeOrder(ownerA, 0);
      const ownerB = newClient(app);
      await registerOrFail(ownerB, uniqueEmail('ac57b'), PW);
      const orderB = await placeOrder(ownerB, 1);
      const missing = 'NOPE-NOT-EXIST';
      assert.notEqual(orderA.orderNo, orderB.orderNo, '前置：两单订单号必须不同');

      // ①「数据未返回时内容区出现逐字「加载中…」」：把前端请求全部挂起，在「数据未返回」这一刻取 DOM。
      //    首帧 HTML **不含**该文案（SPA 的加载占位由脚本渲染）⇒ 只能在请求未返回的瞬间取样，故用 hold + poke。
      const pageA = await mountBrowser(app, {
        hash: `#/orders/${orderA.orderNo}`,
        cookie: ownerA.cookieHeader(),
        hold: true,
      });
      try {
        pageA.poke(`#/orders/${orderA.orderNo}`); // 触发一次渲染，此时数据仍未返回
        await new Promise((r) => setTimeout(r, 150));
        assert.ok(
          pageA.visibleText().includes('加载中…'),
          `① 数据未返回时内容区必须出现逐字「加载中…」（UI-53），实际「${pageA.visibleText().slice(0, 240)}」`,
        );
        await pageA.release();
        assert.equal(
          pageA.location.hash,
          `#/orders/${orderA.orderNo}`,
          '① 必须停在订单详情路由（不得被静默重定向走）',
        );
        const textA = pageA.text();
        assert.ok(
          textA.includes('订单号') && textA.includes(orderA.orderNo),
          `① 必须出现逐字「订单号 ${orderA.orderNo}」，实际「${textA.slice(0, 240)}」`,
        );
        assert.ok(textA.includes('合计'), `① 必须出现「合计」行，实际「${textA.slice(0, 240)}」`);
        assert.ok(
          textA.includes(money(orderA.totalCents)),
          `①「合计」金额必须等于订单实付（${money(orderA.totalCents)}），实际「${textA.slice(0, 240)}」`,
        );
        assert.ok(/下单时间|时间/.test(textA), `① 必须出现下单时间，实际「${textA.slice(0, 240)}」`);
        for (const item of orderA.items) {
          assert.ok(
            textA.includes(item.productName),
            `① 必须出现商品行「${item.productName}」，实际「${textA.slice(0, 240)}」`,
          );
        }
        assert.deepStrictEqual(
          pageA.activeTab(),
          ['orders'],
          `① 底部 Tab「订单」必须为选中项，实际 ${JSON.stringify(pageA.activeTab())}`,
        );
      } finally {
        await pageA.close();
      }

      // ②③ 他人订单号 / 不存在的订单号：同一条「订单不存在」，且两者文案与结构完全一致
      const pageB = await mountBrowser(app, { hash: `#/orders/${orderB.orderNo}`, cookie: ownerA.cookieHeader() });
      const pageX = await mountBrowser(app, { hash: `#/orders/${missing}`, cookie: ownerA.cookieHeader() });
      try {
        const textB = pageB.text();
        const textX = pageX.text();
        assert.match(textB, /订单不存在/, `② 访问他人订单必须逐字「订单不存在」，实际「${textB.slice(0, 240)}」`);
        assert.match(textX, /订单不存在/, `③ 访问不存在订单必须逐字「订单不存在」，实际「${textX.slice(0, 240)}」`);
        assert.equal(
          textB,
          textX,
          '②③ 的文案必须**完全一致**（不得按「存在但无权」与「不存在」差别化提示）',
        );
        assert.equal(
          /无权访问|无权限|没有权限|403/.test(textB),
          false,
          `②③ 不得出现差别化的「无权访问」类文案，实际「${textB.slice(0, 240)}」`,
        );
        for (const [label, page] of [['②', pageB], ['③', pageX]]) {
          const text = page.text();
          assert.equal(
            text.includes(orderB.orderNo),
            false,
            `${label} 不得展示被访问订单的任何内容（订单号不得出现）`,
          );
          assert.equal(text.includes('合计'), false, `${label} 不得出现「合计」等订单内容`);
        }
      } finally {
        await pageB.close();
        await pageX.close();
      }
    });
  });
});

test('账号三页可达且标记一致（AC-58）', async () => {
  // 判据（PRD `AC-58`）：`#/login` / `#/register` / `#/me` 三页均可达；登录 / 注册页各两个空输入 + 逐字标题「登录」「注册」；
  // 我的页有账号卡骨架；三页底部 Tab 的「我的」都为选中项；未登录态账号卡显示逐字「未登录」+ 逐字按钮「登录」。
  await withTempDb(async ({ dbPath }) => {
    await withApp({ dbPath }, async (app) => {
      for (const item of [
        { hash: '#/login', title: '登录' },
        { hash: '#/register', title: '注册' },
      ]) {
        const page = await mountBrowser(app, { hash: item.hash });
        try {
          assert.equal(page.location.hash, item.hash, `${item.hash} 必须可达（不得被重定向）`);
          const inputs = [...page.document.querySelectorAll('input')];
          assert.ok(
            inputs.length >= 2,
            `${item.hash} 必须有至少两个输入框，实际 ${inputs.length}（${JSON.stringify(inputs.map((i) => i.type))}）`,
          );
          assert.ok(
            inputs.filter((i) => i.value === '').length >= 2,
            `${item.hash} 的输入框必须为空（未登录态），实际 ${JSON.stringify(inputs.map((i) => i.value))}`,
          );
          assert.ok(
            page.text().includes(item.title),
            `${item.hash} 必须出现逐字标题「${item.title}」，实际「${page.visibleText().slice(0, 200)}」`,
          );
          assert.deepStrictEqual(
            page.activeTab(),
            ['me'],
            `${item.hash} 底部 Tab「我的」必须为选中项，实际 ${JSON.stringify(page.activeTab())}`,
          );
        } finally {
          await page.close();
        }
      }

      const me = await mountBrowser(app, { hash: '#/me' });
      try {
        assert.equal(me.location.hash, '#/me', '#/me 必须可达（不得被重定向）');
        assert.ok(me.visibleText().includes('未登录'), `未登录态必须出现逐字「未登录」，实际「${me.visibleText().slice(0, 200)}」`);
        assert.ok(
          me.count('.panel, .card, section') >= 1,
          '我的页必须有账号卡 / 面板骨架（不得是空白页）',
        );
        const exactLogin = [...me.document.querySelectorAll('a, button')].map((el) => el.textContent.trim());
        assert.ok(
          exactLogin.includes('登录'),
          `未登录态必须出现**逐字**按钮「登录」，实际可点文案 ${JSON.stringify(exactLogin)}`,
        );
        assert.deepStrictEqual(me.activeTab(), ['me'], `#/me 底部 Tab「我的」必须为选中项，实际 ${JSON.stringify(me.activeTab())}`);
      } finally {
        await me.close();
      }
    // ── 「直达」「入口点击」「反回」各断一条（主控 2026-10-16；此前只覆盖一侧）—— 自足块，**在 withTempDb 作用域内**，
    //    自带 app/client（上一版误放在作用域外 ⇒ `ReferenceError: app is not defined`，是装置缺陷不是产品缺陷）。
    await withApp({ dbPath }, async (regApp) => {
      const regClient = newClient(regApp);
      const title2 = (h) => h.document.querySelector('h1, h2')?.textContent.trim() ?? '';
      const direct = await mountBrowser(regApp, { hash: '#/register', cookie: regClient.cookieHeader() });
      try {
        assert.equal(direct.location.hash, '#/register', '① 直达：hash 必须停在 #/register（不得落兜底）');
        assert.equal(title2(direct), '注册', '① 直达：标题必须逐字「注册」，实际「' + title2(direct) + '」');
      } finally {
        await direct.close();
      }
      const viaClick = await mountBrowser(regApp, { hash: '#/login', cookie: regClient.cookieHeader() });
      try {
        assert.equal(title2(viaClick), '登录', '前置：先停在登录页');
        assert.equal(await viaClick.clickText('注册新账号'), true, '② 入口：登录页必须有可点的「注册新账号」入口');
        assert.equal(viaClick.location.hash, '#/register', '② 入口：点击后 hash 必须变 #/register，实际 ' + viaClick.location.hash);
        assert.equal(title2(viaClick), '注册', '② 入口：点击后必须渲染注册页，实际「' + title2(viaClick) + '」');
        assert.equal(await viaClick.clickText('已有账号，去登录'), true, '③ 反向：注册页必须有可点的「已有账号，去登录」入口');
        assert.equal(viaClick.location.hash, '#/login', '③ 反向：点击后 hash 必须变 #/login，实际 ' + viaClick.location.hash);
        assert.equal(title2(viaClick), '登录', '③ 反向：必须渲染登录页');
      } finally {
        await viaClick.close();
      }
    });    });
  });
});



test('空车结算页自动回购物车（AC-59）', async () => {
  // 判据（PRD `AC-59`）：**登录态空车**直接进 `#/checkout` ⇒ 自动回到 `#/cart`，且不出现「提交订单」；
  // 对照组：登录态**非空车**时 `#/checkout` 必须可达并出现「提交订单」（防「一律重定向」蒙过判据）。
  await withTempDb(async ({ dbPath }) => {
    await withApp({ dbPath }, async (app) => {
      const client = newClient(app);
      await registerOrFail(client, uniqueEmail('ac59'), PW);

      const empty = await mountBrowser(app, { hash: '#/checkout', cookie: client.cookieHeader() });
      try {
        assert.equal(
          empty.location.hash,
          '#/cart',
          `登录态空车直接进 #/checkout 必须自动回到 #/cart，实际 ${empty.location.hash}`,
        );
        assert.equal(
          empty.text().includes('提交订单'),
          false,
          `回退到购物车后不得出现「提交订单」按钮，实际「${empty.text().slice(0, 200)}」`,
        );
      } finally {
        await empty.close();
      }

      const target = await productAt(client, 0);
      assert.equal((await addItem(client, target.id, 1)).status, 201, '前置：加购必须 201');
      assert.equal(
        (await client.get('/api/v1/auth/me')).status,
        200,
        `前置：控制组装载前会话必须仍有效（否则浏览器侧 401 无法归因；app.port=${app.port}）`,
      );
      const filled = await mountBrowser(app, { hash: '#/checkout', cookie: client.cookieHeader() });
      try {
        assert.equal(
          filled.location.hash,
          '#/checkout',
          `对照组：登录态非空车时 #/checkout 必须可达（不得被重定向），实际 ${filled.location.hash}；` +
            `请求序列 ${JSON.stringify(filled.exchanges)}；可见文本「${filled.visibleText().slice(0, 220)}」`,
        );
        assert.ok(
          filled.text().includes('提交订单'),
          `对照组：非空车结算页必须出现「提交订单」，实际「${filled.text().slice(0, 200)}」`,
        );
      } finally {
        await filled.close();
      }
    });
  });
});

test('本地筛选不出网（AC-60）', async () => {
  // 判据（PRD `AC-60` / ui-spec `UI-06` 字面）：输入「滤」⇒ 商品卡变 **2** 张（名称命中「滤」的两件，按 `DEFAULT_SEED` 推导）；
  // 「zzz」⇒ 0 张 + 逐字「没有找到相关商品」；清空 ⇒ 恢复 8 张；**两档都不得产生任何网络请求**
  // （请求序列里不得出现含 `q=` / `keyword=` / `search=` 的新请求，也不得请求新增搜索端点）。
  await withTempDb(async ({ dbPath }) => {
    await withApp({ dbPath }, async (app) => {
      const page = await mountBrowser(app, { hash: '#/products' });
      try {
        const cards = () => page.count('#product-grid li');
        const total = DEFAULT_SEED.length;
        assert.equal(cards(), total, `未筛选时必须显示全部 ${total} 张商品卡，实际 ${cards()}`);

        // 期望集合由 `DEFAULT_SEED` 的**商品名**推导（ui-spec UI-06 逐字给了「滤」的两件；不硬编码名字 ⇒ 种子变化时不会假红）。
        // ⚠ 匹配字段口径（主控 2026-10-16 裁定）：`AC-60` 此前**从未规定匹配字段**（规格歧义缺陷）；UAT 实测原实现按「名称 + 描述」得 4 件、
        //   与字面「2 件」冲突，dev 已改为按 **`product.name`** 匹配 ⇒ 与字面一致。本断言只按**名称**推导；pm 在 `AC-60` / ui-designer 在 `UI-06`
        //   把「匹配字段 = 商品名」冻结进字面后，此处口径即为真源口径（数字 2 不改、真源数字成立）。
        const hits = DEFAULT_SEED.filter((s) => s.name.includes('滤'));
        assert.equal(hits.length, 2, `自证前置：DEFAULT_SEED 里商品名含「滤」的必须恰为 2 件，实际 ${JSON.stringify(hits.map((s) => s.name))}`);

        const before = page.requests.length;
        await page.type('#search-input', '滤');
        assert.equal(
          cards(),
          hits.length,
          `输入「滤」后必须剩 ${hits.length} 张卡（UI-06 字面：${hits.map((s) => s.name).join('、')}），实际 ${cards()}`,
        );
        for (const hit of hits) {
          assert.ok(page.visibleText().includes(hit.name), `筛选结果必须含「${hit.name}」，实际「${page.visibleText().slice(0, 200)}」`);
        }
        for (const other of DEFAULT_SEED.filter((s) => !s.name.includes('滤'))) {
          assert.equal(page.visibleText().includes(other.name), false, `筛选结果不得含不匹配的「${other.name}」`);
        }

        await page.type('#search-input', 'zzz');
        assert.equal(cards(), 0, `输入「zzz」后商品卡必须为 0，实际 ${cards()}`);
        assert.ok(
          page.visibleText().includes('没有找到相关商品'),
          `空结果必须出现逐字「没有找到相关商品」，实际「${page.visibleText().slice(0, 200)}」`,
        );

        await page.type('#search-input', '');
        assert.equal(cards(), total, `清空输入后必须恢复 ${total} 张卡，实际 ${cards()}`);

        const during = page.requests.slice(before);
        assert.equal(
          during.some((p) => /[?&](q|keyword|search)=/i.test(p)),
          false,
          `筛选期间不得发出含 q= / keyword= / search= 的请求，实际 ${JSON.stringify(during)}`,
        );
        assert.deepStrictEqual(
          during,
          [],
          `本地筛选**不得产生任何新请求**（含新增搜索端点），实际 ${JSON.stringify(during)}`,
        );
      } finally {
        await page.close();
      }
    });
  });
});

test('订单状态筛选（AC-61）', async () => {
  // 判据（PRD `AC-61`）：订单页有「全部 / 已支付 / 已完成」三个胶囊（文案与顺序固定），选中项高亮、未选中项常态；
  // 「全部」出全部订单；「已完成」必须 0 条（下单即已支付，不得留在别的档）；切换**不产生新请求**。
  await withTempDb(async ({ dbPath }) => {
    await withApp({ dbPath }, async (app) => {
      const client = newClient(app);
      await registerOrFail(client, uniqueEmail('ac61'), PW);
      await placeOrder(client, 0);
      await placeOrder(client, 1);
      const orders = await getOrders(client); // `getOrders` 直接返回订单数组（{ data: Order[] } 的 data）
      assert.ok(orders.length >= 2, `前置：至少两单，实际 ${orders.length}`);

      assert.equal(
        (await client.get('/api/v1/auth/me')).status,
        200,
        `前置：我的页装载前会话必须仍有效（app.port=${app.port}）`,
      );
            const page = await mountBrowser(app, { hash: '#/me', cookie: client.cookieHeader() }); // 胶囊在**我的页**（PRD AC-61 / ui-spec UI-44 逐字「我的页」）
      try {
        const PILL_SELECTOR = 'button, a, [role="tab"], [role="button"]';
        const pills = () =>
          [...page.document.querySelectorAll(PILL_SELECTOR)]
            .map((el) => el.textContent.trim())
            .filter((label) => ['全部', '已支付', '已完成'].includes(label));
        const labels = pills();
        assert.deepStrictEqual(
          labels,
          ['全部', '已支付', '已完成'],
          `订单状态胶囊必须恰为「全部 / 已支付 / 已完成」且顺序固定，实际 ${JSON.stringify(labels)}`,
        );
        const cards = () => page.count('[data-order-no]');
        const stateOf = () =>
          [...page.document.querySelectorAll(PILL_SELECTOR)]
            .filter((el) => ['全部', '已支付', '已完成'].includes(el.textContent.trim()))
            .map(
              (el) =>
                `${el.textContent.trim()}#${el.className}#${el.getAttribute('aria-selected')}#${el.getAttribute('aria-pressed')}`,
            );
        const before = stateOf();
        assert.equal(cards(), orders.length, `「全部」档必须出全部 ${orders.length} 单，实际 ${cards()}；请求序列 ${JSON.stringify(page.requests)}；可见文本「${page.visibleText().slice(0, 220)}」（${JSON.stringify(before)}）`);

        const requestsBefore = page.requests.length;
        assert.equal(await page.clickText('已完成', PILL_SELECTOR), true, '必须能点到「已完成」胶囊');
        assert.equal(cards(), 0, `「已完成」档必须 0 条（下单即已支付），实际 ${cards()}`);
        const afterDone = stateOf();
        assert.notDeepStrictEqual(afterDone, before, `选中项必须与未选中项有可辨状态差异（className / aria-selected / aria-pressed），实际 ${JSON.stringify(afterDone)}`);
        assert.ok(
          new Set(afterDone.map((s) => s.split('#').slice(1).join('#'))).size > 1,
          `选中态必须只落在被点的那个胶囊上（不得三个胶囊状态全同），实际 ${JSON.stringify(afterDone)}`,
        );

        assert.equal(await page.clickText('已支付', PILL_SELECTOR), true, '必须能点到「已支付」胶囊');
        assert.equal(cards(), orders.length, `「已支付」档必须出全部 ${orders.length} 单（本包下单即已支付），实际 ${cards()}`);

        assert.equal(await page.clickText('全部', PILL_SELECTOR), true, '必须能点回「全部」胶囊');
        assert.equal(cards(), orders.length, `点回「全部」必须恢复 ${orders.length} 单，实际 ${cards()}`);
        assert.deepStrictEqual(
          page.requests.slice(requestsBefore),
          [],
          `切换状态必须**纯本地**（不得产生新请求），实际 ${JSON.stringify(page.requests.slice(requestsBefore))}`,
        );
      } finally {
        await page.close();
      }
    });
  });
});

test('卡内角标词表与优先级（AC-45）', async () => {
  // 判据（ui-designer 冻结 `UI-17`/`W-09`，属主 2026-10-16）：
  //   ① 每张商品卡**恰好 1 个**角标；② 角标必须**落在卡元素内**（**在卡元素内查询**，不得全页查询 —— 那会放过「页头有包邮」的假绿）；
  //   ③ 文案取自冻结词表「缺货」「包邮」「热卖」，**「秒杀」必须 0 命中**；④ 优先级 = 缺货 > 包邮（元价 ≥ ¥99，与 `W-04`/`W-15` 同门槛）> 热卖；
  //   ⑤ 当前种子分布 = 包邮 4 / 热卖 4 / 缺货 0；⑥ 缺货档必须有**夹具**（stock=0 ⇒ 该卡「缺货」+ 分布 3/4/1 + 遮罩），不得因种子无缺货而省略。
  const WORDS = ['缺货', '包邮', '热卖'];
  const FREE = 9900; // 元价 ≥ ¥99 ⇔ priceCents ≥ 9900
  const expectWord = (s) => (s.stock === 0 ? '缺货' : s.priceCents >= FREE ? '包邮' : '热卖');
  const inspect = (page) => {
    const cards = [...page.document.querySelectorAll('#product-grid li')];
    assert.ok(cards.length > 0, '必须有商品卡');
    return cards.map((card) => {
      const marks = [...card.querySelectorAll('.card__badge')]; // ② **卡内**查询（不查全页）
      assert.equal(marks.length, 1, `每张卡必须恰好 1 个**卡内**角标，实际 ${marks.length}（卡内 HTML：${card.innerHTML.slice(0, 200)}）`);
      const word = marks[0].textContent.trim();
      assert.ok(WORDS.includes(word), `角标文案必须取自冻结词表 ${JSON.stringify(WORDS)}，实际「${word}」`);
      return { id: card.dataset.productId, word, veiled: card.querySelectorAll('.card__veil').length };
    });
  };
  await withTempDb(async ({ dbPath }) => {
    await withApp({ dbPath }, async (app) => {
      const page = await mountBrowser(app, { hash: '#/products' });
      try {
        const rows = inspect(page);
        assert.equal(rows.length, DEFAULT_SEED.length, `卡数必须 = 种子件数 ${DEFAULT_SEED.length}`);
        assert.equal(rows.some((r) => r.word === '秒杀'), false, '「秒杀」必须 0 命中（冻结词表之外的角标即红）');
        assert.equal(page.visibleText().includes('秒杀'), false, '全页可见文本也不得出现「秒杀」');
        const dist = { 包邮: 0, 热卖: 0, 缺货: 0 };
        for (const row of rows) dist[row.word] += 1;
        assert.deepEqual(dist, { 包邮: 4, 热卖: 4, 缺货: 0 }, `当前种子角标分布必须为 包邮 4 / 热卖 4 / 缺货 0，实际 ${JSON.stringify(dist)}`);
        for (const seed of DEFAULT_SEED) {
          const hit = rows.find((r) => r.id === seed.id);
          assert.equal(hit?.word, expectWord(seed), `优先级错：${seed.name}（stock=${seed.stock} price=${seed.priceCents}）应为「${expectWord(seed)}」，实际「${hit?.word}」`);
        }
      } finally {
        await page.close();
      }
      // ⑥ 缺货夹具：把第一件置 stock=0（只改测试注入的种子副本，不动仓内种子）
      const fixture = DEFAULT_SEED.map((s, i) => (i === 0 ? { ...s, stock: 0 } : { ...s }));
      await withApp({ dbPath, seed: fixture }, async (app2) => {
        const page2 = await mountBrowser(app2, { hash: '#/products' });
        try {
          const rows = inspect(page2);
          const dist = { 包邮: 0, 热卖: 0, 缺货: 0 };
          for (const row of rows) dist[row.word] += 1;
          assert.deepEqual(dist, { 包邮: 3, 热卖: 4, 缺货: 1 }, `缺货夹具下分布必须 3/4/1，实际 ${JSON.stringify(dist)}`);
          const out = rows.find((r) => r.id === fixture[0].id);
          assert.equal(out.word, '缺货', `stock=0 的卡角标必须为「缺货」，实际「${out.word}」`);
          assert.equal(out.veiled, 1, '缺货卡必须有 1 层卡内遮罩（`.card__veil`）');
          assert.equal(rows.filter((r) => r.veiled).length, 1, '非缺货卡不得有遮罩');
        } finally {
          await page2.close();
        }
      });
    });
  });
});

test('图片盒 1:1 且禁止「非 1:1 盒 + cover」（AC-46）', async () => {
  // 判据（ui-designer 收窄 UI-12/UI-24，挂既有 AC-46）：AC-46 的**管辖面 = 卡片主图 + 详情主图两处**（160×300 / 340×600 竖裁那两处）；
  //   订单行缩略图 .line__thumb **不归 AC-46**（主控 2026-10-16 裁定：收窄**选择器**、不收窄强度、不新增 AC）。
  //   ① 样式表必须至少两处 1:1 盒（卡片主图 + 详情主图）；② 任何 aspect-ratio 只许 1/1；
  //   ③ 管辖面内凡 object-fit: cover 的块必须同时声明 1:1（强度不变，只是把管辖面限定到 card/detail 两处）。
  //   ⚠ 分工（主控裁定）：机器层**只断样式声明**；渲染几何（1.000±0.01 / 390px 160±1 / 1280px 251.5±1 / 详情 340±1）归 **UAT 真机读数**。
  const { rawGet } = await import('./helpers/harness.mjs');
  await withTempDb(async ({ dbPath }) => {
    await withApp({ dbPath }, async (app) => {
      const res = await rawGet(app.port, '/src/styles.css');
      assert.equal(res.status, 200, '样式表 /src/styles.css 必须 200，实际 ' + res.status);
      const css = res.raw;
      const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
      assert.ok(blocks.length > 0, '样式表必须能解析出规则块（/src/styles.css 必须 200 且非空）');
      const aspect = (body) => ((body.match(/aspect-ratio\s*:\s*([^;]+)/) || [undefined, ''])[1]).replace(/\s+/g, '');
      const withAspect = blocks.filter((b) => /aspect-ratio\s*:/.test(b.body));
      assert.ok(
        withAspect.length >= 2,
        '样式表必须至少两处 1:1 盒（卡片主图 + 详情主图），实际 ' + withAspect.length + ' 处声明 aspect-ratio：' + JSON.stringify(withAspect.map((b) => b.sel)),
      );
      for (const b of withAspect) {
        assert.match(aspect(b.body), /^1\/1$/, '盒必须是 1:1（禁止 160×300 竖裁）：选择器「' + b.sel + '」声明了 aspect-ratio: ' + aspect(b.body));
      }
      // ③ 管辖面 = 卡片主图 + 详情主图（选择器含 card / detail）；.line__thumb 等其它 cover 用图不在管辖内
      const inScope = (sel) => /card|detail/i.test(sel);
      const scoped = blocks.filter((b) => inScope(b.sel));
      const scopedAspect = scoped.filter((b) => /aspect-ratio\s*:/.test(b.body));
      assert.ok(
        scopedAspect.some((b) => /card/i.test(b.sel)) && scopedAspect.some((b) => /detail/i.test(b.sel)),
        '管辖面必须**各自**覆盖到卡片主图与详情主图的 1:1 盒（不能只断一侧），实际命中：' + JSON.stringify(scopedAspect.map((b) => b.sel)),
      );
      for (const b of scoped.filter((x) => /object-fit\s*:\s*cover/.test(x.body))) {
        assert.match(
          aspect(b.body),
          /^1\/1$/,
          '禁止「非 1:1 盒 + object-fit: cover」组合（管辖面内）：选择器「' + b.sel + '」用 cover 却没有 1:1 盒（aspect-ratio = 「' + aspect(b.body) + '」）',
        );
      }
    });
  });
});
test('未登录提交订单拦截（AC-14）', async () => {
  // 判据（ui-designer 冻结 `W-60`）：**未登录**在 `#/checkout` 点「提交订单」⇒ 跳 `#/login` + 页内**逐字「请先登录后再下单」** + **下单请求数 = 0**
  //   （不白跑一次注定 401 的请求）。逐字文案取自源码 `web/src/pages/checkout.mjs` 的 `loginReason`。
  await withTempDb(async ({ dbPath }) => {
    await withApp({ dbPath }, async (app) => {
      const guest = newClient(app); // **不注册** ⇒ 匿名购物车
      const target = await productAt(guest, 0);
      assert.equal((await addItem(guest, target.id, 1)).status, 201, '前置：匿名加购必须 201');
      const page = await mountBrowser(app, { hash: '#/checkout', cookie: guest.cookieHeader() });
      try {
        assert.equal(page.location.hash, '#/checkout', '前置：匿名非空车必须能进结算页');
        assert.equal(await page.clickText('提交订单'), true, `必须能点到「提交订单」；实际 hash=${page.location.hash} 可见文本=「${page.visibleText().slice(0, 200)}」 请求=${JSON.stringify(page.exchanges)}`);
        assert.equal(page.location.hash, '#/login', `未登录提交必须跳 #/login，实际 ${page.location.hash}`);
        assert.equal(
          page.visibleText().includes('请先登录后再下单'),
          true,
          `必须逐字出现「请先登录后再下单」，实际「${page.visibleText().slice(0, 240)}」`,
        );
        const orderPosts = page.exchanges.filter((e) => e.path.startsWith('/api/v1/orders') && !e.path.includes('?'));
        assert.equal(orderPosts.length, 0, `未登录提交**不得**发出下单请求（不白跑注定 401 的请求），实际 ${JSON.stringify(page.exchanges)}`);
      } finally {
        await page.close();
      }
    });
  });
});

test('缺货详情页 CTA 真点不动（AC-54）', async () => {
  // 判据（挂既有 AC-54「UI行为继承（RSK-07）」—— 与 dev 修的 FEAT-001 V-01 同型行为的既有归属）：
  //   ① 缺货（stock === 0）详情页两个 CTA **真点不动**：断 `disabled` **且**用**真 MouseEvent 派发**后 hash 不变 + **POST 请求数 0**
  //      （只看 `disabled` 属性会放过「属性为真但事件仍生效」的假绿）。
  //   ② 「−」在数量 1 时禁用（同法：属性 + 派发后无副作用）。
  //   ⚠ 明确**未断言**的一档（如实申报，不写弱断言）：「/＋/ 按 min(现货, 8) 封顶」这一档**我断言不了** ——
  //      jsdom 下数量值的 DOM 取数口我未取到（探针在找数量元素时未命中，不能拿「点了 N 次后 disabled 仍为 false」这种被污染读数下结论）
  //      ⇒ 该档**无机器承载、归 UAT 真机**；不新增 AC、不改判据。
  const seed = DEFAULT_SEED.map((s2) => ({ ...s2 }));
  seed[0] = { ...seed[0], stock: 0 };
  seed[1] = { ...seed[1], stock: 4 };
  await withTempDb(async ({ dbPath }) => {
    await withApp({ dbPath, seed }, async (app) => {
      const client = newClient(app);
      await registerOrFail(client, uniqueEmail('ac54'), PW); // **登录态** client（匿名点 CTA 会落 #/login，那是 AC-14 的正当行为，会污染读数）
      const data = (await client.get('/api/v1/products')).json.data;
      const out = data.find((x) => x.name === seed[0].name);
      const four = data.find((x) => x.name === seed[1].name);
      const click = (page, el) => {
        el.dispatchEvent(new page.window.MouseEvent('click', { bubbles: true, cancelable: true, view: page.window }));
      };
      const posts = (page) => page.exchanges.filter((e) => e.method === 'POST').length;
      // ① 缺货：两个 CTA **各自在一个新 mount 里单独点**（避免连点互相污染）
      for (const label of ['加入购物车', '立即购买']) {
        const page = await mountBrowser(app, { hash: '#/products/' + out.id, cookie: client.cookieHeader() });
        try {
          const btn = [...page.document.querySelectorAll('button, a, [role="button"]')].find((b) => b.textContent.trim() === label);
          assert.ok(btn, '缺货详情页必须有「' + label + '」按钮');
          assert.equal(btn.disabled, true, '缺货详情页「' + label + '」必须 disabled，实际 false');
          const hash0 = page.location.hash;
          const posts0 = posts(page);
          click(page, btn);
          await page.settle({ drain: true });
          assert.equal(page.location.hash, hash0, '缺货「' + label + '」真鼠标事件后 hash 不得变化，实际 ' + page.location.hash);
          assert.equal(posts(page), posts0, '缺货「' + label + '」真鼠标事件后不得发出请求（POST ' + posts0 + '→' + posts(page) + '）');
        } finally {
          await page.close();
        }
      }
      // ② 现货 4 档：「−」在数量 1 时禁用，且真派发后无副作用
      const page = await mountBrowser(app, { hash: '#/products/' + four.id, cookie: client.cookieHeader() });
      try {
        const minus = [...page.document.querySelectorAll('button, a, [role="button"]')].find((b) => b.textContent.trim() === '−' || b.textContent.trim() === '-');
        assert.ok(minus, '现货详请页必须有「−」步进按钮');
        assert.equal(minus.disabled, true, '数量 1 时「−」必须 disabled，实际 false');
        const hash0 = page.location.hash;
        const posts0 = posts(page);
        click(page, minus);
        await page.settle({ drain: true });
        assert.equal(page.location.hash, hash0, '数量 1 时「−」真鼠标事件后 hash 不得变化');
        assert.equal(posts(page), posts0, '数量 1 时「−」真鼠标事件后不得发出请求');
      } finally {
        await page.close();
      }
    });
  });
});
