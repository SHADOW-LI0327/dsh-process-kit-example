// FEAT-002 UAT r4 · UI 规格 §十一 哈希路由表逐行走查（9+1 条）
// 每条：能否直达 / 页面是什么 / 首帧（禁 JS 与服务端 HTML；JS 启动后限速下的加载态）/ 空态或异常态实际文案逐字 / 底部 Tab 选中项 / 截图
import { openPage, outDir } from './lib-cdp.mjs';
import fs from 'node:fs';
const R = {}; const log = (k, v) => { R[k] = v; console.log('\n===== ' + k + ' =====\n' + JSON.stringify(v, null, 1)); };
const HOST = 'http://127.0.0.1:3000';
const p = await openPage({ width: 390, height: 844, dsf: 2, mobile: true });
await p.send('Network.enable', {}, p.sid);
await p.send('Network.clearBrowserCookies', {}, p.sid);

const STATE = "(()=>{const t=(document.body.innerText||'').replace(/\\n+/g,' | ');const a=document.querySelector('.tabbar__item.is-active');"
  + "return JSON.stringify({hash:location.hash,text:t.slice(0,300),len:t.length,tab:a?(a.innerText||'').trim():null,cards:document.querySelectorAll('li.card').length});})()";
const st = async () => JSON.parse(await p.eval(STATE));
const cap = async (f) => { await p.shot(outDir(f)); return f; };
const setJs = async (v) => p.send('Emulation.setScriptExecutionDisabled', { value: v }, p.sid);
const throttle = async (ms) => p.send('Network.emulateNetworkConditions', { offline: false, latency: ms, downloadThroughput: 20000, uploadThroughput: 20000 }, p.sid);

// 采样：JS 启动后限速下，逐 25ms 抓文案，返回「首个不同状态」= 加载态
const sampleFirst = async (hash, waitMs = 2500) => {
  await throttle(1200);
  await p.eval("(()=>{window.__t=[];window.__i=setInterval(()=>{window.__t.push({ms:Date.now(),txt:(document.body.innerText||'').replace(/\\n+/g,' | ').slice(0,120)});},25);return 1;})()");
  const t0 = Date.now();
  await p.eval(`(location.hash=${JSON.stringify(hash)} , 1)`);
  await p.wait(600);
  const shot = await cap(`路由表-${hash.replace(/[#/<>]/g, '_') || 'root'}-加载态.png`);
  await p.wait(waitMs);
  const s = JSON.parse(await p.eval("(()=>{clearInterval(window.__i);return JSON.stringify(window.__t);})()"));
  const u = []; for (const x of s) if (!u.length || u[u.length - 1].txt !== x.txt) u.push({ t: x.ms - t0, txt: x.txt });
  await throttle(0);
  return { firstStates: u.slice(0, 3), shot };
};

const ROUTES = [
  ['#/products', '首页商品列表'],
  ['#/products/P-001', '商品详情'],
  ['#/cart', '购物车'],
  ['#/checkout', '结算下单'],
  ['#/orders', '订单列表'],
  ['#/orders/SO-19700101-99999', '订单详情（不存在/越权）'],
  ['#/login', '登录'],
  ['#/register', '注册'],
  ['#/me', '我的'],
  ['#/no-such-route-xyz', '其它任意 hash 兜底'],
];
for (const [hash, page] of ROUTES) {
  const r = { hash, page };
  // ① 禁 JS：服务端 HTML 的首帧
  await setJs(true);
  await p.send('Network.clearBrowserCookies', {}, p.sid);
  await p.navigate(HOST + '/', 800);
  await p.navigate(HOST + '/' + hash, 1200);
  r.firstFrame_noJS = await st();
  r.firstFrame_noJS_shot = await cap(`路由表-${hash.replace(/[#/<>]/g, '_')}-首帧禁JS.png`);
  await setJs(false);
  // ② JS 启动后（限速）：加载态
  await p.send('Network.clearBrowserCookies', {}, p.sid);
  await p.navigate(HOST + '/', 1800);
  r.loadingStates = await sampleFirst(hash);
  await p.wait(600);
  // ③ 稳定态
  await throttle(0);
  r.settled = await st();
  r.settled_shot = await cap(`路由表-${hash.replace(/[#/<>]/g, '_')}-稳定态.png`);
  R[hash] = r;
  console.log('\n===== ROUTE ' + hash + ' (' + page + ') =====\n' + JSON.stringify(r, null, 1));
}

// ④ 各路由的空态 / 异常态实际文案
const EMPTY = {};
await p.navigate(HOST + '/#/products', 2200);
await p.eval("(()=>{const i=document.querySelector('#search-input');i.value='zzz';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()");
await p.wait(900);
EMPTY['#/products 搜索无结果'] = { ...(await st()), shot: await cap('路由表-空态-products-搜索无结果.png') };
await p.eval("(()=>{const i=document.querySelector('#search-input');i.value='';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()");
await p.wait(700);
await p.navigate(HOST + '/#/products/不存在-xyz', 2000);
EMPTY['#/products/<不存在>'] = { ...(await st()), shot: await cap('路由表-异常态-products-商品不存在.png') };
await p.navigate(HOST + '/#/cart', 1800);
EMPTY['#/cart 空态（未登录）'] = { ...(await st()), shot: await cap('路由表-空态-cart.png') };
await p.navigate(HOST + '/#/checkout', 1800);
EMPTY['#/checkout 空车直达'] = { ...(await st()), shot: await cap('路由表-异常态-checkout-空车.png') };
await p.navigate(HOST + '/#/orders', 1800);
EMPTY['#/orders 空态（未登录）'] = { ...(await st()), shot: await cap('路由表-空态-orders-未登录.png') };
await p.navigate(HOST + '/#/orders/SO-19700101-99999', 1800);
EMPTY['#/orders/<不存在>'] = { ...(await st()), shot: await cap('路由表-异常态-orders-订单不存在.png') };
await p.navigate(HOST + '/#/login', 1800);
await p.eval("(()=>{const b=[...document.querySelectorAll('button')].find(x=>/^登录/.test(x.innerText.trim()));b.click();return 1;})()");
await p.wait(900);
EMPTY['#/login 空提交'] = { ...(await st()), shot: await cap('路由表-空态-login-空提交.png') };
await p.navigate(HOST + '/#/register', 1800);
await p.eval("(()=>{const b=[...document.querySelectorAll('button')].find(x=>/注册/.test(x.innerText));const btn=[...document.querySelectorAll('button')].find(x=>/注册新账号/.test(x.innerText))||b;btn.click();return 1;})()");
await p.wait(900);
EMPTY['#/register 空提交'] = { ...(await st()), shot: await cap('路由表-空态-register-空提交.png') };
await p.navigate(HOST + '/#/me', 1800);
EMPTY['#/me 未登录'] = { ...(await st()), shot: await cap('路由表-空态-me-未登录.png') };
await setJs(true);
await p.navigate(HOST + '/#/login', 1200);
EMPTY['#/login 首帧静态表单（禁 JS）'] = await st();
await setJs(false);
log('route_empty_states', EMPTY);

// ⑤ 登录后（0 单）复看 #/orders 与 #/me
await p.navigate(HOST + '/#/register', 1800);
await p.clickSel('#auth-email'); await p.send('Input.insertText', { text: 'uat-r4route+' + Date.now() + '@example.com' }, p.sid);
await p.clickSel('#auth-password'); await p.send('Input.insertText', { text: 'uat-pass-12345' }, p.sid);
await p.eval("(()=>{const b=[...document.querySelectorAll('button')].find(x=>/注册新账号/.test(x.innerText));b.click();return 1;})()");
await p.wait(2200);
await p.navigate(HOST + '/#/orders', 2200);
log('route_orders_loggedin_empty', { ...(await st()), shot: await cap('路由表-空态-orders-已登录0单.png') });
await p.navigate(HOST + '/#/me', 2000);
log('route_me_loggedin', { ...(await st()), shot: await cap('路由表-稳定态-me-已登录.png') });
await p.navigate(HOST + '/#/checkout', 2000);
log('route_checkout_loggedin_empty', { ...(await st()), shot: await cap('路由表-异常态-checkout-已登录空车.png') });
fs.writeFileSync(outDir('r4-routes.json'), JSON.stringify(R, null, 1));
await p.close();
console.log('\nR4_ROUTES_DONE');
