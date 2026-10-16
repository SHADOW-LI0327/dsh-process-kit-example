import { openPage, outDir } from '/Users/admin/workspace/dsh-process-kit-example/e2e/uat-feat002/lib-cdp.mjs';
const B='http://127.0.0.1:3000';
const p=await openPage({width:390,height:844,dsf:2,mobile:true});
await p.send('Network.enable',{},p.sid);
await p.send('Network.clearBrowserCookies',{},p.sid);
const E=(x,o)=>p.eval(x,o);
const T=async(n=200)=>E(`(document.body.innerText||'').replace(/\\n+/g,' | ').slice(0,${n})`);
const goHash=async(h,ms=2500)=>{await E(`location.hash=${JSON.stringify(h)}`);await p.wait(ms);};
const R={}; const stamp=Date.now().toString().slice(-6);
const fill=async(sel,val)=>{const ok=await E(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return 0;e.focus();return 1;})()`);if(ok){await p.send('Input.insertText',{text:val},p.sid);}return ok;};
const clickText=async(re)=>E(`(()=>{const els=[...document.querySelectorAll('button,a')].filter(x=>x.getBoundingClientRect().width>0);const b=els.find(x=>new RegExp(${JSON.stringify(re)}).test(x.innerText.trim()));if(!b)return 'NOT_FOUND:'+els.map(x=>x.innerText.trim().slice(0,10)).join(',');b.click();return 'clicked:'+b.innerText.trim().slice(0,12);})()`);
const tabbar=async()=>E(`(()=>{const t=document.querySelector('.tabbar');if(!t)return 'NO_TABBAR';const items=[...t.querySelectorAll('a,button')];return JSON.stringify({n:items.length,texts:items.map(x=>x.innerText.trim()),active:items.filter(x=>getComputedStyle(x).color==='rgb(122, 34, 0)').map(x=>x.innerText.trim())});})()`);
const inputIds=async()=>E(`JSON.stringify([...document.querySelectorAll('input')].map(i=>({id:i.id,type:i.type,name:i.name,ph:i.placeholder})))`);
// ---------- 1) 未登录：账号三页直达 ----------
await p.navigate(B+'/',3200);
R['1_未登录_我的页']={tab:await tabbar(),txt:await T(200),inputs:await inputIds()};
await p.shot(outDir('U-55-账号页-我的-未登录.png'));
await goHash('#/login',2600);
R['2_未登录_登录页直达']={txt:await T(220),inputs:await inputIds(),tab:await tabbar(),hash:await E('location.hash')};
await p.shot(outDir('U-55-账号页-登录-直达.png'));
await goHash('#/register',2600);
R['3_未登录_注册页直达']={txt:await T(220),inputs:await inputIds(),tab:await tabbar(),hash:await E('location.hash')};
await p.shot(outDir('U-55-账号页-注册-直达.png'));
// 从登录页入口点进注册
await goHash('#/login',2400);
R['4_登录页点注册入口']={click:await clickText('注册'),hash:await E('location.hash'),txt:await T(200),inputs:await inputIds()};
await p.wait(1200);
R['4b_点后']={hash:await E('location.hash'),txt:await T(200)};
await p.shot(outDir('U-55-账号页-注册-从登录页进入.png'));
// 注册账号 A（用注册页当前表单）
const emailA=`r5a+${stamp}@example.com`;
const ids4=JSON.parse(R['4_登录页点注册入口'].inputs||'[]');
const emailSel=ids4.find(i=>/email/.test(i.type+i.id+i.name))?('#'+ids4.find(i=>/email/.test(i.type+i.id+i.name)).id):'#auth-email';
const passSel=ids4.find(i=>/password/.test(i.type))?('#'+ids4.find(i=>/password/.test(i.type)).id):'#auth-password';
await fill(emailSel,emailA); await fill(passSel,'r5-pass-12345');
R['5_注册A提交']={click:await clickText('^注册'),txt:(await p.wait(2500),await T(240)),tab:await tabbar(),ck:await E(`document.cookie.length`)};
await p.shot(outDir('U-55-账号页-注册成功.png'));
// ---------- 6) 未登录下单（先退出，车非空） ----------
await goHash('#/products/P-002',2600);
await p.eval(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/加入购物车/.test(x.innerText));b.click();return 1;})()`);
await p.wait(1500);
R['6_已登录加购']={txt:await T(120)};
// 详情页「立即购买」在已登录状态先记录，再退出后重试
await goHash('#/me',2400);
R['7_我的页_已登录']={txt:await T(260),tab:await tabbar()};
await p.shot(outDir('U-55-账号页-我的-已登录.png'));
R['8_退出']={click:await clickText('退出'),txt:(await p.wait(2200),await T(200)),tab:await tabbar()};
await p.shot(outDir('U-55-账号页-退出后.png'));
// 未登录 + 车非空：结算页点提交
await goHash('#/checkout',2800);
R['9_未登录结算页']={txt:await T(300),hash:await E('location.hash')};
R['9b_点提交订单']={click:await clickText('提交订单'),txt:(await p.wait(2600),await T(260)),hash:await E('location.hash')};
await p.shot(outDir('U-56-未登录下单-结算页点提交.png'));
// 未登录 + 详情页点「立即购买」
await goHash('#/products/P-004',2600);
R['10_未登录详情点立即购买']={click:await clickText('立即购买'),txt:(await p.wait(2600),await T(260)),hash:await E('location.hash')};
await p.shot(outDir('U-56-未登录下单-详情点立即购买.png'));
// ---------- 11) 登录 A → 下单 → 订单详情 ----------
await goHash('#/login',2400);
await fill(emailSel,emailA); await fill(passSel,'r5-pass-12345');
R['11_登录A']={click:await clickText('^登录'),txt:(await p.wait(2600),await T(200)),tab:await tabbar()};
await goHash('#/cart',2600);
R['12_车']={txt:await T(220)};
if(!/去结算/.test(R['12_车'].txt)){
  await goHash('#/products/P-006',2400);
  await p.eval(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/加入购物车/.test(x.innerText));b.click();return 1;})()`);
  await p.wait(1500); await goHash('#/cart',2600); R['12b_补车']={txt:await T(220)};
}
await goHash('#/checkout',2600);
R['13_结算页_已登录']={txt:await T(300)};
R['13b_提交订单']={click:await clickText('提交订单'),txt:(await p.wait(3000),await T(300)),hash:await E('location.hash')};
await p.shot(outDir('U-53-下单成功.png'));
await goHash('#/orders',2800);
R['14_订单列表']={txt:await T(300)};
await p.shot(outDir('U-53-订单列表.png'));
R['15_点第一单']={click:await E(`(()=>{const a=[...document.querySelectorAll('a,button')].find(x=>/SO-/.test(x.innerText));if(!a)return 'NOT_FOUND';a.click();return 'clicked:'+a.innerText.trim().slice(0,30);})()`),txt:(await p.wait(2600),await T(320)),hash:await E('location.hash')};
await p.shot(outDir('U-53-订单详情-完整.png'));
R['15b_详情结构']=await E(`(()=>{const m=document.querySelector('main');const rows=[...document.querySelectorAll('li,tr')].map(x=>x.innerText.replace(/\\n+/g,' / ').trim()).slice(0,8);return JSON.stringify({subtitle:(document.querySelector('.page__subtitle')||{}).innerText,title:(document.querySelector('.page__title')||{}).innerText,rows});})()`);
const orderNo=(R['14_订单列表'].txt.match(/SO-[0-9]{8}-[0-9]+/)||[''])[0];
R['16_我的单号']=orderNo;
// ---------- 17) 别人/不存在的单号 ----------
await goHash('#/orders/SO-19000101-999',2600);
R['17_不存在单号']={txt:await T(260),hash:await E('location.hash'),leak:/SO-19000101-999/.test(await T(500))};
await p.shot(outDir('U-54-订单详情-不存在.png'));
// 注册 B（换账号）
await goHash('#/me',2400);
R['18_退出A']={click:await clickText('退出'),txt:(await p.wait(2200),await T(160))};
await goHash('#/register',2600);
const emailB=`r5b+${stamp}@example.com`;
await fill(emailSel,emailB); await fill(passSel,'r5-pass-12345');
R['19_注册B']={click:await clickText('^注册'),txt:(await p.wait(2600),await T(200))};
if(orderNo){ await goHash('#/orders/'+orderNo,2800); R['20_越权访问A的单']={txt:await T(280),hash:await E('location.hash'),leak单号:(await T(600)).includes(orderNo)}; }
await p.shot(outDir('U-54-订单详情-越权.png'));
R['21_B的订单列表']={txt:(await goHash('#/orders',2600),await T(200))};
console.log(JSON.stringify(R,null,1));
await p.close();
