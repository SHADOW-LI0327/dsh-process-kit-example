import { openPage, outDir } from '/Users/admin/workspace/dsh-process-kit-example/e2e/uat-feat002/lib-cdp.mjs';
const B='http://127.0.0.1:3000';
const p=await openPage({width:390,height:844,dsf:2,mobile:true});
await p.send('Network.enable',{},p.sid);
await p.send('Network.clearBrowserCookies',{},p.sid);
const E=(x)=>p.eval(x);
const reqs=new Map();
const rec=()=>{
  for(const ev of p.events.splice(0)){
    const m=ev.method; const pr=ev.params;
    if(m==='Network.requestWillBeSent'&&/\/api\/v1\/(cart|orders)/.test(pr.request.url)){
      reqs.set(pr.requestId,{url:pr.request.url,method:pr.request.method,t:pr.wallTime,reqCookie:null,setCookie:null,body:null,status:null,doc:pr.documentURL&&pr.documentURL.slice(-30)});
    }
    if(m==='Network.requestWillBeSentExtraInfo'&&reqs.has(pr.requestId)){
      const h=pr.headers||{}; const r=reqs.get(pr.requestId); r.reqCookie=(h.Cookie||h.cookie||'(无 Cookie 头)').slice(0,60);
    }
    if(m==='Network.responseReceivedExtraInfo'&&reqs.has(pr.requestId)){
      const h=pr.headers||{}; const r=reqs.get(pr.requestId); r.setCookie=(h['set-cookie']||h['Set-Cookie']||'(无 Set-Cookie)').slice(0,90); r.status=pr.statusCode;
    }
    if(m==='Network.loadingFinished'&&reqs.has(pr.requestId)){ (async()=>{ try{const b=await p.send('Network.getResponseBody',{requestId:pr.requestId},p.sid); const raw=b.result&&b.result.body?Buffer.from(b.result.body,b.result.base64Encoded?'base64':'utf8').toString('utf8'):''; const r=reqs.get(pr.requestId); try{const j=JSON.parse(raw); r.body=j.data?(j.data.cartId?('cartId='+j.data.cartId.slice(0,8)+' q='+j.data.quantityTotal):JSON.stringify(j).slice(0,80)):JSON.stringify(j).slice(0,80);}catch{ r.body=raw.slice(0,60);} }catch{} })(); }
  }
};
const note=async(tag)=>{rec();await p.wait(300);rec();const r=await p.send('Network.getCookies',{urls:[B+'/']},p.sid);const c=(r.result.cookies||[]).map(c=>c.name+'='+c.value.slice(0,8)).join(' ; ')||'(无)';return {tag,cookie:c,text:(await E(`(document.body.innerText||'').replace(/\\n+/g,' | ').slice(0,110)`)),hash:await E('location.hash')};};
const steps=[];
await p.navigate(B+'/',3000); steps.push(await note('1 首页'));
await p.navigate(B+'/#/products/P-002',2600);
await p.eval(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/加入购物车/.test(x.innerText));b.click();return 1;})()`);
await p.wait(1500); steps.push(await note('2 加购P-002'));
await p.navigate(B+'/#/products/P-004',2600);
await p.eval(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/加入购物车/.test(x.innerText));b.click();return 1;})()`);
await p.wait(1500); steps.push(await note('3 加购P-004'));
await p.navigate(B+'/#/cart',2600); steps.push(await note('4 购物车'));
await p.navigate(B+'/#/checkout',2600); steps.push(await note('5 结算'));
await p.navigate(B+'/#/cart',2600); steps.push(await note('6 回购物车'));
rec(); await p.wait(500); rec();
console.log(JSON.stringify({steps,reqs:[...reqs.values()]},null,1));
await p.close();
