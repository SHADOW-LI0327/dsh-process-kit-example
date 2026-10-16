import { openPage, outDir } from '/Users/admin/workspace/dsh-process-kit-example/e2e/uat-feat002/lib-cdp.mjs';
const B='http://127.0.0.1:3000';
const p=await openPage({width:390,height:844,dsf:2,mobile:true});
await p.send('Network.enable',{},p.sid);
await p.send('Network.clearBrowserCookies',{},p.sid);
const E=(x)=>p.eval(x);
const ck=async()=>{const r=await p.send('Network.getCookies',{urls:[B+'/']},p.sid);return (r.result.cookies||[]).map(c=>c.name+'='+c.value.slice(0,8)).join(' ; ')||'(无)';};
const txt=async()=>E(`(document.body.innerText||'').replace(/\\n+/g,' | ').slice(0,140)`);
const goHash=async(h,ms=2400)=>{await E(`location.hash=${JSON.stringify(h)}`);await p.wait(ms);};
const R={};const log=[];
await p.navigate(B+'/',3200); log.push({t:'首页',ck:await ck()});
await p.send('Page.reload',{ignoreCache:true},p.sid); await p.wait(3000); log.push({t:'刷新后',ck:await ck(),txt:await txt()});
for(const pid of ['P-002','P-004']){
  await goHash('#/products/'+pid,2600); log.push({t:'详情'+pid,ck:await ck()});
  await p.eval(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/加入购物车/.test(x.innerText));b.click();return 1;})()`);
  await p.wait(1600); log.push({t:'加购'+pid,ck:await ck(),txt:await txt()});
}
await goHash('#/cart',2800); R['A_购物车_390']={ck:await ck(),txt:await txt()};
const probe=`(()=>{const out={};const hit=[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&/应付合计/.test(e.innerText||''));out.锚点=hit.map(e=>e.innerText.trim());const chain=[];if(hit.length){let n=hit[0];while(n&&n!==document.body&&chain.length<5){const r=n.getBoundingClientRect();const s=getComputedStyle(n);chain.push({tag:n.tagName.toLowerCase(),cls:String(n.className),w:+r.width.toFixed(1),h:+r.height.toFixed(1),x:+r.left.toFixed(1),right:+r.right.toFixed(1),radius:s.borderRadius,pad:s.padding});n=n.parentElement;}}out.祖先链=chain;out.innerW=innerWidth;return JSON.stringify(out);})()`;
R['A2_购物车390结算卡']=JSON.parse(await E(probe));
await p.shot(outDir('U-60-购物车390-结算卡.png'));
// 用户刷新页面（F5）：车还在吗
await p.send('Page.reload',{ignoreCache:true},p.sid); await p.wait(3200);
R['B_刷新后购物车']={ck:await ck(),txt:await txt()};
R['B2_刷新后结算卡']=JSON.parse(await E(probe));
// 若刷新后空车，补一次加购再继续（并如实记录）
if(!/应付合计/.test(R['B_刷新后购物车'].txt)){
  await goHash('#/products/P-002',2600);
  await p.eval(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/加入购物车/.test(x.innerText));b.click();return 1;})()`);
  await p.wait(1600);
  await goHash('#/cart',2800);
  R['B3_补加购后']={ck:await ck(),txt:await txt()};
}
await goHash('#/checkout',2800);
R['C_结算_390']={ck:await ck(),txt:await txt(),hash:await E('location.hash')};
R['C2_结算390结算卡']=JSON.parse(await E(probe));
await p.shot(outDir('U-60-结算页390-结算卡.png'));
await p.setMetrics({width:1280,height:900,dsf:1,mobile:false});
await p.wait(800);
await goHash('#/cart',2800);
R['D_购物车_1280']={ck:await ck(),txt:await txt(),hash:await E('location.hash')};
R['D2_购物车1280结算卡']=JSON.parse(await E(probe));
await p.shot(outDir('U-60-购物车1280-结算卡.png'));
await p.shotFull(outDir('U-60-购物车1280-全页.png'));
await goHash('#/checkout',2800);
R['E_结算_1280']={ck:await ck(),txt:await txt(),hash:await E('location.hash')};
R['E2_结算1280结算卡']=JSON.parse(await E(probe));
await p.shot(outDir('U-60-结算页1280-结算卡.png'));
R._日志=log;
console.log(JSON.stringify(R,null,1));
await p.close();
