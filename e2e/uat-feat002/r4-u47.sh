#!/usr/bin/env bash
# FEAT-002 UAT r4 · U-47 TLS / 反代（照 docs/DEPLOY.md §起法 3 + --profile proxy 逐字执行）
set -u
cd "$(dirname "$0")/../.." || exit 99
EV="reports/uat/evidence/FEAT-002-uat"; OPS="$EV/ops"; mkdir -p "$OPS"
ROOT=$(pwd); H=localhost
export DOCKER_CONFIG=/tmp/dockercfg DOCKER_BUILDKIT=0 COMPOSE_PROJECT_NAME=uater4
export SESSION_SECRET="$(openssl rand -hex 32)" COOKIE_SECURE=1 TRUST_PROXY=1
DC="docker compose -f ${ROOT}/deploy/docker-compose.yml"
echo "##### U-47-0 前置：不带档案时不动 80/443 #####"
echo "  当前 80/443 监听：$(lsof -nP -iTCP:80 -sTCP:LISTEN -iTCP:443 -sTCP:LISTEN 2>/dev/null | wc -l | tr -d ' ') 行"
echo "  （说明：deploy/.env 在本机不存在，我来不及写 deploy/**；SESSION_SECRET/COOKIE_SECURE/TRUST_PROXY 三个值改用 shell 环境变量传入，其余命令逐字照文档）"
echo; echo "##### U-47-1 带 proxy 档案起（文档命令） #####"
$DC --profile proxy up -d > "$OPS/r4-u47-up.out" 2>&1; echo "  up -d rc=$?"
for i in $(seq 1 60); do
  A=$(docker inspect -f '{{.State.Health.Status}}' uater4-app-1 2>/dev/null || echo none)
  P=$(docker inspect -f '{{.State.Health.Status}}' uater4-proxy-1 2>/dev/null || echo none)
  [ "$A" = healthy ] && [ "$P" = healthy ] && break; sleep 1
done
echo "  app=$A proxy=${P}（等 ${i}s）；容器：$(docker ps --format '{{.Names}} {{.Status}}' | grep uater4 | tr '\n' ' ')"
echo "  文档命令 ps："; $DC --profile proxy ps 2>&1 | sed 's/^/    /'
echo; echo "##### U-47-2 文档四条 curl 逐字 #####"
echo "  https /health 状态码 = $(curl -k -s -o /dev/null -w '%{http_code}' https://$H/health)"
echo "  https /health 体 = $(curl -k -s https://$H/health)"
echo "  http 80 跳转 = $(curl -s -o /dev/null -w '%{http_code} -> %{redirect_url}' http://$H/ 2>&1)"
echo "  http 80 /health 跳转 = $(curl -s -o /dev/null -w '%{http_code} -> %{redirect_url}' http://$H/health 2>&1)"
echo "  https 首页状态码 = $(curl -k -s -o /dev/null -w '%{http_code}' https://$H/)"
echo; echo "##### U-47-3 会话 cookie 是否带 Secure（https 注册） #####"
curl -k -s -D "$OPS/r4-u47-cookie.hdr" -o /dev/null -H 'content-type: application/json' \
  -d "{\"email\":\"r4tls+$(date +%s)@example.com\",\"password\":\"uat-pass-12345\"}" "https://$H/api/v1/auth/register"
grep -i '^set-cookie' "$OPS/r4-u47-cookie.hdr" | sed 's/^/    /'
echo "  含 Secure：$(grep -ic 'secure' "$OPS/r4-u47-cookie.hdr") 处"
echo; echo "##### U-47-4 真实浏览器走 https（8 卡 8 图 / 零第三方 / 购物车流程） #####"
cat > /tmp/r4-u47.mjs <<'EOF'
import { openPage, outDir } from '/Users/admin/workspace/dsh-process-kit-example/e2e/uat-feat002/lib-cdp.mjs';
const H='https://localhost'; const R={};
const p=await openPage({width:390,height:844,dsf:2,mobile:true});
await p.send('Network.enable',{},p.sid);
try{ await p.send('Security.enable',{},p.sid); }catch(e){ R.securityEnable=String(e); }
await p.send('Security.setIgnoreCertificateErrors',{ignore:true},p.sid);
await p.send('Network.clearBrowserCookies',{},p.sid);
await p.navigate(H+'/',3500);
R.page=JSON.parse(await p.eval("(()=>{const a=[...document.querySelectorAll('img')];const host=[...new Set(performance.getEntriesByType('resource').map(e=>{try{return new URL(e.name).host}catch{return 'data:'}}))];return JSON.stringify({title:document.title,cards:document.querySelectorAll('li.card').length,imgs:a.length,loaded:a.filter(i=>i.complete&&i.naturalWidth>0).length,srcs:[...new Set(a.map(i=>i.getAttribute('src')))],hosts:host,body:(document.body.innerText||'').slice(0,90)});})()"));
R.shot=await p.shot(outDir('U-47-https-首页390.png'));
R.cookieBefore=(await p.eval("document.cookie")).length;
await p.navigate(H+'/#/products/P-002',2500);
R.detail=JSON.parse(await p.eval("(()=>{const a=document.querySelector('img');return JSON.stringify({imgs:document.querySelectorAll('img').length,first:a?a.getAttribute('src'):null,loaded:a?a.complete&&a.naturalWidth>0:null});})()"));
await p.eval("(()=>{const b=[...document.querySelectorAll('button')].find(x=>/加入购物车/.test(x.innerText));b.click();return 1;})()");
await p.wait(1500);
await p.navigate(H+'/#/cart',2500);
R.cart=JSON.parse(await p.eval("(()=>{const t=(document.body.innerText||'').replace(/\\n+/g,' | ');return JSON.stringify({text:t.slice(0,160),rows:document.querySelectorAll('.cart-row,li').length});})()"));
R.cartShot=await p.shot(outDir('U-47-https-购物车390.png'));
await p.navigate(H+'/#/login',2200);
await p.clickSel('#auth-email'); await p.send('Input.insertText',{text:'r4tls2+'+Date.now()+'@example.com'},p.sid);
await p.clickSel('#auth-password'); await p.send('Input.insertText',{text:'uat-pass-12345'},p.sid);
await p.eval("(()=>{const b=[...document.querySelectorAll('button')].find(x=>/^登录/.test(x.innerText.trim()));b.click();return 1;})()");
await p.wait(2500);
R.afterLogin=(await p.eval("(document.body.innerText||'').replace(/\\n+/g,' | ').slice(0,120)"));
R.cookieLen=(await p.eval("document.cookie")).length;
await p.navigate(H+'/#/me',2200);
R.meShot=await p.shot(outDir('U-47-https-我的已登录390.png'));
const to=(pr,ms)=>Promise.race([pr,new Promise(r=>setTimeout(()=>r('TIMEOUT'),ms))]);
R.cookieHeader=await to(p.send('Network.getCookies',{urls:[H+'/']},p.sid),4000);
console.log(JSON.stringify(R,null,1));
await p.close();
EOF
node /tmp/r4-u47.mjs > "$OPS/r4-u47-browser.out" 2>&1; echo "  browser rc=$?"; cat "$OPS/r4-u47-browser.out" | head -80
echo; echo "##### U-47-5 收起并确认没有残留 #####"
$DC --profile proxy down -v --remove-orphans > "$OPS/r4-u47-down.out" 2>&1; echo "  down -v rc=$?"
echo "  残留容器/卷=$(docker ps -a --format '{{.Names}}' | grep -c uater4)/$(docker volume ls --format '{{.Name}}' | grep -c uater4)"
echo "  收后 80/443 监听：$(lsof -nP -iTCP:80 -sTCP:LISTEN -iTCP:443 -sTCP:LISTEN 2>/dev/null | wc -l | tr -d ' ') 行"
echo "  托管 3000 = $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/health)"
