// 黑盒 DOM 侦察：只打印页面自身对外呈现的结构摘要（标签/文本/计算样式），不读任何源码。
import { openPage, outDir } from './lib-cdp.mjs';

const p = await openPage({ width: 390, height: 844, dsf: 2, mobile: true });
await p.navigate('http://127.0.0.1:3000/', 3500);
const dump = await p.eval(`(()=>{
  const brief=(e,d)=>{
    const r=e.getBoundingClientRect(); const cs=getComputedStyle(e);
    return {tag:e.tagName.toLowerCase(),cls:(e.className&&e.className.toString().slice(0,60))||'',id:e.id||'',
      text:(e.innerText||'').replace(/\\n+/g,' | ').slice(0,90),
      box:[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)],
      bg:cs.backgroundColor,color:cs.color,radius:cs.borderRadius,shadow:cs.boxShadow.slice(0,40),pos:cs.position};
  };
  const walk=(e,d,acc)=>{ if(d>3)return acc; for(const c of e.children){ if(['SCRIPT','STYLE'].includes(c.tagName))continue; acc.push({...brief(c),d}); walk(c,d+1,acc);} return acc; };
  const links=[...document.querySelectorAll('a')].map(a=>({href:a.getAttribute('href'),text:(a.innerText||'').trim().slice(0,20)}));
  const inputs=[...document.querySelectorAll('input,button,select,textarea')].map(i=>({tag:i.tagName.toLowerCase(),type:i.type||'',id:i.id||'',cls:(i.className||'').toString().slice(0,50),ph:i.placeholder||'',text:(i.innerText||i.value||'').slice(0,30)}));
  const imgs=[...document.querySelectorAll('img')].map(i=>({src:i.getAttribute('src'),w:Math.round(i.getBoundingClientRect().width),h:Math.round(i.getBoundingClientRect().height),nat:i.naturalWidth+'x'+i.naturalHeight}));
  return JSON.stringify({url:location.href,title:document.title,hash:location.hash,bodyBg:getComputedStyle(document.body).backgroundColor,
    htmlBg:getComputedStyle(document.documentElement).backgroundColor,
    docW:document.documentElement.scrollWidth,innerW:innerWidth,scrollH:document.documentElement.scrollHeight,
    tree:walk(document.body,0,[]).slice(0,60), links, inputs, imgCount:imgs.length, imgs:imgs.slice(0,5)},null,1);
})()`);
console.log(dump);
await p.shot(outDir('recon-390.png'));
await p.close();
