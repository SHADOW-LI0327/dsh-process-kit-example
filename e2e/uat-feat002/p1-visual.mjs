// FEAT-002 UAT · T-1~T-10 真实浏览器观感取证（390px 与 1280px 双档）
// 只采页面自身可观察的渲染结果（计算样式 / 几何 / 截图），不读源码。
import { openPage, outDir } from './lib-cdp.mjs';
import fs from 'node:fs';

const AUDIT = "(()=>{"
  + "const cs=e=>getComputedStyle(e);"
  + "const box=e=>{const r=e.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};};"
  + "const cards=[...document.querySelectorAll('li.card,.card')];"
  + "const grid=document.querySelector('ul.grid,.grid,.product-grid');"
  + "const gcs=grid?cs(grid):null;"
  + "const gbox=grid?box(grid):null;"
  + "const main=document.querySelector('main')||document.body.firstElementChild;"
  + "const imgs=[...document.querySelectorAll('img[src^=\"/assets/products/\"]')];"
  + "const loaded=imgs.filter(i=>i.complete&&i.naturalWidth>0).length;"
  + "const blank=imgs.filter(i=>i.complete&&i.naturalWidth===0).map(i=>i.getAttribute('src'));"
  + "const c0=cards[0];"
  + "const c0img=c0?c0.querySelector('img'):null;"
  + "const price=c0?c0.querySelector('.card__price'):null;"
  + "const yen=c0?c0.querySelector('.card__price-symbol'):null;"
  + "const val=c0?c0.querySelector('.card__price-value'):null;"
  + "const title=c0?c0.querySelector('.card__title'):null;"
  + "const tab=document.querySelector('.tabbar,nav.tabbar');"
  + "const tabs=[...document.querySelectorAll('.tabbar__item')];"
  + "const act=document.querySelector('.tabbar__item.is-active');"
  + "const search=document.querySelector('input[type=search],input.search__input,#search-input');"
  + "const shadow=[...document.querySelectorAll('*')].filter(e=>{const s=cs(e).boxShadow;return s&&s!=='none';}).length;"
  + "const radius=[...document.querySelectorAll('*')].filter(e=>parseFloat(cs(e).borderRadius)>0).length;"
  + "const ctas=[...document.querySelectorAll('button,a[class*=btn],.btn,.button')].filter(e=>/加入购物车|立即购买|去结算|提交订单|结算|加购/.test(e.innerText||''))"
  + "  .map(e=>({text:(e.innerText||'').trim().slice(0,20),cls:(e.className||'').toString(),bgImg:cs(e).backgroundImage,radius:cs(e).borderRadius,h:box(e).h,w:box(e).w,color:cs(e).color}));"
  + "const firstRowY=cards.length?Math.round(cards[0].getBoundingClientRect().y):null;"
  + "const firstRow=cards.filter(c=>Math.abs(c.getBoundingClientRect().y-firstRowY)<2);"
  + "const colsX=[...new Set(cards.map(c=>Math.round(c.getBoundingClientRect().x)))].sort((a,b)=>a-b);"
  + "return JSON.stringify({"
  + " viewport:{w:innerWidth,h:innerHeight,dpr:devicePixelRatio},"
  + " htmlBg:cs(document.documentElement).backgroundColor, bodyBg:cs(document.body).backgroundColor,"
  + " docW:document.documentElement.scrollWidth, innerW:innerWidth, hScroll:document.documentElement.scrollWidth>innerWidth,"
  + " scrollH:document.documentElement.scrollHeight,"
  + " grid:{sel:grid?(grid.tagName+'.'+grid.className):null, box:gbox, templateColumns:gcs?gcs.gridTemplateColumns:null,"
  + "   colCount:gcs?gcs.gridTemplateColumns.split(' ').filter(Boolean).length:null, gap:gcs?gcs.gap:null,"
  + "   firstRowCards:firstRow.length, cardXs:colsX},"
  + " card:{count:cards.length,box:c0?box(c0):null,bg:c0?cs(c0).backgroundColor:null,radius:c0?cs(c0).borderRadius:null,shadow:c0?cs(c0).boxShadow:null,"
  + "   imgBox:c0img?box(c0img):null,imgRatio:c0img?+(box(c0img).w*box(c0img).h/(box(c0).w*box(c0).h)).toFixed(3):null,"
  + "   imgOf: c0img?cs(c0img).objectFit:null, imgNatural:c0img?c0img.naturalWidth+'x'+c0img.naturalHeight:null,"
  + "   domOrder:[...c0.querySelectorAll('*')].map(e=>e.tagName.toLowerCase()).join('>'),"
  + "   title:title?{fs:cs(title).fontSize,fw:cs(title).fontWeight,lines:Math.round(box(title).h/parseFloat(cs(title).lineHeight||'20')),h:box(title).h,lh:cs(title).lineHeight,overflow:cs(title).webkitLineClamp||cs(title).lineClamp||'none'}:null,"
  + "   price:price?{fs:cs(price).fontSize,color:cs(price).color}:null,"
  + "   yen:yen?{fs:cs(yen).fontSize,color:cs(yen).color,fw:cs(yen).fontWeight}:null,"
  + "   val:val?{fs:cs(val).fontSize,color:cs(val).color,fw:cs(val).fontWeight}:null},"
  + " imgs:{total:imgs.length,loaded,blank,naturalOk:imgs.filter(i=>i.naturalWidth===150&&i.naturalHeight===150).length},"
  + " tabbar:tab?{box:box(tab),pos:cs(tab).position,bottom:cs(tab).bottom,items:tabs.length,texts:tabs.map(t=>t.innerText.trim()),"
  + "   active:act?act.innerText.trim():null,activeColor:act?cs(act).color:null,activeBg:act?cs(act).backgroundColor:null,"
  + "   innerColors:tabs.map(t=>cs(t).color),innerFontWeights:tabs.map(t=>cs(t).fontWeight)}:null,"
  + " sidebar:[...document.querySelectorAll('aside,.sidebar,.side-nav')].map(e=>({cls:e.className,visible:cs(e).display!=='none'&&box(e).w>0,box:box(e)})),"
  + " search:search?{box:box(search),placeholder:search.placeholder,focusable:(search.focus(),document.activeElement===search),radius:cs(search).borderRadius,bg:cs(search).backgroundColor,type:search.type}:null,"
  + " mainBox:main?box(main):null, containerBoxes:[...document.querySelectorAll('.container,.wrap,.topbar__inner,main')].map(e=>({cls:e.className,box:box(e),maxW:cs(e).maxWidth,marginL:cs(e).marginLeft,paddingL:cs(e).paddingLeft})).slice(0,6),"
  + " shadowCount:shadow, radiusCount:radius, ctas,"
  + " viewportMeta:(document.querySelector('meta[name=viewport]')||{}).content||null"
  + "},null,1);})()";

async function audit(url, { w, h, dsf, mobile, label }) {
  const p = await openPage({ width: w, height: h, dsf, mobile });
  await p.navigate(url, 3200);
  const first = JSON.parse(await p.eval(AUDIT));
  const vp = await p.shot(outDir(`${label}-view.png`));
  // 滚到底：量最后一张卡底边 vs 底部 Tab 上沿；再看滚动后图片是否仍在
  await p.eval('window.scrollTo(0, document.documentElement.scrollHeight)');
  await p.wait(1200);
  const afterScroll = JSON.parse(await p.eval(AUDIT));
  const bottom = JSON.parse(await p.eval("(()=>{"
    + "const cards=[...document.querySelectorAll('li.card,.card')];const last=cards[cards.length-1];"
    + "const tab=document.querySelector('.tabbar,nav.tabbar');"
    + "const lb=last.getBoundingClientRect(),tb=tab?tab.getBoundingClientRect():null;"
    + "const imgs=[...document.querySelectorAll('img[src^=\"/assets/products/\"]')];"
    + "return JSON.stringify({scrollY:Math.round(scrollY),lastCardBottom:Math.round(lb.bottom),tabTop:tb?Math.round(tb.top):null,"
    + "occludedBy:tb?Math.round(lb.bottom-tb.top):null,imgsLoaded:imgs.filter(i=>i.complete&&i.naturalWidth>0).length,imgsTotal:imgs.length,"
    + "maxScroll:document.documentElement.scrollHeight-innerHeight});})()"));
  const full = await p.shotFull(outDir(`${label}-full.png`));
  await p.close();
  return { label, url, first, afterScrollImgs: { total: afterScroll.imgs.total, loaded: afterScroll.imgs.loaded }, bottom, vp, full: full.file };
}

const out = {};
out.w390 = await audit('http://127.0.0.1:3000/', { w: 390, h: 844, dsf: 2, mobile: true, label: 'T3-390首页' });
out.w1280 = await audit('http://127.0.0.1:3000/', { w: 1280, h: 900, dsf: 1, mobile: false, label: 'T10-1280首页' });
fs.writeFileSync(outDir('p1-visual.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
