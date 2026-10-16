// 路由表补测：登录/注册页是否「静态可读、不依赖请求」/ 注册入口实际 hash / 已登录下的订单空态与我的页 / 详情骨架
import { openPage, outDir } from './lib-cdp.mjs';
import fs from 'node:fs';
const R={}; const log=(k,v)=>{R[k]=v;console.log('\n===== '+k+' =====\n'+JSON.stringify(v,null,1));};
const HOST='http://127.0.0.1:3000';
const p=await openPage({width:390,height:844,dsf:2,mobile:true});
await p.send('Network.enable',{},p.sid);
await p.send('Network.clearBrowserCookies',{},p.sid);
const STATE="(()=>{const t=(document.body.innerText||'').replace(/\\n+/g,' | ');const a=document.querySelector('.tabbar__item.is-active');return JSON.stringify({hash:location.hash,text:t.slice(0,320),tab:a?(a.innerText||'').trim():null})})()";
const st=async()=>JSON.parse(await p.eval(STATE));
const cap=async(f)=>{await p.shot(outDir(f));return f;};

// ① 拦掉所有 /api/v1/** 请求：看登录页是否仍静态可读，详情页是否有骨架
await p.send('Fetch.enable',{patterns:[{urlPattern:'*/api/v1/*',requestStage:'Request'}]},p.sid);
let i=0,blocked=0;
let run=true;
const loop=(async()=>{while(run){while(i<p.events.length){const e=p.events[i++];if(e.method!=='Fetch.requestPaused')continue;blocked++;await p.send('Fetch.failRequest',{requestId:e.params.requestId,errorReason:'Failed'},p.sid);}await new Promise(r=>setTimeout(r,15));}})();
await p.send('Network.setCacheDisabled',{cacheDisabled:true},p.sid);
await p.navigate(HOST+'/',2500);
log('api_blocked_home',{...await st(),shot:await cap('路由表-异常态-首页-断接口.png')});
await p.navigate(HOST+'/#/login',2500);
log('api_blocked_login_静态可读',{...await st(),shot:await cap('路由表-登录页-断接口仍可读.png')});
await p.navigate(HOST+'/#/register',2500);
log('api_blocked_register',{...await st(),shot:await cap('路由表-注册页-直接访问-断接口.png')});
await p.navigate(HOST+'/#/products/P-001',2500);
log('api_blocked_detail_骨架',{...await st(),shot:await cap('路由表-详情页-断接口骨架.png')});
run=false; await loop;
await p.send('Fetch.disable',{},p.sid);
await p.send('Network.setCacheDisabled',{cacheDisabled:false},p.sid);
log('api_blocked_count',{blocked});

// ② 从 #/login 点「注册新账号」：hash 变成什么？
await p.send('Network.clearBrowserCookies',{},p.sid);
await p.navigate(HOST+'/#/login',2500);
const before=await st();
await p.eval("(()=>{const b=[...document.querySelectorAll('button')].find(x=>/注册新账号/.test(x.innerText));b.click();return 1;})()");
await p.wait(900);
log('register_entry',{beforeLogin:{hash:before.hash,text:before.text.slice(0,140)},afterClick:await st(),shot:await cap('路由表-注册入口-点注册新账号后.png')});
// 注册一个全新账号（空提交先试 W-63）
await p.eval("(()=>{const b=[...document.querySelectorAll('button')].find(x=>/注册新账号/.test(x.innerText));b.click();return 1;})()");
await p.wait(900);
log('register_empty_submit',{...await st(),shot:await cap('路由表-注册页-空提交.png')});
await p.clickSel('#auth-email'); await p.send('Input.insertText',{text:'uat-r4route2+'+Date.now()+'@example.com'},p.sid);
await p.clickSel('#auth-password'); await p.send('Input.insertText',{text:'uat-pass-12345'},p.sid);
await p.eval("(()=>{const b=[...document.querySelectorAll('button')].find(x=>/注册新账号/.test(x.innerText));b.click();return 1;})()");
await p.wait(2500);
log('after_register',await st());
await p.navigate(HOST+'/#/orders',2500);
log('orders_loggedin_0',{...await st(),shot:await cap('路由表-空态-orders-已登录0单.png')});
await p.navigate(HOST+'/#/me',2200);
log('me_loggedin',{...await st(),shot:await cap('路由表-稳定态-me-已登录.png')});
await p.navigate(HOST+'/#/checkout',2200);
log('checkout_loggedin_empty',{...await st(),shot:await cap('路由表-异常态-checkout-已登录空车.png')});
fs.writeFileSync(outDir('r4-routes2.json'),JSON.stringify(R,null,1));
await p.close(); console.log('\nR4_ROUTES2_DONE');
