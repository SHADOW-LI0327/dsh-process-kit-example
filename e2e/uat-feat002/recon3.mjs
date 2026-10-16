// 黑盒侦察③：四个视图（详情 / 购物车 / 订单 / 我的）的对外可见结构与按钮文案。
import { openPage, outDir } from './lib-cdp.mjs';

const DUMP = "(()=>{"
  + "const cs=e=>getComputedStyle(e);const box=e=>{const r=e.getBoundingClientRect();return [Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)];};"
  + "const compact=e=>({tag:e.tagName.toLowerCase(),cls:(e.className||'').toString().slice(0,50),txt:(e.innerText||'').replace(/\\n+/g,'|').slice(0,60),box:box(e),"
  + "radius:cs(e).borderRadius,bg:cs(e).backgroundColor,bgImg:cs(e).backgroundImage.slice(0,90),color:cs(e).color,fs:cs(e).fontSize,fw:cs(e).fontWeight});"
  + "return JSON.stringify({url:location.href,bodyText:(document.body.innerText||'').replace(/\\n+/g,' | ').slice(0,600),"
  + "buttons:[...document.querySelectorAll('button,a[class*=btn],.btn')].map(compact),"
  + "inputs:[...document.querySelectorAll('input,select,textarea')].map(e=>({...compact(e),type:e.type||'',ph:e.placeholder||'',name:e.name||'',id:e.id||''})),"
  + "imgs:[...document.querySelectorAll('img')].map(e=>({src:e.getAttribute('src'),box:box(e),nat:e.naturalWidth+'x'+e.naturalHeight,of:cs(e).objectFit})),"
  + "tabbar:{items:[...document.querySelectorAll('.tabbar__item')].map(e=>e.innerText.trim()),active:(document.querySelector('.tabbar__item.is-active')||{}).innerText},"
  + "priceNodes:[...document.querySelectorAll('[class*=price]')].map(e=>({cls:e.className,txt:e.innerText.slice(0,20),fs:cs(e).fontSize,color:cs(e).color}))"
  + "},null,1);})()";

const p = await openPage({ width: 390, height: 844, dsf: 2, mobile: true });
const views = {
  detail: 'http://127.0.0.1:3000/#/products/P-001',
  cart: 'http://127.0.0.1:3000/#/cart',
  orders: 'http://127.0.0.1:3000/#/orders',
  me: 'http://127.0.0.1:3000/#/me',
  checkout: 'http://127.0.0.1:3000/#/checkout',
};
for (const [name, url] of Object.entries(views)) {
  await p.navigate(url, 2600);
  const d = await p.eval(DUMP);
  console.log('\n\n########## ' + name + ' ##########\n' + d);
  await p.shot(outDir('recon3-' + name + '.png'));
}
await p.close();
