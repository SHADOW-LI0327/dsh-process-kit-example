// FEAT-002 UAT · 匿名车归属语义判别（注册是否并入 / 登录是否并入）+ 真实请求载荷取证
// 关键：先 Network.clearBrowserCookies 造一个干净匿名会话，避免上一轮 cookie 串味。
import { openPage, outDir } from './lib-cdp.mjs';
import fs from 'node:fs';

const S = [];
const step = (n, d) => { S.push({ n, d }); console.log('\n== ' + n + ' ==\n' + JSON.stringify(d, null, 1)); };
const p = await openPage({ width: 390, height: 844, dsf: 2, mobile: true });
await p.send('Network.enable', {}, p.sid);
await p.send('Network.clearBrowserCookies', {}, p.sid);
const reqs = () => p.events.filter((e) => e.method === 'Network.requestWillBeSent').map((e) => e.params.request);
const since = (n) => reqs().slice(n).map((r) => ({ m: r.method, u: r.url.replace('http://127.0.0.1:3000', ''), body: r.postData || null }));

const CART = "(()=>{const t=(document.body.innerText||'').replace(/\\n+/g,' | ');return JSON.stringify({hash:location.hash,"
  + "lines:[...document.querySelectorAll('[class*=line]')].map(e=>(e.innerText||'').replace(/\\n+/g,' ').trim()).filter(Boolean),"
  + "badge:(document.querySelector('.tabbar__count')||{}).innerText||null,total:(t.match(/合计[^|]*\\|[^|]*/)||[''])[0],"
  + "snippet:t.slice(0,220)},null,1);})()";
const cartState = async () => JSON.parse(await p.eval(CART));
const addByUi = async (pid) => {
  await p.navigate('http://127.0.0.1:3000/#/products/' + pid, 2200);
  const n = reqs().length;
  await p.clickSel('.btn--cta');
  await p.wait(1500);
  return since(n);
};
const authByUi = async (kind, email, pw) => {
  await p.navigate('http://127.0.0.1:3000/#/login', 2000);
  const n = reqs().length;
  await p.clickSel('#auth-email'); await p.send('Input.insertText', { text: email }, p.sid);
  await p.clickSel('#auth-password'); await p.send('Input.insertText', { text: pw }, p.sid);
  const val = await p.eval("JSON.stringify({e:(document.querySelector('#auth-email')||{}).value,p:(document.querySelector('#auth-password')||{}).value})");
  const btn = kind === 'register' ? /注册新账号/ : /^登录/;
  const clicked = await p.eval("(()=>{const b=[...document.querySelectorAll('button')].find(x=>" + btn + ".test(x.innerText.trim()));if(!b)return null;b.click();return b.innerText.trim();})()");
  await p.wait(2400);
  return { filled: val, clicked, reqs: since(n), hash: await p.eval('location.hash'), body: (await p.eval("document.body.innerText.replace(/\\n+/g,' | ').slice(0,260)")) };
};

const email = 'uat-merge+' + Date.now() + '@example.com';
const pw = 'uat-pass-12345';
fs.writeFileSync(outDir('p3-account.txt'), email + ' / ' + pw + '\n');

// ① 干净匿名会话：加 单品豆
step('M1 干净匿名加购 单品豆', { add: await addByUi('P-003'), cart: await cartState() });
await p.navigate('http://127.0.0.1:3000/#/cart', 1600);
const anon1 = await cartState();
step('M2 匿名车（注册前）', anon1);
await p.shot(outDir('M2-390注册前匿名车.png'));

// ② 注册：匿名车是否并入账号车
const reg = await authByUi('register', email, pw);
step('M3 注册调用', reg);
await p.navigate('http://127.0.0.1:3000/#/cart', 1800);
const afterReg = await cartState();
step('M4 注册后购物车', afterReg);
await p.shot(outDir('M4-390注册后购物车.png'));

// ③ 给账号车加一件 陶瓷滤杯，然后退出，匿名加 手摇磨豆机，再登录：判别并入
step('M5 账号车加购 陶瓷滤杯', { add: await addByUi('P-002') });
await p.navigate('http://127.0.0.1:3000/#/cart', 1600);
step('M6 账号车（登录时）', await cartState());
await p.navigate('http://127.0.0.1:3000/#/me', 1600);
await p.eval("(()=>{const b=[...document.querySelectorAll('button')].find(x=>/退出登录/.test(x.innerText));if(b)b.click();return 1;})()");
await p.wait(1800);
step('M7 退出后', { cart: await cartState(), add: await addByUi('P-004') });
await p.navigate('http://127.0.0.1:3000/#/cart', 1600);
const anon2 = await cartState();
step('M8 匿名车（登录前，应为 磨豆机 1 件）', anon2);
const login = await authByUi('login', email, pw);
step('M9 登录调用', login);
await p.navigate('http://127.0.0.1:3000/#/cart', 1800);
const afterLogin = await cartState();
step('M10 登录后购物车（判别并入）', afterLogin);
await p.shot(outDir('M10-390登录后购物车.png'));

step('M11 结论数据', { anon1: anon1.lines, afterReg: afterReg.lines, anon2: anon2.lines, afterLogin: afterLogin.lines });
fs.writeFileSync(outDir('p3-merge.json'), JSON.stringify(S, null, 1));
await p.close();
console.log('\nOK');
