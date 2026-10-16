// UAT 黑盒驱动库（FEAT-002）：真实 Edge headless + CDP，零依赖。
// 只通过浏览器对外可观察的行为取证：DOM 计算样式、截图、网络事件、输入事件。
// 不读任何源码 / 测试 / 报告。
import fs from 'node:fs';
import path from 'node:path';

const CDP_HTTP = process.env.CDP_HTTP || 'http://127.0.0.1:9222';

export async function openPage({ width = 390, height = 844, dsf = 2, mobile = false, url = 'about:blank' } = {}) {
  const v = await (await fetch(`${CDP_HTTP}/json/version`)).json();
  const ws = new WebSocket(v.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method) events.push(m);
  };
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const send = (method, params = {}, sessionId) => new Promise((res) => {
    const i = ++id; pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params, sessionId }));
  });
  const t = await send('Target.createTarget', { url: 'about:blank' });
  const targetId = t.result.targetId;
  const a = await send('Target.attachToTarget', { targetId, flatten: true });
  const sid = a.result.sessionId;
  await send('Page.enable', {}, sid);
  await send('Runtime.enable', {}, sid);
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dsf, mobile }, sid);

  const api = {
    sid, targetId, events, send,
    eval: async (expr, { awaitPromise = false } = {}) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise }, sid);
      if (r.result && r.result.exceptionDetails) return { __error: JSON.stringify(r.result.exceptionDetails).slice(0, 400) };
      return r.result && r.result.result ? r.result.result.value : undefined;
    },
    navigate: async (url2, waitMs = 2500) => {
      await send('Page.navigate', { url: url2 }, sid);
      await new Promise((r) => setTimeout(r, waitMs));
    },
    setMetrics: async (m) => {
      await send('Emulation.setDeviceMetricsOverride', { deviceScaleFactor: 2, mobile: false, height: 900, ...m }, sid);
      await new Promise((r) => setTimeout(r, 600));
    },
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
    key: async (text) => {
      for (const ch of text) {
        await send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, unmodifiedText: ch }, sid);
        await send('Input.dispatchKeyEvent', { type: 'keyUp', text: ch, unmodifiedText: ch }, sid);
        await new Promise((r) => setTimeout(r, 25));
      }
    },
    clickAt: async (x, y) => {
      const base = { x, y, button: 'left', clickCount: 1 };
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base }, sid);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base }, sid);
      await new Promise((r) => setTimeout(r, 700));
    },
    clickSel: async (sel) => {
      const box = await api.eval(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,tag:e.tagName,txt:(e.innerText||e.value||'').slice(0,40)};})()`);
      if (!box || box.__error) return { ok: false, box };
      await api.wait(250);
      const box2 = await api.eval(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      await api.clickAt(box2.x, box2.y);
      return { ok: true, box: box2 };
    },
    shot: async (file) => {
      const out = path.resolve(file);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const r = await send('Page.captureScreenshot', { format: 'png' }, sid);
      fs.writeFileSync(out, Buffer.from(r.result.data, 'base64'));
      return out;
    },
    shotFull: async (file) => {
      const out = path.resolve(file);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const m = await send('Page.getLayoutMetrics', {}, sid);
      const cs = m.result.cssContentSize || m.result.contentSize;
      const r = await send('Page.captureScreenshot', {
        format: 'png', captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: cs.width, height: cs.height, scale: 1 },
      }, sid);
      fs.writeFileSync(out, Buffer.from(r.result.data, 'base64'));
      return { file: out, contentSize: cs };
    },
    close: async () => {
      try { await send('Target.closeTarget', { targetId }); } catch { /* ignore */ }
      try { ws.close(); } catch { /* ignore */ }
    },
  };
  if (url !== 'about:blank') await api.navigate(url);
  return api;
}

export const outDir = (sub = '') => path.resolve('reports/uat/evidence/FEAT-002-uat', sub);

export function line(s) { console.log(s); }
