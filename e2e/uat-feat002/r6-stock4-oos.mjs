import { openPage, outDir } from '/Users/admin/workspace/dsh-process-kit-example/e2e/uat-feat002/lib-cdp.mjs';
const B='http://127.0.0.1:3000';
const p=await openPage({width:390,height:844,dsf:2,mobile:true});
await p.send('Network.enable',{},p.sid);
await p.send('Network.clearBrowserCookies',{},p.sid);
const E=(x,o)=>p.eval(x,o);
const T=async(n=260)=>E(`(document.body.innerText||'').replace(/\\n+/g,' | ').slice(0,${n})`);
const writes=()=>p.events.filter(e=>e.method==='Network.requestWillBeSent'&&e.params.request.method!=='GET').map(e=>e.params.request.method+' '+e.params.request.url.replace(B,''));
const btn=async(label)=>JSON.parse(await E(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.trim()===${JSON.stringify(label)});if(!b)return '{"found":false}';const r=b.getBoundingClientRect();const s=getComputedStyle(b);return JSON.stringify({found:true,x:+(r.x+r.width/2).toFixed(1),y:+(r.y+r.height/2).toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1),disabled:b.disabled,op:s.opacity,cur:s.cursor,bg:s.backgroundImage.slice(0,60)+'|'+s.backgroundColor,c:s.color});})()`));
const qty=async()=>JSON.parse(await E(`(()=>{const bs=[...document.querySelectorAll('button')];const plus=bs.find(x=>x.innerText.trim()==='+');const minus=bs.find(x=>x.innerText.trim()==='−');const scope=plus&&plus.parentElement?plus.parentElement:document.body;const q=[...scope.querySelectorAll('*')].filter(e=>e.children.length===0&&/^[0-9]+$/.test(e.innerText.trim()));const stk=(document.body.innerText.match(/现货\\s*([0-9]+)\\s*件/)||[])[1];const st=(b)=>{const s=getComputedStyle(b);return {disabled:b.disabled,op:s.opacity,cur:s.cursor,c:s.color,bd:s.borderColor};};return JSON.stringify({件数:q.length?q[q.length-1].innerText.trim():null,现货:stk===undefined?null:stk,减:minus?st(minus):null,加:plus?st(plus):null});})()`));
const R={};
await p.navigate(B+'/',3200);
// ============ 一、档二：现货 4（手冲咖啡壶） ============
await E(`location.hash='#/products/P-001'`); await p.wait(2600);
p.events.splice(0);
R['一_现货4_起始']=await qty();
const up=[];
for(let i=0;i<8;i++){
  const s=await qty(); const b=await btn('+');
  if(b.disabled){ await p.clickAt(b.x,b.y); await p.wait(700); const a=await qty(); up.push({步:i+1,点前:s.件数,加禁用:true,加样式:{op:b.op,cur:b.cur,c:b.c},真鼠标点后:a.件数,写请求:writes()}); break; }
  await p.clickAt(b.x,b.y); await p.wait(450); const a=await qty(); up.push({步:i+1,点前:s.件数,点后:a.件数,加已禁用:a.加.disabled});
}
R['一_现货4_逐次']=up;
R['一_现货4_末态']=await qty();
await p.shot(outDir('U-61-步进器-现货4封顶.png'));
// 「−」减回 1
const down=[];
for(let i=0;i<6;i++){
  const s=await qty(); const b=await btn('−');
  if(b.disabled){ await p.clickAt(b.x,b.y); await p.wait(600); const a=await qty(); down.push({点前:s.件数,减禁用:true,减样式:{op:b.op,cur:b.cur,c:b.c},真鼠标点后:a.件数,写请求:writes()}); break; }
  await p.clickAt(b.x,b.y); await p.wait(420); const a=await qty(); down.push({点前:s.件数,点后:a.件数,减已禁用:a.减.disabled});
}
R['一_现货4_减到1']=down;
// ============ 二、现货 0（陶瓷滤杯）详情页两个 CTA ============
await E(`location.hash='#/products/P-002'`); await p.wait(2600);
p.events.splice(0);
R['二_缺货页文本']=await T(220);
R['二_加购按钮']=await btn('加入购物车');
R['二_立即购买按钮']=await btn('立即购买');
R['二_件数器']=await qty();
const before={hash:await E('location.hash'),txt:await T(200)};
const c1=await btn('加入购物车'); await p.clickAt(c1.x,c1.y); await p.wait(1200);
const after1={hash:await E('location.hash'),txt:await T(200),写请求:writes()};
const c2=await btn('立即购买'); await p.clickAt(c2.x,c2.y); await p.wait(1200);
const after2={hash:await E('location.hash'),txt:await T(200),写请求:writes()};
R['二_真鼠标点两钮前后']={点前:before,点加购后:after1,点立即购买后:after2,文案变化:(before.txt!==after2.txt)};
await p.shot(outDir('U-63-缺货详情-CTA禁用.png'));
// 键盘/JS 兜底：直接派发 click 事件（模拟辅助技术）
R['二_JS派发click']=await E(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/加入购物车/.test(x.innerText));const ev=new MouseEvent('click',{bubbles:true,cancelable:true});b.dispatchEvent(ev);return JSON.stringify({disabled:b.disabled,hash:location.hash});})()`);
await p.wait(1200);
R['二_JS派发后']={hash:await E('location.hash'),写请求:writes(),txt:await T(160)};
// ============ 二补、列表卡：卡内按钮数 / 缺货角标 / 卡链接可点 ============
await E(`location.hash='#/products'`); await p.wait(2600);
p.events.splice(0);
R['二补_缺货卡']=JSON.parse(await E(`(()=>{const c=[...document.querySelectorAll('.card')].find(x=>/陶瓷滤杯/.test(x.innerText));if(!c)return '{"found":false}';const btns=[...c.querySelectorAll('button')];const badge=[...c.querySelectorAll('.badge')].map(b=>b.innerText.trim());const a=c.querySelector('a');const r=a.getBoundingClientRect();return JSON.stringify({found:true,卡文本:c.innerText.replace(/\\n+/g,' | '),卡内按钮数:btns.length,角标:badge,卡链接href:a.getAttribute('href'),链接可点:r.width>0,x:+(r.x+r.width/2).toFixed(1),y:+(r.y+20).toFixed(1)});})()`));
const card=JSON.parse(await E(`(()=>{const c=[...document.querySelectorAll('.card')].find(x=>/陶瓷滤杯/.test(x.innerText));const a=c.querySelector('a');const r=a.getBoundingClientRect();return JSON.stringify({x:+(r.x+r.width/2).toFixed(1),y:+(r.y+20).toFixed(1)});})()`));
await p.clickAt(card.x,card.y); await p.wait(2200);
R['二补_点卡链接后']={hash:await E('location.hash'),txt:await T(140)};
await p.shot(outDir('U-63-缺货卡-角标与链接.png'));
console.log(JSON.stringify(R,null,1));
await p.close();
