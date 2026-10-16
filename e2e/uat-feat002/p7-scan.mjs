// FEAT-002 UAT · T-1 旧深色令牌残留扫描 + T-8 角标清点 + T-6 CTA 清点 + T-9 详情主图占比
import { openPage, outDir } from './lib-cdp.mjs';

const p = await openPage({ width: 390, height: 844, dsf: 2, mobile: true });
const SCAN = "(()=>{const OLD=['rgb(13, 17, 23)','rgb(22, 27, 34)','#0d1117','#161b22'];"
  + "const hits=[];const cs=e=>getComputedStyle(e);"
  + "for(const e of document.querySelectorAll('*')){const s=cs(e);"
  + " for(const k of ['backgroundColor','color','borderTopColor','backgroundImage','boxShadow','fill','stroke']){const v=(s[k]||'')+'';"
  + "  if(OLD.some(o=>v.toLowerCase().includes(o))){hits.push({tag:e.tagName.toLowerCase(),cls:(e.className||'').toString().slice(0,40),prop:k,val:v.slice(0,60)});break;}}}"
  + "const badges=[...document.querySelectorAll('[class*=badge],[class*=tag],[class*=label]')].map(e=>({cls:(e.className||'').toString(),txt:(e.innerText||'').trim().slice(0,8),bg:cs(e).backgroundColor,color:cs(e).color,radius:cs(e).borderRadius,fs:cs(e).fontSize}));"
  + "const ctas=[...document.querySelectorAll('.btn--cta')].map(e=>({txt:e.innerText.trim().slice(0,10),h:Math.round(e.getBoundingClientRect().height),radius:cs(e).borderRadius,bgImg:cs(e).backgroundImage,color:cs(e).color}));"
  + "const imgs=[...document.querySelectorAll('img')].map(e=>({src:e.getAttribute('src'),w:Math.round(e.getBoundingClientRect().width),h:Math.round(e.getBoundingClientRect().height),of:cs(e).objectFit,nat:e.naturalWidth+'x'+e.naturalHeight}));"
  + "return JSON.stringify({url:location.href,oldTokenHits:hits,badgeCount:badges.length,badges:badges.slice(0,6),ctas,imgs,"
  + "bodyBg:cs(document.body).backgroundColor,htmlBg:cs(document.documentElement).backgroundColor,cardBg:(()=>{const c=document.querySelector('.card');return c?cs(c).backgroundColor:null})(),"
  + "whiteCards:document.querySelectorAll('.card').length},null,1);})()";

for (const u of ['http://127.0.0.1:3000/', 'http://127.0.0.1:3000/#/products/P-001']) {
  await p.navigate(u, 3000);
  console.log('\n===== ' + u + ' =====\n' + (await p.eval(SCAN)));
}
const detail = await p.eval("(()=>{const img=document.querySelector('main img')||document.querySelector('img[src^=\"/assets/products/\"]');"
  + "const card=img?img.closest('.detail__media,.card,section,div'):null;const ir=img.getBoundingClientRect();const cr=card.getBoundingClientRect();"
  + "const vp={w:innerWidth,h:innerHeight};"
  + "return JSON.stringify({imgBox:[Math.round(ir.width),Math.round(ir.height)],containerBox:[Math.round(cr.width),Math.round(cr.height)],"
  + "shareOfContainer:+(ir.width*ir.height/(cr.width*cr.height)).toFixed(3),shareOfViewport:+(ir.width*ir.height/(vp.w*vp.h)).toFixed(3),"
  + "imgOf:getComputedStyle(img).objectFit,nat:img.naturalWidth+'x'+img.naturalHeight,containerCls:(card.className||'').toString()});})()");
console.log('\n===== 详情主图占比 =====\n' + detail);
await p.close();
