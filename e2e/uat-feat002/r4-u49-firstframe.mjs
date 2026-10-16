// FEAT-002 UAT r4 · U-49① 首帧占位专项（限速后切页，逐 25ms 记文案时间线 + 等待中截图）
import { openPage, outDir } from './lib-cdp.mjs';
import fs from 'node:fs';
const R = {}; const log = (k, v) => { R[k] = v; console.log('\n===== ' + k + ' =====\n' + JSON.stringify(v, null, 1)); };
const HOST = 'http://127.0.0.1:3000';
const p = await openPage({ width: 390, height: 844, dsf: 2, mobile: true });
await p.send('Network.enable', {}, p.sid);
await p.send('Network.clearBrowserCookies', {}, p.sid);

const timeline = async (label, clickJs, shotAt) => {
  await p.eval("(()=>{window.__t=[];window.__i=setInterval(()=>{const b=document.body.innerText||'';window.__t.push({ms:Date.now(),txt:b.replace(/\\n+/g,' | ').slice(0,90),load:/加载中|载入中|Loading/i.test(b)});},25);return 1;})()");
  const t0 = Date.now();
  if (clickJs) await p.eval(clickJs);
  await p.wait(shotAt);
  const shot = await p.shot(outDir(`U-49-首帧占位-${label}-等待中.png`));
  await p.wait(Math.max(200, 4500 - shotAt));
  const s = JSON.parse(await p.eval("(()=>{clearInterval(window.__i);return JSON.stringify(window.__t);})()"));
  const uniq = [];
  for (const x of s) if (!uniq.length || uniq[uniq.length - 1].txt !== x.txt) uniq.push({ t: x.ms - t0, txt: x.txt, load: x.load });
  return { label, totalSamples: s.length, loadingSeen: s.filter((x) => x.load).length, states: uniq.slice(0, 8), shot: shot.split('/').pop() };
};

// ① 冷启动首页（限速 1500ms 延迟）
await p.send('Network.emulateNetworkConditions', { offline: false, latency: 1500, downloadThroughput: 20000, uploadThroughput: 20000 }, p.sid);
await p.send('Network.setCacheDisabled', { cacheDisabled: true }, p.sid);
await p.navigate(HOST + '/', 2500);
log('U49_1_home_cold', await timeline('01-首页冷启动', null, 700));
// ② 切到订单列表
log('U49_2_orders_tab', await timeline('02-切到订单列表', "(()=>{const a=[...document.querySelectorAll('.tabbar__item')].find(x=>/订单/.test(x.innerText));a.click();return 1;})()", 900));
// ③ 切到商品详情
log('U49_3_detail', await timeline('03-切到商品详情', "(()=>{location.hash='#/products';return 1;})()", 300));
await p.wait(4200);
log('U49_3b_detail', await timeline('03b-点卡片进详情', "(()=>{const k=document.querySelector('li.card a');k.click();return 1;})()", 900));
await p.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, p.sid);
await p.send('Network.setCacheDisabled', { cacheDisabled: false }, p.sid);
fs.writeFileSync(outDir('r4-u49-firstframe.json'), JSON.stringify(R, null, 1));
await p.close();
console.log('\nR4_U49_DONE');
