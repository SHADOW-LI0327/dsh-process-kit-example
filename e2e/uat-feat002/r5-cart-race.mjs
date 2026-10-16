import { openPage, outDir } from '/Users/admin/workspace/dsh-process-kit-example/e2e/uat-feat002/lib-cdp.mjs';
const B='http://127.0.0.1:3000';
const p=await openPage({width:390,height:844,dsf:2,mobile:true});
await p.send('Network.enable',{},p.sid);
await p.send('Network.clearBrowserCookies',{},p.sid);
const E=(x)=>p.eval(x);
const ck=async()=>{const r=await p.send('Network.getCookies',{urls:[B+'/']},p.sid);return (r.result.cookies||[]).map(c=>c.name+'='+c.value).join(' ; ')||'(无)';};
const steps=[];
const note=async(tag)=>steps.push({tag,cookies:await ck(),cartText:(await E(`(document.body.innerText||'').replace(/\\n+/g,' | ').slice(0,170)`)),hash:await E('location.hash')});
await p.navigate(B+'/',3000); await note('1 首页');
await p.navigate(B+'/#/products/P-002',2600); await note('2 详情P-002');
await p.eval(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/加入购物车/.test(x.innerText));b.click();return 1;})()`);
await p.wait(1600); await note('3 加购P-002后');
await p.navigate(B+'/#/cart',2600); await note('4 购物车');
await p.navigate(B+'/#/products/P-004',2600); await note('5 详情P-004');
await p.eval(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/加入购物车/.test(x.innerText));b.click();return 1;})()`);
await p.wait(1600); await note('6 加购P-004后');
// 不导航，直接看客户端 state 与车角标
await p.navigate(B+'/#/products',2200); await note('7 回列表');
await p.navigate(B+'/#/cart',2600); await note('8 再进购物车');
// 原始 API 观测：用页面内 fetch 看服务端到底认为车里有几件
const api=await E(`(async()=>{const r=await fetch('/api/v1/cart',{credentials:'same-origin'});const j=await r.json();return JSON.stringify({status:r.status,q:j.data.quantityTotal,items:j.data.items.map(i=>i.productId),cartId:j.data.cartId});})()`,{awaitPromise:true});
console.log(JSON.stringify({steps,页面内fetch:api},null,1));
await p.shot(outDir('r5-cart-race-购物车.png'));
await p.close();
