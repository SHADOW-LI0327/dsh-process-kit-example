// FEAT-002 UAT · 干净截图重拍 + 底部遮挡量测 + 原图对照（T-9 裁切口径）
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
const OCC = "(()=>{const tab=document.querySelector('.tabbar');const tb=tab.getBoundingClientRect();"
  + "const main=document.querySelector('main')||document.body;"
  + "const leaves=[...main.querySelectorAll('*')].filter(e=>e.children.length===0&&(e.innerText||'').trim()&&!e.closest('.tabbar'));"
  + "const worst=leaves.map(e=>({txt:e.innerText.trim().slice(0,24),bottom:Math.round(e.getBoundingClientRect().bottom)})).sort((a,b)=>b.bottom-a.bottom)[0];"
  + "const cards=[...document.querySelectorAll('li.card,.card')];const last=cards[cards.length-1];"
  + "return JSON.stringify({hash:location.hash,scrollY:Math.round(scrollY),maxScroll:document.documentElement.scrollHeight-innerHeight,"
  + "tabTop:Math.round(tb.top),tabBox:[Math.round(tb.x),Math.round(tb.y),Math.round(tb.width),Math.round(tb.height)],"
  + "lastCardBottom:last?Math.round(last.getBoundingClientRect().bottom):null,"
  + "gapCardToTab:last?Math.round(tb.top-last.getBoundingClientRect().bottom):null,worstLeaf:worst,"
  + "gapWorstToTab:worst?Math.round(tb.top-worst.bottom):null,covered:worst?worst.bottom>tb.top:null,"
  + "hScroll:document.documentElement.scrollWidth>innerWidth});})()";
const occl = async (label) => {
  await p.eval('window.scrollTo(0, document.documentElement.scrollHeight)');
  await p.wait(900);
  const v = JSON.parse(await p.eval(OCC));
  step(label + ' · 滚到底遮挡量测', v);
  return v;
};

// 首页（清空搜索框）
await p.navigate('http://127.0.0.1:3000/', 3200);
await clearSearch();
await p.shot(outDir('U-01首页390.png'));
await p.shotFull(outDir('U-01首页390-full.png'));
await occl('首页');

// 详情 → 加购 ×2
await p.clickSel('li.card .card__link');
await p.wait(1200);
await clearSearch();
await p.shot(outDir('U-06商品详情390.png'));
await occl('商品详情');
await p.clickSel('.btn--cta'); await p.wait(1500);
await p.clickSel('.btn--cta'); await p.wait(1500);

// 购物车
await p.eval("location.hash='#/cart'"); await p.wait(2000);
await clearSearch();
await p.shot(outDir('U-04购物车390.png'));
await occl('购物车');

// 结算（未登录）
await p.clickSel('.btn--cta'); await p.wait(1800);
await clearSearch();
await p.shot(outDir('U-05结算未登录390.png'));
await occl('结算页(未登录)');

// 登录 / 注册页
await p.clickSel("a.btn--link, a[href='#/login']"); await p.wait(1600);
await clearSearch();
await p.shot(outDir('U-07登录注册390.png'));
step('登录页 tab 高亮', JSON.parse(await p.eval("(()=>{const a=document.querySelector('.tabbar__item.is-active');return JSON.stringify({active:a?a.innerText.trim():null,color:getComputedStyle(a).color,others:[...document.querySelectorAll('.tabbar__item')].map(t=>getComputedStyle(t).color)});})()")));

// 注册 + 我的
const email = 'uat-shot+' + Date.now() + '@example.com';
await p.clickSel('#auth-email'); await p.send('Input.insertText', { text: email }, p.sid);
await p.clickSel('#auth-password'); await p.send('Input.insertText', { text: 'uat-pass-12345' }, p.sid);
await p.eval("(()=>{const b=[...document.querySelectorAll('button')].find(x=>/注册新账号/.test(x.innerText));b.click();return 1;})()");
await p.wait(2400);
await clearSearch();
await p.shot(outDir('U-08我的已登录390.png'));
await occl('我的(已登录)');

// 下单 → 订单列表
await p.eval("location.hash='#/cart'"); await p.wait(2000);
await p.clickSel('.btn--cta'); await p.wait(1800);
await p.clickSel('.btn--cta'); await p.wait(3000);
await clearSearch();
await p.shot(outDir('U-09订单列表390.png'));
const o = await occl('订单列表');
step('订单页正文', JSON.parse(await p.eval("JSON.stringify({text:document.body.innerText.replace(/\\n+/g,' | ').slice(0,300)})")));

// 原图对照（T-9 裁切口径）
await p.navigate('http://127.0.0.1:3000/assets/products/P-001.svg', 1800);
await p.setMetrics({ width: 200, height: 200, dsf: 2, mobile: false });
await p.shot(outDir('U-06原图P-001-150x150.png'));
step('原图页面', JSON.parse(await p.eval("JSON.stringify({url:location.href,title:document.title,bodyStart:document.body.innerHTML.slice(0,80)})")));

fs.writeFileSync(outDir('p5-shots.json'), JSON.stringify(S, null, 1));
await p.close();
console.log('\nOK');
