// FEAT-002 UAT · 真实浏览器完整下单流程取证（T-3/T-4/T-6/T-7/T-8/T-9 + 请求序列）
// 全程真实鼠标/键盘事件驱动；网络请求由 CDP Network 域记录（不是看日志）。
import { openPage, outDir } from './lib-cdp.mjs';
import fs from 'node:fs';

const S = [];           // 步骤记录
const step = (name, data) => { S.push({ name, data }); console.log('\n== ' + name + ' ==\n' + JSON.stringify(data)); };
const p = await openPage({ width: 390, height: 844, dsf: 2, mobile: true });
await p.send('Network.enable', {}, p.sid);
const reqs = () => p.events.filter((e) => e.method === 'Network.requestWillBeSent').map((e) => e.params.request);
const snap = () => { const a = reqs(); return a.map((r) => r.method + ' ' + r.url); };
const since = (n) => snap().slice(n);

const VIEW = "(()=>{const cs=e=>getComputedStyle(e);const box=e=>{const r=e.getBoundingClientRect();return [Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)];};"
  + "const cards=[...document.querySelectorAll('li.card,.card')];const imgs=[...document.querySelectorAll('img')];"
  + "return JSON.stringify({hash:location.hash,text:(document.body.innerText||'').replace(/\\n+/g,' | ').slice(0,500),"
  + "cards:cards.length,imgsTotal:imgs.length,imgsLoaded:imgs.filter(i=>i.complete&&i.naturalWidth>0).length,"
  + "bigImg:imgs[0]?{src:imgs[0].getAttribute('src'),box:box(imgs[0]),nat:imgs[0].naturalWidth+'x'+imgs[0].naturalHeight,of:cs(imgs[0]).objectFit}:null,"
  + "ctas:[...document.querySelectorAll('.btn--cta,button.btn,a.btn')].map(e=>({txt:(e.innerText||'').trim().slice(0,16),cls:(e.className||'').toString(),box:box(e),radius:cs(e).borderRadius,bgImg:cs(e).backgroundImage,active:document.activeElement===e})),"
  + "tabbar:{n:document.querySelectorAll('.tabbar__item').length,active:(document.querySelector('.tabbar__item.is-active')||{}).innerText,color:(document.querySelector('.tabbar__item.is-active')?cs(document.querySelector('.tabbar__item.is-active')).color:null),box:(e=>e?box(e):null)(document.querySelector('.tabbar'))},"
  + "prices:[...document.querySelectorAll('[class*=price]')].map(e=>({cls:e.className,txt:e.innerText.replace(/\\n/g,''),fs:cs(e).fontSize,color:cs(e).color,fw:cs(e).fontWeight})),"
  + "toast:(document.querySelector('.toast,.notice,[class*=toast]')||{}).innerText||null,"
  + "lastEl:(()=>{const all=[...document.querySelectorAll('main *')].filter(e=>e.children.length===0&&(e.innerText||'').trim());const e=all[all.length-1];return e?{txt:e.innerText.trim().slice(0,30),bottom:Math.round(e.getBoundingClientRect().bottom)}:null})()"
  + "},null,1);})()";

const after = async (label) => { const v = JSON.parse(await p.eval(VIEW)); step(label, v); return v; };

// ① 首页（干净加载）
await p.navigate('http://127.0.0.1:3000/', 3200);
await after('01 首页');

// ② T-7 搜索框：真实聚焦 + 输入 + 回车，观察是否产生任何请求
{
  const before = reqs().length;
  await p.clickSel('#search-input');
  await p.send('Input.insertText', { text: '咖啡' }, p.sid);
  await p.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, p.sid);
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, p.sid);
  await p.wait(1500);
  const v = JSON.parse(await p.eval(VIEW));
  step('02 搜索框输入后', { value: await p.eval("(document.querySelector('#search-input')||{}).value"), hash: v.hash, newRequests: since(before), focused: await p.eval("document.activeElement && document.activeElement.id") });
  await p.shot(outDir('T7-390搜索框聚焦.png'));
}

// ③ T-9/T-3 真实点击第一张卡进详情
{
  const n = reqs().length;
  await p.clickSel('li.card .card__link, li.card');
  await p.wait(1200);
  const v = await after('03 商品详情(点击卡片进入)');
  await p.shot(outDir('T9-390商品详情.png'));
  // 滚到底量遮挡
  await p.eval('window.scrollTo(0, document.documentElement.scrollHeight)');
  await p.wait(900);
  const occ = JSON.parse(await p.eval("(()=>{const tab=document.querySelector('.tabbar');const tb=tab.getBoundingClientRect();"
    + "const btn=[...document.querySelectorAll('.btn--cta')].map(e=>({txt:e.innerText.trim(),b:e.getBoundingClientRect()}));"
    + "return JSON.stringify({scrollY:Math.round(scrollY),maxScroll:document.documentElement.scrollHeight-innerHeight,tabTop:Math.round(tb.top),"
    + "ctas:btn.map(x=>({txt:x.txt,top:Math.round(x.b.top),bottom:Math.round(x.b.bottom),coveredByTab:x.b.bottom>tb.top}))});})()"));
  step('03b 详情页滚到底的遮挡', occ);
  await p.shot(outDir('T6-390详情CTA.png'));
  step('03c 详情页请求', { newRequests: since(n) });
}

// ④ 加入购物车（真实点击）
{
  const n = reqs().length;
  await p.clickSel('.btn--cta');
  await p.wait(1800);
  const v = await after('04 点击加入购物车后');
  step('04b 加购请求', { newRequests: since(n) });
  await p.shot(outDir('T8-390加购反馈.png'));
}

// ⑤ 购物车页
{
  const n = reqs().length;
  await p.clickSel("a.tabbar__item[href='#/cart']");
  await p.wait(1800);
  const v = await after('05 购物车');
  await p.shot(outDir('T4-390购物车.png'));
  step('05b 购物车请求', { newRequests: since(n) });
}

// ⑥ 结算页（未登录）
{
  await p.clickSel('.btn--cta');
  await p.wait(1600);
  await after('06 结算页(未登录)');
  await p.shot(outDir('PN-390结算未登录.png'));
}

// ⑦ 登录 / 注册（真实输入）
{
  const n = reqs().length;
  await p.clickSel("a.btn--link, a[href='#/login']");
  await p.wait(1600);
  await after('07 登录页');
  await p.shot(outDir('PN-390登录页.png'));
  const email = 'uat002+' + Date.now() + '@example.com';
  await p.clickSel('#auth-email'); await p.send('Input.insertText', { text: email }, p.sid);
  await p.clickSel('#auth-password'); await p.send('Input.insertText', { text: 'uat-pass-12345' }, p.sid);
  await p.shot(outDir('PN-390登录页已填.png'));
  await p.eval("(()=>{const b=[...document.querySelectorAll('button')].find(x=>/注册新账号/.test(x.innerText));b.click();return 1;})()");
  await p.wait(2200);
  const v = await after('07b 注册后');
  step('07c 认证请求', { newRequests: since(n), email });
  await p.shot(outDir('T4-390我的已登录.png'));
  fs.writeFileSync(outDir('p2-auth-email.txt'), email + '\n');
}

// ⑧ 购物车（登录后）→ 结算 → 提交订单
{
  await p.clickSel("a.tabbar__item[href='#/cart']");
  await p.wait(1800);
  const v = await after('08 购物车(登录后)');
  await p.shot(outDir('PN-390购物车登录后.png'));
  const n = reqs().length;
  if (v.ctas.some((c) => /结算|去结算/.test(c.txt))) { await p.clickSel('.btn--cta'); await p.wait(1800); }
  await after('09 结算页(登录后)');
  await p.shot(outDir('PN-390结算页.png'));
  await p.clickSel('.btn--cta');
  await p.wait(2500);
  await after('10 提交订单后');
  await p.shot(outDir('T4-390订单.png'));
  step('10b 下单请求', { newRequests: since(n) });
  await p.shotFull(outDir('T4-390订单-full.png'));
}

// ⑨ 请求序列汇总（本站 vs 第三方）
{
  const all = reqs();
  const hosts = {};
  for (const r of all) { const h = new URL(r.url).host; hosts[h] = (hosts[h] || 0) + 1; }
  const third = all.filter((r) => !/^https?:\/\/(127\.0\.0\.1|localhost)(:3000)?\//.test(r.url)).map((r) => r.url);
  step('11 请求汇总', { total: all.length, hosts, thirdParty: third, sample: all.slice(0, 4).map((r) => r.method + ' ' + r.url) });
  fs.writeFileSync(outDir('p2-requests.json'), JSON.stringify(all.map((r) => ({ method: r.method, url: r.url })), null, 1));
}
fs.writeFileSync(outDir('p2-flow.json'), JSON.stringify(S, null, 1));
await p.close();
console.log('\nSTEPS=' + S.length);
