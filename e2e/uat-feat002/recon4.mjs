// 黑盒侦察④：登录/注册表单的真实结构（点击「去登录 / 注册」后页面自己呈现的输入项与按钮）。
import { openPage, outDir } from './lib-cdp.mjs';

const DUMP = "(()=>{const cs=e=>getComputedStyle(e);const box=e=>{const r=e.getBoundingClientRect();return [Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)];};"
  + "return JSON.stringify({hash:location.hash,text:(document.body.innerText||'').replace(/\\n+/g,' | ').slice(0,400),"
  + "inputs:[...document.querySelectorAll('input')].map(e=>({type:e.type,id:e.id,cls:(e.className||'').toString(),ph:e.placeholder,name:e.name,autocomplete:e.autocomplete,box:box(e)})),"
  + "buttons:[...document.querySelectorAll('button,a[class*=btn],.btn,[role=tab],.seg__item')].map(e=>({tag:e.tagName.toLowerCase(),cls:(e.className||'').toString(),txt:(e.innerText||'').trim().slice(0,24),box:box(e),radius:cs(e).borderRadius,bgImg:cs(e).backgroundImage.slice(0,60)})),"
  + "labels:[...document.querySelectorAll('label,h1,h2,h3')].map(e=>e.innerText.trim().slice(0,40))},null,1);})()";

const p = await openPage({ width: 390, height: 844, dsf: 2, mobile: true });
await p.navigate('http://127.0.0.1:3000/#/me', 2600);
const r = await p.clickSel('a.btn--cta, .btn--cta');
console.log('clicked CTA ->', JSON.stringify(r));
await p.wait(1500);
console.log('\n===== after click =====\n' + (await p.eval(DUMP)));
await p.shot(outDir('recon4-auth.png'));
// 尝试点击「注册」切换
const tabs = await p.eval("(()=>JSON.stringify([...document.querySelectorAll('button,a,[role=tab]')].filter(e=>/注册/.test(e.innerText||'')).map(e=>({tag:e.tagName.toLowerCase(),cls:(e.className||'').toString(),txt:e.innerText.trim().slice(0,20)}))))()");
console.log('\nregister-ish controls:', tabs);
const reg = await p.eval("(()=>{const e=[...document.querySelectorAll('button,a,[role=tab],.seg__item')].find(x=>/^注册/.test((x.innerText||'').trim()));return e?JSON.stringify({cls:(e.className||'').toString(),txt:e.innerText.trim()}):null;})()");
if (reg) {
  await p.eval("(()=>{const e=[...document.querySelectorAll('button,a,[role=tab],.seg__item')].find(x=>/^注册/.test((x.innerText||'').trim()));e.click();return 1;})()");
  await p.wait(1200);
  console.log('\n===== after 注册 toggle =====\n' + (await p.eval(DUMP)));
  await p.shot(outDir('recon4-auth-register.png'));
}
await p.close();
