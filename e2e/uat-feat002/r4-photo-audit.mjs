// FEAT-002 UAT r4（prdVersion 2）· 主图照片专项 U-26/U-27/U-28/U-29 + README 截图 + U-49/U-50 + B 组回归读数
// 真实 Edge headless + CDP。只采「界面 / 网络 / 渲染」可观察事实；不读源码、测试、日志、既有报告。
import { openPage, outDir } from './lib-cdp.mjs';
import fs from 'node:fs';

const R = {};                        // 汇总结果
const log = (k, v) => { R[k] = v; console.log('\n===== ' + k + ' =====\n' + JSON.stringify(v, null, 1)); };
const NAMES = ['手冲咖啡壶', '陶瓷滤杯', '单品豆 250g', '手摇磨豆机', '电子秤', '滤纸 100 张', '保温杯', '壶嘴清洁刷'];
const HOST = 'http://127.0.0.1:3000';

const reqs = (p) => p.events.filter((e) => e.method === 'Network.requestWillBeSent').map((e) => e.params.request);
const resps = (p) => p.events.filter((e) => e.method === 'Network.responseReceived').map((e) => ({
  url: e.params.response.url, status: e.params.response.status, mime: e.params.response.mimeType,
  len: e.params.response.headers['Content-Length'] || e.params.response.headers['content-length'] || null,
  csp: e.params.response.headers['Content-Security-Policy'] || e.params.response.headers['content-security-policy'] || null,
}));
const fails = (p) => p.events.filter((e) => e.method === 'Network.loadingFailed').map((e) => ({ err: e.params.errorText, blocked: e.params.blockedReason || null }));
const IMGS = "(()=>{const a=[...document.querySelectorAll('img')];return JSON.stringify(a.map(i=>{const r=i.getBoundingClientRect();"
  + "return {src:i.getAttribute('src'),alt:(i.alt||'').slice(0,30),complete:i.complete,nat:i.naturalWidth+'x'+i.naturalHeight,nw:i.naturalWidth,"
  + "cw:Math.round(r.width),ch:Math.round(r.height),shown:r.width>0&&r.height>0};}));})()";
const imgs = async (p) => JSON.parse(await p.eval(IMGS));
const devBytes = (f) => { try { return fs.statSync('web/assets/products/' + f).size; } catch { return null; } };

const p = await openPage({ width: 390, height: 844, dsf: 2, mobile: true });
await p.send('Network.enable', {}, p.sid);
await p.send('Network.clearBrowserCookies', {}, p.sid);

// ── 1. 首页 390（README-home-390 + B 组读数）────────────────────────────
await p.navigate(HOST + '/', 3500);
const HOME = "(()=>{const cs=e=>getComputedStyle(e);const box=e=>{const r=e.getBoundingClientRect();return [Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)];};"
  + "const cards=[...document.querySelectorAll('li.card,.card')];const grid=document.querySelector('ul.grid,.grid,.product-grid');"
  + "const gcs=grid?cs(grid):{};const imgs=[...document.querySelectorAll('img[src*=\"/assets/products/\"]')];"
  + "const c0=cards[0];const c0i=c0?c0.querySelector('img'):null;"
  + "const tabs=[...document.querySelectorAll('.tabbar__item')];const act=document.querySelector('.tabbar__item.is-active');"
  + "const shadow=[...document.querySelectorAll('*')].filter(e=>{const s=cs(e).boxShadow;return s&&s!=='none';}).length;"
  + "const badges=[...document.querySelectorAll('[class*=badge],[class*=tag],[class*=label]')].map(e=>({cls:(e.className||'').toString().slice(0,40),txt:(e.innerText||'').trim().slice(0,8),bg:cs(e).backgroundColor}));"
  + "const ctas=[...document.querySelectorAll('.btn--cta')].map(e=>({txt:(e.innerText||'').trim().slice(0,12),h:Math.round(e.getBoundingClientRect().height),radius:cs(e).borderRadius,bgImg:cs(e).backgroundImage,color:cs(e).color}));"
  + "return JSON.stringify({title:document.title,hash:location.hash,bodyBg:cs(document.body).backgroundColor,"
  + "cardBg:c0?cs(c0).backgroundColor:null,cardRadius:c0?cs(c0).borderRadius:null,cardShadow:c0?cs(c0).boxShadow:null,"
  + "cols:gcs.gridTemplateColumns||null,colsN:(gcs.gridTemplateColumns||'').split(' ').filter(Boolean).length,"
  + "cardOrder:c0?[...c0.children].map(e=>e.tagName+'.'+(e.className||'').toString().split(' ')[0]).join('>'):null,"
  + "titleLines:c0&&c0.querySelector('.card__title')?cs(c0.querySelector('.card__title')).webkitLineClamp:null,"
  + "imgsN:imgs.length,imgsLoaded:imgs.filter(i=>i.complete&&i.naturalWidth>0).length,"
  + "img0:c0i?{src:c0i.getAttribute('src'),nat:c0i.naturalWidth+'x'+c0i.naturalHeight,box:box(c0i),of:cs(c0i).objectFit,pctOfCard:c0?Math.round(100*c0i.getBoundingClientRect().height/c0.getBoundingClientRect().height):null}:null,"
  + "prices:[...document.querySelectorAll('[class*=price]')].slice(0,4).map(e=>({cls:(e.className||'').toString().slice(0,30),txt:(e.innerText||'').replace(/\\n/g,''),fs:cs(e).fontSize,color:cs(e).color,fw:cs(e).fontWeight})),"
  + "tabbar:{n:tabs.length,txt:tabs.map(e=>(e.innerText||'').trim().slice(0,10)),active:act?(act.innerText||'').trim().slice(0,10):null,activeColor:act?cs(act).color:null},"
  + "searchBox:!!document.querySelector('#search-input,input[type=search]'),shadowEls:shadow,badgesN:badges.length,badges:badges.slice(0,6),ctas:ctas,"
  + "hScroll:document.documentElement.scrollWidth>innerWidth,innerW:innerWidth,scrollW:document.documentElement.scrollWidth,"
  + "oldTokens:(()=>{const OLD=['rgb(13, 17, 23)','rgb(22, 27, 34)'];let h=0;for(const e of document.querySelectorAll('*')){const s=cs(e);for(const k of ['backgroundColor','color','borderTopColor','backgroundImage','boxShadow']){if(OLD.some(o=>(s[k]||'').includes(o))){h++;break;}}}return h;})()"
  + "},null,1);})()";
log('U19_U20_U21_U22_U23_U24_U25_home390', JSON.parse(await p.eval(HOME)));
log('U19_home390_imgs', await imgs(p));
log('U27_home_net', resps(p).filter((r) => /assets\/products/.test(r.url)));
log('U28_home_hosts', [...new Set(reqs(p).map((r) => new URL(r.url).host))]);
log('U28_home_csp', resps(p).map((r) => r.csp).filter(Boolean).slice(0, 2));
log('U28_home_imgSchemes', [...new Set((await imgs(p)).map((i) => (i.src || '').split(':')[0]))]);
await p.shotFull(outDir('README-home-390.png'));

// ── 1b. 旧 SVG 残留排查：页面里所有 data:image/svg 的来源元素（U-27 相关）──
const SVGS = "(()=>{const out=[];for(const e of document.querySelectorAll('*')){const s=getComputedStyle(e);const bg=s.backgroundImage||'';"
  + "const src=(e.getAttribute&&(e.getAttribute('src')||''))||'';if(/data:image\\/svg/i.test(bg)||/data:image\\/svg/i.test(src)){const r=e.getBoundingClientRect();"
  + "out.push({tag:e.tagName.toLowerCase(),cls:(e.className||'').toString().slice(0,40),alt:(e.alt||'').slice(0,20),kind:src?'img-src':'bg-image',"
  + "w:Math.round(r.width),h:Math.round(r.height),head:(src||bg).slice(0,30)});}}return JSON.stringify(out);})()";
log('U27_home_svgSources', JSON.parse(await p.eval(SVGS)));
log('U39_favicon', resps(p).filter((r) => /favicon/.test(r.url)));
log('U27_home_allImgSrcs', (await imgs(p)).map((i) => i.src));

// ── 2. 首页 1280 ────────────────────────────────────────────────────
await p.setMetrics({ width: 1280, height: 900, dsf: 1, mobile: false });
await p.wait(800);
const W1280 = "(()=>{const g=document.querySelector('ul.grid,.grid,.product-grid');const gcs=g?getComputedStyle(g):{};"
  + "const cards=[...document.querySelectorAll('li.card,.card')];return JSON.stringify({cols:gcs.gridTemplateColumns||null,"
  + "colsN:(gcs.gridTemplateColumns||'').split(' ').filter(Boolean).length,hScroll:document.documentElement.scrollWidth>innerWidth,"
  + "innerW:innerWidth,scrollW:document.documentElement.scrollWidth,containerW:g?Math.round(g.getBoundingClientRect().width):null,"
  + "bodyBg:getComputedStyle(document.body).backgroundColor,imgsLoaded:[...document.querySelectorAll('img[src*=\"/assets/products/\"]')].filter(i=>i.complete&&i.naturalWidth>0).length});})()";
log('U19_U52_home1280', JSON.parse(await p.eval(W1280)));
await p.shotFull(outDir('README-home-1280.png'));

// ── 3. U-26 逐件人工看图对货（按商品名点进详情 + 裁主图）─────────────
await p.setMetrics({ width: 390, height: 844, dsf: 3, mobile: true });
const detail = [];
for (let i = 0; i < NAMES.length; i++) {
  const nm = NAMES[i];
  await p.navigate(HOST + '/', 2600);
  const clicked = await p.eval(`(()=>{const c=[...document.querySelectorAll('li.card,.card')].find(x=>(x.innerText||'').includes(${JSON.stringify(nm)}));`
    + "if(!c)return null;const a=c.querySelector('a')||c;const r=a.getBoundingClientRect();a.scrollIntoView({block:'center'});return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
  if (!clicked || clicked.__error) { detail.push({ name: nm, error: 'card not found' }); continue; }
  await p.wait(200);
  const c2 = await p.eval(`(()=>{const c=[...document.querySelectorAll('li.card,.card')].find(x=>(x.innerText||'').includes(${JSON.stringify(nm)}));const a=c.querySelector('a')||c;const r=a.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await p.clickAt(c2.x, c2.y);
  await p.wait(2200);
  const info = JSON.parse(await p.eval("(()=>{const ims=[...document.querySelectorAll('img[src*=\"/assets/products/\"]')];"
    + "ims.sort((a,b)=>(b.naturalWidth*b.naturalHeight)-(a.naturalWidth*a.naturalHeight));const im=ims[0];"
    + "const cs=getComputedStyle(document.body);const r=im?im.getBoundingClientRect():null;"
    + "return JSON.stringify({hash:location.hash,pageText:(document.body.innerText||'').replace(/\\n+/g,' | ').slice(0,220),"
    + "src:im?im.getAttribute('src'):null,nat:im?im.naturalWidth+'x'+im.naturalHeight:null,shown:im?Math.round(r.width)+'x'+Math.round(r.height):null,"
    + "complete:im?im.complete:null,clip:im?{x:r.x+scrollX,y:r.y+scrollY,w:r.width,h:r.height}:null});})()"));
  if (info.clip) {
    const f = outDir(`U-26-主图对货-0${i + 1}-${nm}.png`);
    const s = await p.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: info.clip.x, y: info.clip.y, width: info.clip.w, height: info.clip.h, scale: 1 } }, p.sid);
    fs.writeFileSync(f, Buffer.from(s.result.data, 'base64'));
    info.crop = f.split('/').pop();
    if (i === 0) await p.shotFull(outDir('README-detail.png'));
  }
  info.fileBytes = info.src ? devBytes(info.src.replace('/assets/products/', '')) : null;
  detail.push({ name: nm, ...info });
}
log('U26_detail_per_product', detail);
log('U27_detail_net', resps(p).filter((r) => /assets\/products/.test(r.url)));
log('U27_detail_fails', fails(p));

// ── 4. 登录 → 加购 → 购物车（README-cart）→ 结算 → 下单 → 订单（README-orders）
const acct = { email: 'uat-demo@example.local', password: 'uat-demo-pass-2026' };
await p.navigate(HOST + '/#/login', 2400);
await p.clickSel('#auth-email'); await p.send('Input.insertText', { text: acct.email }, p.sid);
await p.clickSel('#auth-password'); await p.send('Input.insertText', { text: acct.password }, p.sid);
const nLogin = reqs(p).length;
await p.eval("(()=>{const b=[...document.querySelectorAll('button')].find(x=>/登录/.test(x.innerText));b.click();return 1;})()");
await p.wait(2400);
log('U01_login', { afterText: (await p.eval('document.body.innerText')).replace(/\n+/g, ' | ').slice(0, 200), newReqs: reqs(p).slice(nLogin).map((r) => r.method + ' ' + r.url) });

const addOne = async (nm) => {
  await p.navigate(HOST + '/', 2400);
  const c = await p.eval(`(()=>{const k=[...document.querySelectorAll('li.card,.card')].find(x=>(x.innerText||'').includes(${JSON.stringify(nm)}));`
    + "if(!k)return null;const a=k.querySelector('a')||k;const r=a.getBoundingClientRect();a.scrollIntoView({block:'center'});return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
  await p.wait(200);
  const c2 = await p.eval(`(()=>{const k=[...document.querySelectorAll('li.card,.card')].find(x=>(x.innerText||'').includes(${JSON.stringify(nm)}));const a=k.querySelector('a')||k;const r=a.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await p.clickAt(c2.x, c2.y); await p.wait(2000);
  const n = reqs(p).length;
  await p.clickSel('.btn--cta'); await p.wait(2000);
  return reqs(p).slice(n).map((r) => r.method + ' ' + r.url);
};
log('U01_add_cart_1', await addOne('单品豆 250g'));
await p.navigate(HOST + '/#/cart', 2400);
log('U27_cart_imgs', await imgs(p));
log('U27_cart_net', resps(p).filter((r) => /assets\/products/.test(r.url)));
log('U28_cart_hosts', [...new Set(reqs(p).map((r) => new URL(r.url).host))]);
await p.shotFull(outDir('README-cart.png'));

// ── 5. U-50 件数上限禁用态 ─────────────────────────────────────────
const qbtn = "(()=>{const rows=[...document.querySelectorAll('li,tr,div')].filter(e=>/单品豆/.test(e.innerText||'')&&/¥|\\d/.test(e.innerText||''));"
  + "const row=rows[rows.length-1]||document.body;const bs=[...row.querySelectorAll('button')];return JSON.stringify({rowText:(row.innerText||'').replace(/\\n+/g,' | ').slice(0,120),"
  + "buttons:bs.map((b,i)=>({i,txt:(b.innerText||'').trim().slice(0,4),disabled:b.disabled,cls:(b.className||'').toString().slice(0,30),box:(r=>[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)])(b.getBoundingClientRect())}))});})()";
log('U50_cart_buttons_initial', JSON.parse(await p.eval(qbtn)));
// 该行商品名 + 服务端库存（同源 fetch，黑盒读数），用于判断「加到库存上限即禁用」
const rowInfo = await p.eval("(async()=>{const r=await fetch('/api/v1/products');const j=await r.json();"
  + "const rows=[...document.querySelectorAll('li,tr,div')].filter(e=>/单品豆/.test(e.innerText||''));const row=rows[rows.length-1]||document.body;"
  + "const txt=row.innerText||'';const hit=j.data.find(x=>txt.includes(x.name));return JSON.stringify({rowText:txt.replace(/\\n+/g,' | ').slice(0,160),name:hit?hit.name:null,stock:hit?hit.stock:null});})()", { awaitPromise: true });
log('U50_row_and_stock', JSON.parse(rowInfo));
// 点到 8：反复找「＋」按钮（文本 + 或含 plus），每次点击后读件数
const plusIdx = async () => JSON.parse(await p.eval(qbtn));
let steps = [];
for (let k = 0; k < 9; k++) {
  const st = await plusIdx();
  steps.push({ k, buttons: st.buttons.map((b) => ({ i: b.i, txt: b.txt, disabled: b.disabled })), row: st.rowText });
  const plus = st.buttons.find((b) => /^\+|＋|加/.test(b.txt));
  if (!plus) break;
  if (plus.disabled) { steps.push({ k, note: '＋ 已禁用，停止点击' }); break; }
  const n = reqs(p).length;
  await p.clickAt(plus.box[0] + plus.box[2] / 2, plus.box[1] + plus.box[3] / 2);
  await p.wait(1200);
  steps.push({ k, clickPlus: true, newReqs: reqs(p).slice(n).length });
}
log('U50_plus_to_8_sequence', steps);
// 在已禁用的 + 上真实点击一次（此时按钮应 disabled）
const st8 = await plusIdx();
const plus8 = st8.buttons.find((b) => /^\+|＋|加/.test(b.txt));
if (plus8) {
  const n = reqs(p).length;
  await p.clickAt(plus8.box[0] + plus8.box[2] / 2, plus8.box[1] + plus8.box[3] / 2);
  await p.wait(1200);
  log('U50_click_disabled_plus', { disabledAtClick: plus8.disabled, newReqs: reqs(p).slice(n).map((r) => r.method + ' ' + r.url), rowAfter: (await plusIdx()).rowText });
}
// 减到 1 看「−」禁用
let minusSeq = [];
for (let k = 0; k < 9; k++) {
  const st = await plusIdx();
  const minus = st.buttons.find((b) => /^-|−|减/.test(b.txt));
  minusSeq.push({ k, row: st.rowText, minusDisabled: minus ? minus.disabled : null });
  if (!minus || minus.disabled) break;
  await p.clickAt(minus.box[0] + minus.box[2] / 2, minus.box[1] + minus.box[3] / 2);
  await p.wait(1200);
}
log('U50_minus_to_1_sequence', minusSeq);

// ── 6. U-49 提交中禁用态 + 连点只发 1 次请求 ─────────────────────────
await p.navigate(HOST + '/#/checkout', 2400);
log('U49_checkout_text', (await p.eval('document.body.innerText')).replace(/\n+/g, ' | ').slice(0, 300));
await p.eval("(()=>{window.__btn=[];const b=[...document.querySelectorAll('.btn--cta,button')].find(x=>/提交订单|结算/.test(x.innerText));"
  + "window.__btnEl=b;if(!b)return 0;window.__t=setInterval(()=>{window.__btn.push({t:Date.now(),txt:(b.innerText||'').trim().slice(0,10),dis:b.disabled});},25);return 1;})()");
const nSubmit = reqs(p).length;
await p.clickSel('.btn--cta'); await p.wait(400);
const mid = await p.eval("(()=>{const b=window.__btnEl;return JSON.stringify({txt:b?(b.innerText||'').trim().slice(0,10):null,dis:b?b.disabled:null});})()");
await p.clickSel('.btn--cta'); await p.wait(2500);
const samples = await p.eval("(()=>{clearInterval(window.__t);const s=window.__btn||[];const uniq=[];for(const x of s){const k=x.txt+'/'+x.dis;if(!uniq.length||uniq[uniq.length-1].k!==k)uniq.push({k,t:x.t});}return JSON.stringify(uniq);})()");
log('U49_submit_state', { duringSubmit: JSON.parse(mid), samples: JSON.parse(samples), newReqs: reqs(p).slice(nSubmit).map((r) => r.method + ' ' + r.url) });
await p.wait(1500);
log('U27_orders_imgs', await imgs(p));
log('U28_orders_hosts', [...new Set(reqs(p).map((r) => new URL(r.url).host))]);
await p.shotFull(outDir('README-orders.png'));
log('U01_after_submit_text', (await p.eval('document.body.innerText')).replace(/\n+/g, ' | ').slice(0, 260));

// ── 7. U-28 五页 host 集合（清记录后逐页重载）───────────────────────
{
  const pages = ['/#/', '/#/cart', '/#/checkout', '/#/orders'];
  const hosts = {};
  for (const u of pages) {
    const n = reqs(p).length;
    await p.navigate(HOST + u, 2600);
    hosts[u] = { hosts: [...new Set(reqs(p).slice(n).map((r) => new URL(r.url).host))], n: reqs(p).length - n };
  }
  log('U28_five_pages_hosts', hosts);
  const imgSchemes = [...new Set((await imgs(p)).map((i) => (i.src || '').split(':')[0]))];
  log('U28_orders_imgSchemes', imgSchemes);
}

// ── 8. U-29 拦截所有非环回请求后重载（模拟「除本机服务外无外网」）────
{
  await p.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }, p.sid);
  let seen = 0; const killed = []; let idx = 0;
  const pump = async () => {
    for (; idx < p.events.length; idx++) {
      const e = p.events[idx];
      if (e.method !== 'Fetch.requestPaused') continue;
      seen++;
      let host = '';
      try { host = new URL(e.params.request.url).hostname; } catch { /* ignore */ }
      const local = host === '127.0.0.1' || host === 'localhost';
      if (local) await p.send('Fetch.continueRequest', { requestId: e.params.requestId }, p.sid);
      else { killed.push(e.params.request.url); await p.send('Fetch.failRequest', { requestId: e.params.requestId, errorReason: 'InternetDisconnected' }, p.sid); }
    }
  };
  const timer = setInterval(() => { pump().catch(() => {}); }, 60);
  await p.navigate(HOST + '/#/', 3200);
  const homeImgs = await imgs(p);
  await pump();
  // 用商品名点进详情（步骤与判据一律用商品名定位，不写夹具主键）
  const c29 = await p.eval("(()=>{const k=[...document.querySelectorAll('li.card,.card')].find(x=>(x.innerText||'').includes('手冲咖啡壶'));if(!k)return null;const a=k.querySelector('a')||k;const r=a.getBoundingClientRect();a.scrollIntoView({block:'center'});return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
  await pump();
  const c29b = await p.eval("(()=>{const k=[...document.querySelectorAll('li.card,.card')].find(x=>(x.innerText||'').includes('手冲咖啡壶'));const a=k.querySelector('a')||k;const r=a.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
  if (c29 && !c29.__error) { await p.clickAt(c29b.x, c29b.y); await p.wait(2600); await pump(); }
  const detailImgs = await imgs(p);
  clearInterval(timer); await pump();
  await p.send('Fetch.disable', {}, p.sid);
  log('U29_blocked_nonloopback', { pausedSeen: seen, killed: killed, homeImgs: { n: homeImgs.length, loaded: homeImgs.filter((i) => i.complete && i.nw > 0).length }, detailImgs: { n: detailImgs.length, loaded: detailImgs.filter((i) => i.complete && i.nw > 0).length } });
}

// ── 9. U-52 观察：购物车/首页截图已出；补一张详情页（README-detail 已出）
log('DONE', { shots: fs.readdirSync(outDir('')).filter((f) => /^README-|^U-26-/.test(f)) });
fs.writeFileSync(outDir('r4-browser.json'), JSON.stringify(R, null, 1));
await p.close();
console.log('\nR4_BROWSER_DONE');
