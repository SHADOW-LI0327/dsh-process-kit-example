import { openPage, outDir } from '/Users/admin/workspace/dsh-process-kit-example/e2e/uat-feat002/lib-cdp.mjs';
const B='http://127.0.0.1:3000';
const p=await openPage({width:390,height:844,dsf:2,mobile:true});
await p.send('Network.enable',{},p.sid);
await p.send('Network.clearBrowserCookies',{},p.sid);
const E=(x,o)=>p.eval(x,o);
const T=async(n=260)=>E(`(document.body.innerText||'').replace(/\\n+/g,' | ').slice(0,${n})`);
const goHash=async(h,ms=2500)=>{await E(`location.hash=${JSON.stringify(h)}`);await p.wait(ms);};
const clickText=async(re)=>E(`(()=>{const els=[...document.querySelectorAll('button,a')].filter(x=>x.getBoundingClientRect().width>0);const b=els.find(x=>new RegExp(${JSON.stringify(re)}).test(x.innerText.trim()));if(!b)return 'NOT_FOUND:'+els.map(x=>x.innerText.trim().slice(0,10)).join(',');b.click();return 'clicked:'+b.innerText.trim().slice(0,14);})()`);
const tabbar=async()=>E(`(()=>{const t=document.querySelector('.tabbar');if(!t)return 'NO_TABBAR';const items=[...t.querySelectorAll('a,button')];return JSON.stringify({n:items.length,active:items.filter(x=>getComputedStyle(x).color==='rgb(122, 34, 0)').map(x=>x.innerText.trim())});})()`);
const R={};
await p.navigate(B+'/',3200);
// 1) 兜底 hash（未知路由）
await goHash('#/no-such-route-xyz',2600);
R['1_未知hash']={hash:await E('location.hash'),txt:await T(220),tab:await tabbar()};
await p.shot(outDir('U-57-兜底路由-未知hash.png'));
// 2) 商品不存在
await goHash('#/products/P-999',2600);
R['2_商品不存在']={hash:await E('location.hash'),txt:await T(240),tab:await tabbar()};
await p.shot(outDir('U-57-详情页-商品不存在.png'));
// 3) 空提交：登录页 / 注册页
await goHash('#/login',2500);
R['3_登录空提交']={click:await clickText('^登录'),txt:(await p.wait(1800),await T(200))};
await p.shot(outDir('U-57-登录页-空提交.png'));
await goHash('#/register',2500);
R['4_注册空提交']={click:await clickText('^注册'),txt:(await p.wait(1800),await T(200))};
await p.shot(outDir('U-57-注册页-空提交.png'));
// 4) 未登录 + 匿名车非空 → 结算页点提交订单
await goHash('#/products/P-006',2600);
await p.eval(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/加入购物车/.test(x.innerText));b.click();return 1;})()`);
await p.wait(1600);
await goHash('#/checkout',2800);
R['5_未登录结算页_车非空']={hash:await E('location.hash'),txt:await T(320)};
await p.shot(outDir('U-56-未登录结算页-车非空.png'));
R['6_点提交订单']={click:await clickText('提交订单'),txt:(await p.wait(2600),await T(240)),hash:await E('location.hash')};
await p.shot(outDir('U-56-未登录下单-点提交订单.png'));
// 5) 件数上限禁用态（U-50）
await goHash('#/products/P-006',2600);
for(let i=0;i<9;i++){const r=await E(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='+');if(!b||b.disabled)return 'disabled';const n0=b.getBoundingClientRect();b.click();return 'ok';})()`); if(r==='disabled')break; await p.wait(600);}
R['7_件数上限']={txt:await T(120),plus:await E(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='+');return JSON.stringify({disabled:b?b.disabled:null});})()`),minus:await E(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='−');return JSON.stringify({disabled:b?b.disabled:null});})()`)};
// 6) U-49 ①：限速下切页首帧
await p.send('Network.emulateNetworkConditions',{offline:false,latency:1500,downloadThroughput:20000,uploadThroughput:20000},p.sid);
await goHash('#/products',3000);
const ff=[];
await E(`location.hash='#/orders'`);
for(const ms of [30,400,900,1600,2400]){await p.wait(ms===30?30:ms-ff[ff.length-1].t);ff.push({t:ms,txt:(await T(90)),hasLoading:/加载中|正在加载/.test(await T(400))});}
R['8_首帧_orders']=ff;
await p.shot(outDir('U-49-首帧-订单列表.png'));
await p.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1},p.sid);
await p.wait(800);
await E(`location.hash='#/cart'`);
const ff2=[];
for(const ms of [30,500,1100,1800,2600]){await p.wait(ms-(ff2.length?ff2[ff2.length-1].t:0));ff2.push({t:ms,txt:(await T(90)),hasLoading:/加载中|正在加载/.test(await T(400))});}
R['9_首帧_cart']=ff2;
await p.shot(outDir('U-49-首帧-购物车.png'));
// 7) 演示标注（U-51）
await goHash('#/checkout',2600);
R['10_演示标注']={home:(await goHash('#/products',2400),await T(200)),checkout:(await goHash('#/checkout',2400),await T(200)),me:(await goHash('#/me',2400),await T(240))};
console.log(JSON.stringify(R,null,1));
await p.close();
