import { openPage, outDir } from '/Users/admin/workspace/dsh-process-kit-example/e2e/uat-feat002/lib-cdp.mjs';
const B='http://127.0.0.1:3000';
const p=await openPage({width:390,height:844,dsf:2,mobile:true});
await p.send('Network.enable',{},p.sid);
await p.send('Network.clearBrowserCookies',{},p.sid);
const E=(x,o)=>p.eval(x,o);
const T=async(n=200)=>E(`(document.body.innerText||'').replace(/\\n+/g,' | ').slice(0,${n})`);
const imgs=async()=>E(`JSON.stringify([...document.querySelectorAll('img')].map(i=>({src:i.getAttribute('src'),complete:i.complete,nw:i.naturalWidth,nh:i.naturalHeight,w:+i.getBoundingClientRect().width.toFixed(1),h:+i.getBoundingClientRect().height.toFixed(1),vis:i.getBoundingClientRect().width>0})))`);
const hosts=()=>{const s=new Set();for(const e of p.events){if(e.method==='Network.requestWillBeSent'){try{s.add(new URL(e.params.request.url).host)}catch{}}}return [...s];};
const drain=()=>{p.events.splice(0)};  // 只用于分页计数
const R={};
const TS=Date.now().toString().slice(-6);
const fill=async(sel,val)=>{ await E(`(document.querySelector(${JSON.stringify(sel)})||{}).focus&&document.querySelector(${JSON.stringify(sel)}).focus()`); await p.send('Input.insertText',{text:val},p.sid); };
const clickText=async(re)=>E(`(()=>{const els=[...document.querySelectorAll('button,a')].filter(x=>x.getBoundingClientRect().width>0);const b=els.find(x=>new RegExp(${JSON.stringify(re)}).test(x.innerText.trim()));if(!b)return 'NOT_FOUND';b.click();return 'clicked';})()`);
// ---- A) 冷加载首帧（限速下看有无「加载中…」） ----
await p.send('Network.emulateNetworkConditions',{offline:false,latency:1200,downloadThroughput:30000,uploadThroughput:30000},p.sid);
const ff=[];let t0=Date.now();
p.navigate(B+'/',0).catch(()=>{});
for(const ms of [120,260,500,900,1500,2400]){ await p.wait(Math.max(0,ms-(Date.now()-t0))); const all=await T(2000); ff.push({t:Date.now()-t0,txt:all.slice(0,140),loading:/加载中/.test(all),len:all.length}); }
R['A_冷加载首帧']=ff;
await p.shot(outDir('U-49-冷加载首帧.png'));
await p.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1},p.sid);
await p.wait(1200);
// ---- B) 首页 8 图（U-25/U-27/U-28） ----
drain();
R['B_首页图片']=JSON.parse(await imgs());
R['B2_卡内主图占比']=await E(`JSON.stringify([...document.querySelectorAll('.card')].map(c=>{const i=c.querySelector('img');const ci=i?i.getBoundingClientRect():null;const cr=c.getBoundingClientRect();return {id:c.dataset.productId,imgW:ci?+ci.width.toFixed(1):null,cardW:+cr.width.toFixed(1),占比:ci?+(ci.width/cr.width*100).toFixed(1):null};}))`);
R['B3_首页host']=hosts();
// ---- C) 详情 / 购物车 / 订单 三条路径的图片 ----
const goHash=async(h,ms=2600)=>{await E(`location.hash=${JSON.stringify(h)}`);await p.wait(ms);};
await goHash('#/products/P-006');
R['C_详情图片']=JSON.parse(await imgs());
await p.shot(outDir('U-27-详情主图.png'));
// 注册一个账号以便下单/看订单
await goHash('#/register',2600);
await fill('#auth-email',`r5img+${TS}@example.com`); await fill('#auth-password','r5-pass-12345');
await clickText('^注册'); await p.wait(2600);
await goHash('#/products/P-008',2600);
await p.eval(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/加入购物车/.test(x.innerText));b.click();return 1;})()`);
await p.wait(1500);
await goHash('#/cart',2800);
R['D_购物车图片']=JSON.parse(await imgs());
R['D2_购物车文本']=await T(160);
await p.shot(outDir('U-27-购物车小图.png'));
R['D3_购物车host']=hosts();
// ---- E) 提交订单：提交中禁用态 + 连点计数（U-49②③ / U-12） ----
await goHash('#/checkout',2600);
drain();
await p.send('Network.emulateNetworkConditions',{offline:false,latency:1500,downloadThroughput:40000,uploadThroughput:40000},p.sid);
const btnNow=async()=>E(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/提交订单|提交中/.test(x.innerText));return b?JSON.stringify({t:b.innerText.trim(),disabled:b.disabled,w:+b.getBoundingClientRect().width.toFixed(1)}):'NOT_FOUND';})()`);
await clickText('提交订单');
const st=[];const t1=Date.now();
for(const ms of [60,200,500,900,1600,2400]){ await p.wait(Math.max(0,ms-(Date.now()-t1))); st.push({t:Date.now()-t1,btn:await btnNow()}); }
await clickText('提交订单');  // 第二次点（此时可能已返回，属 E-10 场景）
await p.wait(1500);
const posts=p.events.filter(e=>e.method==='Network.requestWillBeSent'&&e.params.request.method==='POST'&&/\/orders/.test(e.params.request.url)).length;
R['E_提交中状态']=st; R['E2_POST_orders次数']=posts;
R['E3_点后文本']=await T(220);
await p.shot(outDir('U-49-提交中按钮.png'));
await p.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1},p.sid);
await p.wait(2000);
await goHash('#/orders',2800);
R['F_订单列表图片']=JSON.parse(await imgs());
R['F2_订单列表文本']=await T(220);
await p.shot(outDir('U-27-订单列表.png'));
const ono=(R['F2_订单列表文本'].match(/SO-[0-9]{8}-[0-9]+/)||[''])[0];
if(ono){ await goHash('#/orders/'+ono,2600); R['G_订单详情图片']=JSON.parse(await imgs()); R['G2_订单详情文本']=await T(200); await p.shot(outDir('U-27-订单详情.png')); }
R['H_五面host汇总']=hosts();
R['H2_CSP']=await E(`(()=>{return 'n/a'})()`);
// ---- I) 断外网：首页 8 图仍渲染（U-29） ----
await p.send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]},p.sid);
let failed=0,cont=0;let stop=false;
const pump=async(ms)=>{const end=Date.now()+ms;while(Date.now()<end){for(const ev of p.events.splice(0)){if(ev.method==='Fetch.requestPaused'){let host='';try{host=new URL(ev.params.request.url).host}catch{}const loop=host==='127.0.0.1:3000'||host==='';if(loop){cont++;await p.send('Fetch.continueRequest',{requestId:ev.params.requestId},p.sid).catch(()=>{});}else{failed++;await p.send('Fetch.failRequest',{requestId:ev.params.requestId,errorReason:'InternetDisconnected'},p.sid).catch(()=>{});}}}await p.wait(60);}};
await p.send('Page.reload',{},p.sid); await pump(4000);
R['I_断外网计数']={放行:cont,拦断:failed};
R['I2_断外网首页图片']=JSON.parse(await imgs());
R['I3_断外网文本']=await T(200);
await p.shot(outDir('U-29-断外网首页.png'));
await goHash('#/products/P-006');
await pump(3000);
R['I4_断外网详情图']=JSON.parse(await imgs());
await p.shot(outDir('U-29-断外网详情.png'));
await p.send('Fetch.disable',{},p.sid);
import('node:fs').then(fs=>fs.writeFileSync(process.env.R5OUT||'/tmp/r5-images-offline.json',JSON.stringify(R,null,1)));
console.log(JSON.stringify(R,null,1));
await p.close();
