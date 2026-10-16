// FEAT-002 UAT · 补完下单闭环 + 匿名车并入语义（注册 vs 登录）+ 搜索框行为
import { openPage, outDir } from './lib-cdp.mjs';
import fs from 'node:fs';

const S = [];
const step = (n, d) => { S.push({ n, d }); console.log('\n== ' + n + ' ==\n' + JSON.stringify(d, null, 1)); };
const p = await openPage({ width: 390, height: 844, dsf: 2, mobile: true });
await p.send('Network.enable', {}, p.sid);
const reqs = () => p.events.filter((e) => e.method === 'Network.requestWillBeSent').map((e) => e.params.request);
const since = (n) => reqs().slice(n).map((r) => r.method + ' ' + r.url + (r.postData ? ' body=' + r.postData : ''));

const TXT = "(()=>{const cs=e=>getComputedStyle(e);const tab=document.querySelector('.tabbar');"
  + "return JSON.stringify({hash:location.hash,text:(document.body.innerText||'').replace(/\\n+/g,' | ').slice(0,420),"
  + "cardCount:document.querySelectorAll('li.card,.card').length,searchValue:(document.querySelector('#search-input')||{}).value,"
  + "badge:(document.querySelector('.tabbar__count')||{}).innerText||null,"
  + "tabTop:tab?Math.round(tab.getBoundingClientRect().top):null,"
  + "tail:(()=>{const all=[...document.querySelectorAll('main *')].filter(e=>e.children.length===0&&(e.innerText||'').trim());const e=all[all.length-1];return e?{txt:e.innerText.trim().slice(0,26),bottom:Math.round(e.getBoundingClientRect().bottom)}:null})()"
  + "},null,1);})()";
const at = async (l) => { const v = JSON.parse(await p.eval(TXT)); step(l, v); return v; };

const email = 'uat002b+' + Date.now() + '@example.com';
const pw = 'uat-pass-12345';
fs.writeFileSync(outDir('p2c-account.txt'), email + ' / ' + pw + '\n');

// ── ① 搜索框：输入后首页列表是否即时变化（本地过滤？）
await p.navigate('http://127.0.0.1:3000/', 3000);
const before = JSON.parse(await p.eval(TXT));
await p.clickSel('#search-input');
await p.send('Input.insertText', { text: '咖啡' }, p.sid);
await p.wait(1200);
const filtered = JSON.parse(await p.eval(TXT));
step('S1 搜索框输入「咖啡」', { beforeCards: before.cardCount, afterCards: filtered.cardCount, afterText: filtered.text.slice(0, 160), searchValue: filtered.searchValue });
await p.shot(outDir('T7-390搜索本地过滤.png'));
await p.eval("(()=>{const i=document.querySelector('#search-input');i.value='';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()");
await p.wait(800);

// ── ② 未登录加购 → 结算 → 去登录 → 注册
await p.navigate('http://127.0.0.1:3000/#/products/P-001', 2500);
await p.clickSel('.btn--cta'); await p.wait(1600);
await p.navigate('http://127.0.0.1:3000/#/cart', 1800);
const c1 = await at('S2 注册前匿名车');
await p.clickSel('.btn--cta'); await p.wait(1500);
await p.clickSel("a.btn--link, a[href='#/login']"); await p.wait(1500);
await p.clickSel('#auth-email'); await p.send('Input.insertText', { text: email }, p.sid);
await p.clickSel('#auth-password'); await p.send('Input.insertText', { text: pw }, p.sid);
const n0 = reqs().length;
await p.eval("(()=>{const b=[...document.querySelectorAll('button')].find(x=>/注册新账号/.test(x.innerText));b.click();return 1;})()");
await p.wait(2200);
const me = await at('S3 注册后「我的」');
await p.shot(outDir('T4-390我的已登录.png'));
step('S3b 注册前后购物车对比', { beforeRegister: c1.text.match(/合计[^|]*/)?.[0] || c1.text.slice(0, 120), afterRegister: me.text.slice(0, 200), requests: since(n0) });
await p.navigate('http://127.0.0.1:3000/#/cart', 1800);
const cartAfterReg = await at('S4 注册后购物车');
await p.shot(outDir('PN-390注册后购物车.png'));

// ── ③ 登录状态下完整下单闭单
await p.navigate('http://127.0.0.1:3000/#/products/P-001', 2200);
await p.clickSel('.btn--cta'); await p.wait(1600);
await p.navigate('http://127.0.0.1:3000/#/cart', 1800);
const c2 = await at('S5 登录后加购的购物车');
await p.shot(outDir('T4-390购物车.png'));
await p.clickSel('.btn--cta'); await p.wait(1800);
const co = await at('S6 结算页');
await p.shot(outDir('PN-390结算页.png'));
const n1 = reqs().length;
await p.clickSel('.btn--cta'); await p.wait(3000);
const ord = await at('S7 提交订单后');
await p.shot(outDir('T4-390订单.png'));
step('S7b 下单请求', { requests: since(n1) });
await p.navigate('http://127.0.0.1:3000/#/orders', 2200);
const ordList = await at('S8 订单列表');
await p.shot(outDir('T4-390订单列表.png'));
await p.shotFull(outDir('T4-390订单列表-full.png'));

// ── ④ 退出 → 匿名加购 → 登录同一账号：看是否并入
await p.navigate('http://127.0.0.1:3000/#/me', 1800);
await p.eval("(()=>{const b=[...document.querySelectorAll('button')].find(x=>/退出登录/.test(x.innerText));if(b)b.click();return 1;})()");
await p.wait(1800);
const out = await at('S9 退出登录后');
await p.navigate('http://127.0.0.1:3000/#/products/P-002', 2200);
await p.clickSel('.btn--cta'); await p.wait(1600);
await p.navigate('http://127.0.0.1:3000/#/cart', 1600);
const anon = await at('S10 退出后匿名车(1 件)');
const n2 = reqs().length;
await p.navigate('http://127.0.0.1:3000/#/login', 1800);
await p.clickSel('#auth-email'); await p.send('Input.insertText', { text: email }, p.sid);
await p.clickSel('#auth-password'); await p.send('Input.insertText', { text: pw }, p.sid);
await p.eval("(()=>{const b=[...document.querySelectorAll('button')].find(x=>/^登录/.test(x.innerText.trim()));b.click();return 1;})()");
await p.wait(2400);
await p.navigate('http://127.0.0.1:3000/#/cart', 1800);
const merged = await at('S11 登录后购物车(并入口径)');
step('S11b 登录请求', { requests: since(n2), anonBefore: anon.text.slice(0, 200), afterLogin: merged.text.slice(0, 240) });
await p.shot(outDir('PN-390登录并入购物车.png'));

fs.writeFileSync(outDir('p2c-flow.json'), JSON.stringify(S, null, 1));
await p.close();
console.log('\nOK steps=' + S.length);
