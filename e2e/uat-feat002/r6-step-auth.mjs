import { openPage, outDir } from '/Users/admin/workspace/dsh-process-kit-example/e2e/uat-feat002/lib-cdp.mjs';
const B='http://127.0.0.1:3000';
const p=await openPage({width:390,height:844,dsf:2,mobile:true});
await p.send('Network.enable',{},p.sid);
await p.send('Network.clearBrowserCookies',{},p.sid);
const E=(x,o)=>p.eval(x,o);
const rel=async(ms=2000)=>{ await p.send('Page.reload',{ignoreCache:true},p.sid); await p.wait(ms); };
const writes=()=>p.events.filter(e=>e.method==='Network.requestWillBeSent'&&e.params.request.method!=='GET').map(e=>e.params.request.method+' '+e.params.request.url.replace(B,''));
const authReq=()=>p.events.filter(e=>e.method==='Network.requestWillBeSent'&&/\/api\/v1\/auth/.test(e.params.request.url)).length;
const fill=async(sel,val)=>{ await E(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(e){e.focus();e.value='';}return !!e;})()`); if(val) await p.send('Input.insertText',{text:val},p.sid); };
const clickSubmit=async(re)=>E(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.getBoundingClientRect().width>0&&new RegExp(${JSON.stringify(re)}).test(x.innerText.trim()));if(!b)return 'NOT_FOUND';b.click();return 'clicked';})()`);
const errText=async()=>JSON.parse(await E(`(()=>{const els=[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&/请填写|格式|至少|不能超过|不正确|重试/.test(e.innerText||''));return JSON.stringify(els.map(e=>({t:e.innerText.trim(),c:getComputedStyle(e).color,fs:getComputedStyle(e).fontSize})));})()`));
const pos=async(ch)=>JSON.parse(await E(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.trim()===${JSON.stringify(ch)});if(!b)return '{"x":-1,"y":-1,"disabled":null}';const r=b.getBoundingClientRect();const s=getComputedStyle(b);return JSON.stringify({x:+(r.x+r.width/2).toFixed(1),y:+(r.y+r.height/2).toFixed(1),disabled:b.disabled,op:s.opacity,cur:s.cursor,w:+r.width.toFixed(1),h:+r.height.toFixed(1)});})()`));
const qty=async()=>JSON.parse(await E(`(()=>{const bs=[...document.querySelectorAll('button')];const plus=bs.find(x=>x.innerText.trim()==='+');const minus=bs.find(x=>x.innerText.trim()==='−');const scope=plus&&plus.parentElement?plus.parentElement:document.body;const q=[...scope.querySelectorAll('*')].filter(e=>e.children.length===0&&/^[0-9]+$/.test(e.innerText.trim()));const stk=(document.body.innerText.match(/现货\\s*([0-9]+)\\s*件/)||[])[1];return JSON.stringify({件数:q.length?q[q.length-1].innerText.trim():null,现货:stk===undefined?null:stk,减禁用:minus?minus.disabled:null,加禁用:plus?plus.disabled:null});})()`));
const R={};
await p.navigate(B+'/',3200);
// ================= 三、注册页 5 条本地自校验 =================
const cases=[
  {name:'邮箱空',email:'',pw:'r6-pass-12345',expect:'请填写邮箱'},
  {name:'邮箱格式 abc',email:'abc',pw:'r6-pass-12345',expect:'邮箱格式看起来不对，请检查后重试'},
  {name:'密码空',email:'r6a@example.com',pw:'',expect:'请填写密码，至少 8 位'},
  {name:'密码 7 位',email:'r6a@example.com',pw:'1234567',expect:'密码至少 8 位'},
  {name:'密码 129 位',email:'r6a@example.com',pw:'a'.repeat(129),expect:'密码不能超过 128 位'},
];
R['三_注册页']=[];
for(const c of cases){
  await E(`location.hash='#/register'`); await p.wait(1800); await rel();
  p.events.splice(0);
  await fill('#auth-email',c.email); await fill('#auth-password',c.pw);
  const meta=JSON.parse(await E(`(()=>{const e=document.querySelector('#auth-password');return JSON.stringify({maxLength:e?e.maxLength:null,typed:e?e.value.length:null});})()`));
  const click=await clickSubmit('^注册$');
  await p.wait(1400);
  R['三_注册页'].push({用例:c.name,期望:c.expect,实测:await errText(),auth请求数:authReq(),请求明细:writes(),maxLength:meta.maxLength,输入后长度:meta.typed,click,hash:await E('location.hash')});
}
await p.shot(outDir('U-62-注册页-本地校验.png'));
R['三_登录页']=[];
for(const c of [cases[0],cases[1],cases[3]]){
  await E(`location.hash='#/login'`); await p.wait(1800); await rel();
  p.events.splice(0);
  await fill('#auth-email',c.email); await fill('#auth-password',c.pw);
  const click=await clickSubmit('^登录$');
  await p.wait(1400);
  R['三_登录页'].push({用例:c.name,期望:c.expect,实测:await errText(),auth请求数:authReq(),请求明细:writes(),click});
}
R['三_旧通用文案命中次数']=(await E(`(document.body.innerText.match(/请求格式不正确，请刷新页面后重试/g)||[]).length`));
// ================= 一、步进器上限（现货 8 档：电子秤） =================
await E(`location.hash='#/products/P-005'`); await p.wait(2600);
p.events.splice(0);
R['一_现货8_起始']=await qty();
const up=[];
for(let i=0;i<12;i++){
  const s=await qty(); const pos_=await pos('+');
  if(pos_.disabled){ await p.clickAt(pos_.x,pos_.y); await p.wait(700); const a=await qty(); up.push({步:i+1,点前:s.件数,加禁用:true,加样式:{op:pos_.op,cur:pos_.cur},真鼠标点后:a.件数,写请求:writes()}); break; }
  await p.clickAt(pos_.x,pos_.y); await p.wait(450);
  const a=await qty(); up.push({步:i+1,点前:s.件数,点后:a.件数,加已禁用:a.加禁用});
}
R['一_现货8_逐次']=up;
R['一_现货8_末态']=await qty();
await p.shot(outDir('U-61-步进器-现货8封顶.png'));
// 「−」减到 1 并验禁用
const down=[];
for(let i=0;i<12;i++){
  const s=await qty(); const m=await pos('−');
  if(m.disabled){ await p.clickAt(m.x,m.y); await p.wait(600); const a=await qty(); down.push({点前:s.件数,减禁用:true,减样式:{op:m.op,cur:m.cur},真鼠标点后:a.件数,写请求:writes()}); break; }
  await p.clickAt(m.x,m.y); await p.wait(420);
  const a=await qty(); down.push({点前:s.件数,点后:a.件数,减已禁用:a.减禁用});
}
R['一_减到1_逐次']=down;
R['一_减到1_末态']=await qty();
await p.shot(outDir('U-61-步进器-减到1禁用.png'));
console.log(JSON.stringify(R,null,1));
await p.close();
