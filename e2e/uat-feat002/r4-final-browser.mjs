// FEAT-002 UAT r4 · 收口补测（浏览器侧）：U-29 断网替代装置 / data: SVG 来源辨认 / U-49① 首帧占位
import { openPage, outDir } from './lib-cdp.mjs';
import fs from 'node:fs';
const R = {}; const log = (k, v) => { R[k] = v; console.log('\n===== ' + k + ' =====\n' + JSON.stringify(v, null, 1)); };
const HOST = 'http://127.0.0.1:3000';
const IMGS = "(()=>{const a=[...document.querySelectorAll('img')];return JSON.stringify(a.map(i=>{const r=i.getBoundingClientRect();"
  + "return {src:i.getAttribute('src'),alt:(i.alt||'').slice(0,20),complete:i.complete,nw:i.naturalWidth,nh:i.naturalHeight,cw:Math.round(r.width),ch:Math.round(r.height)};}));})()";
const imgs = async (p) => JSON.parse(await p.eval(IMGS));
const reqs = (p) => p.events.filter((e) => e.method === 'Network.requestWillBeSent').map((e) => e.params.request.url);

const p = await openPage({ width: 390, height: 844, dsf: 2, mobile: true });
await p.send('Network.enable', {}, p.sid);
await p.send('Network.clearBrowserCookies', {}, p.sid);

// ── U-29 断网替代装置：Fetch 拦截把所有**非环回**请求判失败，然后硬重载 ──
await p.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }, p.sid);
await p.send('Network.setCacheDisabled', { cacheDisabled: true }, p.sid);
let idx = 0, seen = 0, killed = [], cont = 0;
const pumpOnce = async () => {
  while (idx < p.events.length) {
    const e = p.events[idx++];
    if (e.method !== 'Fetch.requestPaused') continue;
    seen++;
    let host = ''; try { host = new URL(e.params.request.url).hostname; } catch { /* ignore */ }
    if (host === '127.0.0.1' || host === 'localhost') { cont++; await p.send('Fetch.continueRequest', { requestId: e.params.requestId }, p.sid); }
    else { killed.push(e.params.request.url); await p.send('Fetch.failRequest', { requestId: e.params.requestId, errorReason: 'InternetDisconnected' }, p.sid); }
  }
};
let running = true;
const loop = (async () => { while (running) { await pumpOnce(); await new Promise((r) => setTimeout(r, 15)); } })();
await p.navigate(HOST + '/', 3500);
const home = await imgs(p);
const homeReqs = [...new Set(reqs(p).map((u) => { try { return new URL(u).host || 'data:'; } catch { return 'data:'; } }))];
const ext = await p.eval("fetch('https://example.com/probe').then(r=>'external-ok:'+r.status).catch(e=>'external-blocked:'+e.name)", { awaitPromise: true });
// 详情页也确认一次
const c = await p.eval("(()=>{const k=[...document.querySelectorAll('li.card,.card')].find(x=>(x.innerText||'').includes('手冲咖啡壶'));if(!k)return null;const a=k.querySelector('a')||k;const r=a.getBoundingClientRect();a.scrollIntoView({block:'center'});return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
await p.wait(250);
const c2 = await p.eval("(()=>{const k=[...document.querySelectorAll('li.card,.card')].find(x=>(x.innerText||'').includes('手冲咖啡壶'));const a=k.querySelector('a')||k;const r=a.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
if (c && !c.__error) { await p.clickAt(c2.x, c2.y); await p.wait(2600); }
const det = await imgs(p);
running = false; await loop;
await p.send('Fetch.disable', {}, p.sid);
await p.send('Network.setCacheDisabled', { cacheDisabled: false }, p.sid);
log('U29_interception', {
  pausedSeen: seen, continuedLoopback: cont, killedNonLoopback: killed, externalProbe: ext,
  home: { n: home.length, loaded: home.filter((i) => i.complete && i.nw > 0).length, hosts: homeReqs },
  detail: { n: det.length, loaded: det.filter((i) => i.complete && i.nw > 0).length, srcs: det.map((i) => i.src + ' ' + i.nw + 'x' + i.nh) },
});

// ── data:image/svg 来源辨认（首页 / 购物车 / 订单 / 登录各扫一遍）──
const SVGSRC = "(()=>{const out=[];for(const e of document.querySelectorAll('*')){const s=getComputedStyle(e);const bg=s.backgroundImage||'';"
  + "const src=(e.getAttribute&&(e.getAttribute('src')||''))||'';if(/data:image\\/svg/i.test(bg)||/data:image\\/svg/i.test(src)){"
  + "const r=e.getBoundingClientRect();out.push({tag:e.tagName.toLowerCase(),cls:(e.className||'').toString().slice(0,40),alt:(e.alt||'').slice(0,20),kind:src?'img-src':'bg-image',w:Math.round(r.width),h:Math.round(r.height)});}}return JSON.stringify(out);})()";
const scan = {};
for (const u of ['/#/', '/#/cart', '/#/orders', '/#/login']) {
  await p.navigate(HOST + u, 2400);
  const before = reqs(p).length;
  await p.wait(600);
  scan[u] = { dataSources: JSON.parse(await p.eval(SVGSRC)), dataRequests: reqs(p).slice(before).filter((x) => x.startsWith('data:')) };
}
log('dataUri_sources', scan);

// ── U-49① 首帧占位：把网络限速后再切页，采样 body 文案 ──
await p.send('Network.emulateNetworkConditions', { offline: false, latency: 1200, downloadThroughput: 8000, uploadThroughput: 8000 }, p.sid);
await p.navigate(HOST + '/#/', 3000);
const SAMPLER = "(()=>{window.__s=[];const t=setInterval(()=>{window.__s.push({t:Date.now(),txt:(document.body.innerText||'').replace(/\\n+/g,' | ').slice(0,80),hasLoading:/加载中|载入中|Loading/i.test(document.body.innerText||'')});},25);window.__stop=()=>{clearInterval(t);return JSON.stringify(window.__s);};return 1;})()";
await p.eval(SAMPLER);
await p.eval("(()=>{const a=[...document.querySelectorAll('.tabbar__item')].find(x=>/订单/.test(x.innerText));a.click();return 1;})()");
await p.wait(4000);
const samples = JSON.parse(await p.eval('window.__stop()'));
const loadingSamples = samples.filter((s) => s.hasLoading);
log('U49_first_frame', {
  samples: samples.length,
  loadingSeen: loadingSamples.length,
  firstLoading: loadingSamples[0] || null,
  seq: samples.filter((s, i, a) => i === 0 || s.hasLoading !== a[i - 1].hasLoading).map((s) => s.txt + ' [loading=' + s.hasLoading + ']').slice(0, 6),
});
await p.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, p.sid);
await p.wait(1500);
await p.shot(outDir('U-49-首帧占位-01-限速后订单页.png'));
fs.writeFileSync(outDir('r4-final-browser.json'), JSON.stringify(R, null, 1));
await p.close();
console.log('\nR4_FINAL_BROWSER_DONE');
