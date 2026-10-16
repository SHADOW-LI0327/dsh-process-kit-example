// FEAT-002 UAT · 订单闭环截图（先注册后加购，避开「注册不并入匿名车」的干扰）
import { openPage, outDir } from './lib-cdp.mjs';
import fs from 'node:fs';

const S = [];
const step = (n, d) => { S.push({ n, d }); console.log('\n== ' + n + ' ==\n' + JSON.stringify(d, null, 1)); };
const p = await openPage({ width: 390, height: 844, dsf: 2, mobile: true });
await p.send('Network.clearBrowserCookies', {}, p.sid);

const clearSearch = async () => {
  await p.eval("(()=>{const i=document.querySelector('#search-input');if(i){i.value='';i.dispatchEvent(new Event('input',{bubbles:true}));i.blur();}return 1;})()");
  await p.wait(400);
};
const INFO = "(()=>{const tab=document.querySelector('.tabbar');const tb=tab?tab.getBoundingClientRect():null;"
  + "const main=document.querySelector('main')||document.body;"
  + "const leaves=[...main.querySelectorAll('*')].filter(e=>e.children.length===0&&(e.innerText||'').trim()&&!e.closest('.tabbar'));"
  + "const worst=leaves.map(e=>({txt:e.innerText.trim().slice(0,24),bottom:Math.round(e.getBoundingClientRect().bottom)})).sort((a,b)=>b.bottom-a.bottom)[0];"
  + "return JSON.stringify({hash:location.hash,text:document.body.innerText.replace(/\\n+/g,' | ').slice(0,320),"
  + "tabTop:tb?Math.round(tb.top):null,worstLeaf:worst,gapWorstToTab:worst&&tb?Math.round(tb.top-worst.bottom):null,"
  + "covered:worst&&tb?worst.bottom>tb.top:null,hScroll:document.documentElement.scrollWidth>innerWidth,"
  + "tabActive:(document.querySelector('.tabbar__item.is-active')||{}).innerText||null});})()";
const at = async (l) => { await p.eval('window.scrollTo(0, document.documentElement.scrollHeight)'); await p.wait(700); const v = JSON.parse(await p.eval(INFO)); step(l, v); return v; };

const email = 'uat-order+' + Date.now() + '@example.com';
// ① 注册（先建账号，避免匿名车语义干扰）
await p.navigate('http://127.0.0.1:3000/#/login', 2500);
await p.clickSel('#auth-email'); await p.send('Input.insertText', { text: email }, p.sid);
await p.clickSel('#auth-password'); await p.send('Input.insertText', { text: 'uat-pass-12345' }, p.sid);
await p.eval("(()=>{const b=[...document.querySelectorAll('button')].find(x=>/注册新账号/.test(x.innerText));b.click();return 1;})()");
await p.wait(2400);
step('注册结果', JSON.parse(await p.eval(INFO)));

// ② 加购 2 件
await p.navigate('http://127.0.0.1:3000/#/products/P-002', 2500);
await clearSearch();
await p.clickSel('.btn--cta'); await p.wait(1400);
await p.clickSel('.btn--cta'); await p.wait(1400);

// ③ 购物车
await p.eval("location.hash='#/cart'"); await p.wait(2000);
await clearSearch();
await p.shot(outDir('U-03购物车390.png'));
await at('购物车');

// ④ 结算
await p.clickSel('.btn--cta'); await p.wait(1800);
await clearSearch();
await p.shot(outDir('U-04结算页390.png'));
await at('结算页');

// ⑤ 提交订单
const clicked = await p.eval("(()=>{const b=[...document.querySelectorAll('.btn--cta')].find(x=>/提交订单/.test(x.innerText));if(!b)return null;b.click();return b.innerText.trim();})()");
await p.wait(3000);
await clearSearch();
await p.shot(outDir('U-02订单列表390.png'));
const ord = await at('提交订单后');
step('提交按钮', { clicked });
await p.shotFull(outDir('U-02订单列表390-full.png'));

// ⑥ 退出 → 再登录（看登录并入是否在真实账号上成立）
await p.eval("location.hash='#/me'"); await p.wait(1800);
await p.eval("(()=>{const b=[...document.querySelectorAll('button')].find(x=>/退出登录/.test(x.innerText));if(b)b.click();return 1;})()");
await p.wait(1800);
await p.navigate('http://127.0.0.1:3000/#/products/P-003', 2200);
await p.clickSel('.btn--cta'); await p.wait(1500);
await p.eval("location.hash='#/login'"); await p.wait(1500);
await p.clickSel('#auth-email'); await p.send('Input.insertText', { text: email }, p.sid);
await p.clickSel('#auth-password'); await p.send('Input.insertText', { text: 'uat-pass-12345' }, p.sid);
await p.eval("(()=>{const b=[...document.querySelectorAll('button')].find(x=>/^登录/.test(x.innerText.trim()));b.click();return 1;})()");
await p.wait(2400);
await p.eval("location.hash='#/cart'"); await p.wait(2000);
await clearSearch();
const cartAfterLogin = await at('退出后匿名加购再登录 → 购物车');
await p.shot(outDir('U-10登录并入购物车390.png'));

fs.writeFileSync(outDir('p6-orders.json'), JSON.stringify(S, null, 1));
await p.close();
console.log('\nOK email=' + email);
