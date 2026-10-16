import { openPage, outDir } from '/Users/admin/workspace/dsh-process-kit-example/e2e/uat-feat002/lib-cdp.mjs';
const B='http://127.0.0.1:3000';
const p=await openPage({width:390,height:844,dsf:2,mobile:true});
await p.send('Network.enable',{},p.sid);
await p.send('Network.clearBrowserCookies',{},p.sid);
const E=(x)=>p.eval(x);
const R={};
const cardMetrics=`(()=>{const out=[];for(const c of document.querySelectorAll('li.card')){const img=c.querySelector('img');const wrap=c.querySelector('.card__wrap')||img.parentElement;const cr=c.getBoundingClientRect();const wr=wrap.getBoundingClientRect();const ir=img.getBoundingClientRect();const s=getComputedStyle(img);const ws=getComputedStyle(wrap);const badge=c.querySelector('.card__badge');out.push({name:c.getAttribute('data-product-name')||c.querySelector('h3').innerText.trim(),cardW:+cr.width.toFixed(1),cardH:+cr.height.toFixed(1),wrapW:+wr.width.toFixed(1),wrapH:+wr.height.toFixed(1),wrapRatio:+(wr.width/wr.height).toFixed(4),wrapAspect:ws.aspectRatio,imgW:+ir.width.toFixed(1),imgH:+ir.height.toFixed(1),imgRatio:+(ir.width/ir.height).toFixed(4),imgAspect:s.aspectRatio,fit:s.objectFit,natural:img.naturalWidth+'x'+img.naturalHeight,loaded:img.complete&&img.naturalWidth>0,badge:badge?badge.innerText.trim():null,badgesInCard:c.querySelectorAll('.card__badge').length});}return JSON.stringify(out);})()`;
const gridMetrics=`(()=>{const g=document.querySelector('ul.grid,.grid');const s=getComputedStyle(g);return JSON.stringify({tpl:s.gridTemplateColumns,cols:s.gridTemplateColumns.split(' ').length,gap:s.gap,containerW:+g.getBoundingClientRect().width.toFixed(1),hScroll:document.documentElement.scrollWidth>innerWidth,innerW:innerWidth});})()`;
const promo=`(()=>{const out=[];for(const e of document.querySelectorAll('*')){const t=(e.innerText||'').trim();if(e.children.length===0&&/满 ?99 ?元包邮/.test(t)){const r=e.getBoundingClientRect();const s=getComputedStyle(e);const path=[];let n=e;while(n&&n!==document.body&&path.length<4){path.push(n.tagName.toLowerCase()+(n.className?'.'+String(n.className).split(' ').join('.'):''));n=n.parentElement;}out.push({t,bg:s.backgroundColor,c:s.color,fs:s.fontSize,box:Math.round(r.width)+'x'+Math.round(r.height),y:Math.round(r.top),path:path.join(' < ')});}}return JSON.stringify(out);})()`;
// ---------- 390 ----------
await p.navigate(B+'/',3200);
R.w390={cards:JSON.parse(await E(cardMetrics)),grid:JSON.parse(await E(gridMetrics)),promo:JSON.parse(await E(promo))};
R.w390page=await p.shotFull(outDir('U-60-首页390-全页.png'));
await p.shot(outDir('U-60-首页390-首屏角标.png'));
// 搜索：滤
await p.clickSel('#search-input');
await p.send('Input.insertText',{text:'滤'},p.sid);
await p.wait(1200);
R.search滤=JSON.parse(await E(`JSON.stringify({n:document.querySelectorAll('li.card').length,names:[...document.querySelectorAll('li.card h3')].map(x=>x.innerText.trim()),body:(document.body.innerText||'').replace(/\\n+/g,' | ').slice(0,300)})`));
await p.shot(outDir('U-59-搜索滤-390.png'));
await p.eval(`(()=>{const i=document.querySelector('#search-input');i.value='';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);
await p.send('Input.insertText',{text:'zzz'},p.sid);
await p.wait(1200);
R.searchZzz=JSON.parse(await E(`JSON.stringify({n:document.querySelectorAll('li.card').length,body:(document.body.innerText||'').replace(/\\n+/g,' | ').slice(0,300)})`));
await p.shot(outDir('U-59-搜索无结果-390.png'));
await p.eval(`(()=>{const i=document.querySelector('#search-input');i.value='';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);
await p.wait(600);
// ---------- 详情 390 ----------
await p.navigate(B+'/#/products/P-002',2600);
R.detail390=JSON.parse(await E(`(()=>{const i=document.querySelector('.detail__img,img');const r=i.getBoundingClientRect();const s=getComputedStyle(i);return JSON.stringify({cls:i.className,box:r.width.toFixed(1)+'x'+r.height.toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1),ratio:+(r.width/r.height).toFixed(4),aspect:s.aspectRatio,fit:s.objectFit,natural:i.naturalWidth+'x'+i.naturalHeight,attrW:i.getAttribute('width'),attrH:i.getAttribute('height')});})()`));
await p.shot(outDir('U-60-详情主图-390.png'));
// 加购两件（同一商品两件即可让购物车非空；再加另一件以看多行）
await p.eval(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/加入购物车/.test(x.innerText));b.click();return 1;})()`);
await p.wait(1200);
await p.navigate(B+'/#/products/P-004',2400);
await p.eval(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/加入购物车/.test(x.innerText));b.click();return 1;})()`);
await p.wait(1400);
// ---------- 1280 首页 ----------
await p.setMetrics({width:1280,height:900,dsf:1,mobile:false});
await p.navigate(B+'/',3000);
R.w1280={cards:JSON.parse(await E(cardMetrics)),grid:JSON.parse(await E(gridMetrics)),promo:JSON.parse(await E(promo))};
await p.shot(outDir('U-60-首页1280-角标与主图.png'));
await p.shotFull(outDir('U-60-首页1280-全页.png'));
await p.navigate(B+'/#/products/P-002',2600);
R.detail1280=JSON.parse(await E(`(()=>{const i=document.querySelector('.detail__img,img');const r=i.getBoundingClientRect();const s=getComputedStyle(i);return JSON.stringify({box:r.width.toFixed(1)+'x'+r.height.toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1),ratio:+(r.width/r.height).toFixed(4),aspect:s.aspectRatio,fit:s.objectFit});})()`));
await p.shot(outDir('U-60-详情主图-1280.png'));
// ---------- UI-29：1280 购物车 / 结算 结算卡 ----------
const cardProbe=`(()=>{const out={};const hit=[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&/合计/.test(e.innerText||''));out.合计节点=hit.map(e=>e.innerText.trim().slice(0,20));if(hit.length){const chain=[];let n=hit[0];while(n&&n!==document.body&&chain.length<6){const r=n.getBoundingClientRect();const s=getComputedStyle(n);chain.push({tag:n.tagName.toLowerCase(),cls:String(n.className),w:+r.width.toFixed(1),h:+r.height.toFixed(1),x:+r.left.toFixed(1),radius:s.borderRadius,bg:s.backgroundColor,shadow:(s.boxShadow||'none').slice(0,40)});n=n.parentElement;}out.祖先链=chain;}
const panels=[...document.querySelectorAll('.panel,.card,.summary,.cart-summary,.checkout,.bar')].map(e=>{const r=e.getBoundingClientRect();const s=getComputedStyle(e);return {cls:String(e.className),w:+r.width.toFixed(1),h:+r.height.toFixed(1),x:+r.left.toFixed(1),radius:s.borderRadius,bg:s.backgroundColor};});out.面板候选=panels;out.innerW=innerWidth;out.docW=document.documentElement.scrollWidth;return JSON.stringify(out);})()`;
await p.navigate(B+'/#/cart',2800);
R.cart1280=JSON.parse(await E(cardProbe));
R.cart1280text=(await E(`(document.body.innerText||'').replace(/\\n+/g,' | ').slice(0,320)`));
await p.shot(outDir('U-60-购物车1280-结算卡.png'));
await p.navigate(B+'/#/checkout',2800);
R.checkout1280=JSON.parse(await E(cardProbe));
R.checkout1280text=(await E(`(document.body.innerText||'').replace(/\\n+/g,' | ').slice(0,380)`));
await p.shot(outDir('U-60-结算页1280-结算卡.png'));
await p.setMetrics({width:390,height:844,dsf:2,mobile:true});
await p.navigate(B+'/#/cart',2600);
R.cart390=JSON.parse(await E(cardProbe));
await p.shot(outDir('U-60-购物车390-结算卡.png'));
await p.navigate(B+'/#/checkout',2600);
R.checkout390=JSON.parse(await E(cardProbe));
await p.shot(outDir('U-60-结算页390-结算卡.png'));
console.log(JSON.stringify(R,null,1));
await p.close();
