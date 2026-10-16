// FEAT-002 UAT · 断网渲染（CDP Network.emulateNetworkConditions offline:true）
import { openPage, outDir } from './lib-cdp.mjs';
import fs from 'node:fs';

const S = [];
const step = (n, d) => { S.push({ n, d }); console.log('\n== ' + n + ' ==\n' + JSON.stringify(d, null, 1)); };
const p = await openPage({ width: 390, height: 844, dsf: 2, mobile: true });
const STATE = "(()=>{const imgs=[...document.querySelectorAll('img')];"
  + "return JSON.stringify({hash:location.hash,textLen:(document.body.innerText||'').trim().length,"
  + "text:(document.body.innerText||'').replace(/\\n+/g,' | ').slice(0,300),"
  + "imgs:imgs.length,imgsVisible:imgs.filter(i=>i.complete&&i.naturalWidth>0).length,"
  + "shell:{topbar:!!document.querySelector('.topbar'),tabbar:!!document.querySelector('.tabbar'),cards:document.querySelectorAll('.card,[class*=card]').length},"
  + "hasErrorHint:/失败|错误|重试|网络|离线|无法/.test(document.body.innerText||'')},null,1);})()";
const at = async (l) => {
  let v;
  try { v = JSON.parse(await p.eval(STATE)); } catch (e) { v = { evalError: String(e).slice(0, 160) }; }
  step(l, v); return v;
};

await p.navigate('http://127.0.0.1:3000/', 3200);
const online = await at('O1 在线首页（基线）');
await p.eval('window.scrollTo(0, 600)'); await p.wait(600);

// 断网
await p.send('Network.enable', {}, p.sid);
await p.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, p.sid);
await p.wait(400);
const off1 = await at('O2 断网后：已打开页面是否仍可看');
await p.shot(outDir('O2-390断网已打开页面.png'));
await p.eval('window.scrollTo(0, 1200)'); await p.wait(500);
const off1b = await at('O3 断网后滚动（首屏外的图）');
await p.shot(outDir('O3-390断网滚动.png'));

// 断网下切换路由（触发数据请求）
await p.eval("location.hash = '#/cart'"); await p.wait(2500);
const off2 = await at('O4 断网下切到购物车');
await p.shot(outDir('O4-390断网购物车.png'));
await p.eval("location.hash = '#/products'"); await p.wait(2500);
const off3 = await at('O5 断网下切到商品列表');
await p.shot(outDir('O5-390断网商品列表.png'));

// 断网整页重载
await p.send('Page.reload', {}, p.sid); await p.wait(3000);
let reload = null;
try { reload = JSON.parse(await p.eval(STATE)); } catch (e) { reload = { error: String(e).slice(0, 120) }; }
step('O6 断网整页重载', reload);
await p.shot(outDir('O6-390断网重载.png'));

// 恢复在线
await p.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, p.sid);
await p.wait(600);
await p.navigate('http://127.0.0.1:3000/#/products', 3000);
const back = await at('O7 恢复在线后');
await p.shot(outDir('O7-390恢复在线.png'));

fs.writeFileSync(outDir('p4-offline.json'), JSON.stringify({ online, off1, off1b, off2, off3, reload, back, S }, null, 1));
await p.close();
console.log('\nOK');
