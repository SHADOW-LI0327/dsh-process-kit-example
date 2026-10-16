// 黑盒侦察②：单张商品卡内部结构 + 主图样式 + 价格排版 + Tab 当前项样式。只读渲染后的 DOM。
import { openPage } from './lib-cdp.mjs';

const p = await openPage({ width: 390, height: 844, dsf: 2, mobile: true });
await p.navigate('http://127.0.0.1:3000/', 3500);
const r = await p.eval(`(()=>{
  const cs=e=>getComputedStyle(e);
  const card=document.querySelector('li.card')||document.querySelector('.card');
  const img=card.querySelector('img');
  const price=card.querySelector('.price')||[...card.querySelectorAll('*')].find(e=>/^¥/.test((e.innerText||'').trim()));
  const active=document.querySelector('.tabbar__item.is-active');
  const yenspan=price? [...price.querySelectorAll('*')].find(e=>e.innerText.trim()==='¥') : null;
  const digits=price? [...price.querySelectorAll('*')].find(e=>/^[0-9.,]+$/.test(e.innerText.trim())) : null;
  const brief=e=>e?{tag:e.tagName.toLowerCase(),cls:(e.className||'').toString(),text:(e.innerText||'').replace(/\\n/g,'|').slice(0,50),
    fontSize:cs(e).fontSize,fontWeight:cs(e).fontWeight,color:cs(e).color,radius:cs(e).borderRadius,bg:cs(e).backgroundColor,bgImg:cs(e).backgroundImage.slice(0,80),
    box:(r=>[Math.round(r.width),Math.round(r.height)])(e.getBoundingClientRect())}:null;
  const tags=[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&/包邮|促销|秒杀|新品|热卖|折扣/.test(e.innerText||'')).map(e=>({cls:(e.className||'').toString(),text:e.innerText.trim(),bg:cs(e).backgroundColor,color:cs(e).color,radius:cs(e).borderRadius}));
  const shadowCount=[...document.querySelectorAll('*')].filter(e=>cs(e).boxShadow&&cs(e).boxShadow!=='none').length;
  const radiusCount=[...document.querySelectorAll('*')].filter(e=>parseFloat(cs(e).borderRadius)>0).length;
  return JSON.stringify({
    cardHTML: card.outerHTML.replace(/\\s+/g,' ').slice(0,900),
    card:brief(card), img:brief(img), imgObjectFit:cs(img).objectFit, imgNatural:img.naturalWidth+'x'+img.naturalHeight,
    imgParent:brief(img.parentElement),
    title:brief(card.querySelector('.card__title')||card.querySelector('h3')||card.querySelector('h2')),
    price:brief(price), yen:brief(yenspan), digits:brief(digits),
    activeTab:{text:active?active.innerText.trim():null,color:active?cs(active).color:null,children:[...(active?active.querySelectorAll('*'):[])].map(brief)},
    tags, shadowCount, radiusCount,
    tabbarText:[...document.querySelectorAll('.tabbar__item')].map(e=>e.innerText.trim()),
  },null,1);
})()`);
console.log(r);
await p.close();
