// FEAT-002 UAT · P-19 复验（用户视角）：真实浏览器打 https://localhost/，看页面是否真渲染 + cookie 是否 Secure
import { openPage, outDir } from './lib-cdp.mjs';
import fs from 'node:fs';

const S = [];
const step = (n, d) => { S.push({ n, d }); console.log('\n== ' + n + ' ==\n' + JSON.stringify(d, null, 1)); };

const p = await openPage({ width: 390, height: 844, dsf: 2, mobile: true });
await p.send('Security.enable', {}, p.sid);
const ignore = await p.send('Security.setIgnoreCertificateErrors', { ignore: true }, p.sid);
step('Security.setIgnoreCertificateErrors', { ok: !ignore.error, error: ignore.error || null });
await p.send('Network.enable', {}, p.sid);
await p.send('Network.clearBrowserCookies', {}, p.sid);
p.events.length = 0;

await p.navigate('https://localhost/', 5000);
const page = JSON.parse(await p.eval(`JSON.stringify({
  url: location.href, protocol: location.protocol, title: document.title,
  bodyHead: document.body.innerText.replace(/\\n+/g,' | ').slice(0,220),
  certInterstitial: /Privacy error|不是私密连接|您的连接不是私密连接|NET::ERR_CERT/i.test(document.body.innerText||'') || /Privacy error|interstitial/i.test(document.title||''),
  cards: document.querySelectorAll('li.card').length,
  imgs: [...document.querySelectorAll('img[src^="/assets/products/"]')].map(i=>i.complete&&i.naturalWidth>0).filter(Boolean).length,
  tabbar: [...document.querySelectorAll('.tabbar__item')].map(t=>t.innerText.trim()),
  heroTitle: (document.querySelector('.hero__title,h1')||{}).innerText||null
})`));
step('浏览器直接访问 https://localhost/（首页）', page);
await p.shot(outDir('P19-https首页390.png'));
await p.shotFull(outDir('P19-https首页390-full.png'));

// 真实用户操作：登录页注册（触发经反代下发的会话 cookie）
await p.navigate('https://localhost/#/login', 3000);
const email = 'uat-p19b-browser+' + Date.now() + '@example.com';
await p.clickSel('#auth-email'); await p.send('Input.insertText', { text: email }, p.sid);
await p.clickSel('#auth-password'); await p.send('Input.insertText', { text: 'uat-pass-12345' }, p.sid);
await p.eval("(()=>{const b=[...document.querySelectorAll('button')].find(x=>/注册新账号/.test(x.innerText));b.click();return 1;})()");
await p.wait(2600);
const me = JSON.parse(await p.eval(`JSON.stringify({hash:location.hash,text:document.body.innerText.replace(/\\n+/g,' | ').slice(0,160)})`));
step('经 HTTPS 注册后的页面', me);
await p.shot(outDir('P19-https我的已登录390.png'));

// cookie 属性（HttpOnly 的 document.cookie 看不到，用 CDP 取）
const ck = await p.send('Network.getCookies', { urls: ['https://localhost/', 'https://localhost/api/v1/auth/me'] }, p.sid);
step('经反代下发的 cookie（CDP Network.getCookies）', (ck.result ? ck.result.cookies : []).map(c => ({ name: c.name, domain: c.domain, secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite, path: c.path })));

// 请求域名统计（应全部 https://localhost，无第三方）
const hosts = {};
for (const e of p.events) {
  if (e.method === 'Network.requestWillBeSent') {
    try { const h = new URL(e.params.request.url).host || '(data:)'; hosts[h] = (hosts[h] || 0) + 1; } catch { hosts['(non-url)'] = (hosts['(non-url)'] || 0) + 1; }
  }
}
step('浏览器请求 host 统计（HTTPS 会话）', hosts);

// 反代下应用是否仍可写（经 HTTPS 加购）
await p.navigate('https://localhost/#/products/P-001', 3000);
await p.clickSel('.btn--cta'); await p.wait(1800);
const cart = JSON.parse(await p.eval(`JSON.stringify({hash:location.hash,badge:(document.querySelector('.tabbar__item.is-active')||{}).innerText||null})`));
await p.navigate('https://localhost/#/cart', 3000);
const cartPage = JSON.parse(await p.eval(`JSON.stringify({hash:location.hash,text:document.body.innerText.replace(/\\n+/g,' | ').slice(0,200)})`));
step('经 HTTPS 加购 → 购物车', { afterAdd: cart, cartPage });
await p.shot(outDir('P19-https购物车390.png'));

fs.writeFileSync(outDir('p8-tls-browser.json'), JSON.stringify(S, null, 1));
await p.close();
console.log('\nOK email=' + email);
