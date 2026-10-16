#!/usr/bin/env bash
# FEAT-002 UAT · P-16 复验：compose 起的 app 容器必须用「容器内视角」取证
# （上一轮教训：该编排把宿主 3000 也发布了，而宿主 127.0.0.1:3000 已被托管实例占用，
#   从宿主 curl 127.0.0.1:3000 打到的是托管实例，不是容器 ⇒ 必须 docker exec 进容器内验证）
set -u
cd "$(dirname "$0")/../.." || exit 99
EV="reports/uat/evidence/FEAT-002-uat/ops"
mkdir -p "$EV"
SECRET="$(openssl rand -hex 32)"
ENVF="$EV/compose-env.env"; printf 'SESSION_SECRET=%s\n' "$SECRET" > "$ENVF"
PROJ=uat002c2
export SESSION_SECRET="$SECRET"
H=127.0.0.1

echo "-- 托管实例基线（辨别用的 uptime）: $(curl -s http://$H:3000/health)"
COMPOSE="docker compose --env-file ${ENVF} -f deploy/docker-compose.yml -p $PROJ"
DOCKER_BUILDKIT=0 $COMPOSE up -d > "$EV/p16b-up.out" 2>&1; echo "up -d 退出码=$?"
tail -6 "$EV/p16b-up.out" | sed 's/^/  /'
echo "-- 等 app 容器 healthy（最多 90s）:"
for i in $(seq 1 30); do
  ST=$(docker inspect ${PROJ}-app-1 --format '{{.State.Health.Status}}' 2>/dev/null)
  [ "$ST" = "healthy" ] && break
  sleep 3
done
echo "   app 容器健康状态=${ST}（等待 $((i*3))s）"
echo "-- compose ps:"; $COMPOSE ps -a --format '{{.Service}} | {{.Status}} | {{.Ports}}' | sed 's/^/  /'
echo "-- 容器关键属性:"
docker inspect ${PROJ}-app-1 --format '   User={{.Config.User}} ReadonlyRootfs={{.HostConfig.ReadonlyRootfs}} Health={{.State.Health.Status}} cmd={{json .Config.Cmd}}' 2>&1
echo "-- 容器内身份: $(docker exec ${PROJ}-app-1 id 2>&1)"
echo "-- 容器内 /health: $(docker exec ${PROJ}-app-1 node -e "fetch('http://127.0.0.1:3000/health').then(r=>r.text()).then(t=>console.log(t))" 2>&1 | tail -1)"
echo "-- 容器内首页 title: $(docker exec ${PROJ}-app-1 node -e "fetch('http://127.0.0.1:3000/').then(r=>r.text()).then(t=>console.log((t.match(/<title>[^<]*/)||[''])[0]))" 2>&1 | tail -1)"
echo "-- 容器内下单闭环（注册→加购→下单）:"
docker exec ${PROJ}-app-1 node -e '
const B="http://127.0.0.1:3000";
(async()=>{
  const j=async(u,o={})=>{const r=await fetch(B+u,{...o,headers:{...(o.headers||{}),cookie:global.CK||""}});const sc=r.headers.getSetCookie?r.headers.getSetCookie():[];if(sc.length)global.CK=sc.map(c=>c.split(";")[0]).join("; ");let b=null;try{b=await r.json()}catch{};return {s:r.status,b};};
  const reg=await j("/api/v1/auth/register",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:"uat-c16@example.com",password:"uat-pass-12345"})});
  console.log("   register:",reg.s);
  const add=await j("/api/v1/cart/items",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({productId:"P-001",quantity:1})});
  console.log("   add:",add.s,JSON.stringify(add.b).slice(0,80));
  const ord=await j("/api/v1/orders",{method:"POST",headers:{"content-type":"application/json"},body:"{}"});
  console.log("   order:",ord.s,JSON.stringify(ord.b).slice(0,120));
})().catch(e=>console.log("   容器内请求失败:",e.message));' 2>&1 | sed 's/^/  /'
echo "-- 宿主发布端口（注意：3000 与托管实例冲突，勿以此判定容器）:"
docker port ${PROJ}-app-1 2>&1 | sed 's/^/  /'
LANIP=$(ipconfig getifaddr en0 2>/dev/null || true)
if [ -n "${LANIP:-}" ]; then
  echo "-- 用非环回地址 $LANIP:3000 判别（应打到容器，uptime 很小）: $(curl -s --max-time 4 "http://$LANIP:3000/health" || echo 不可达)"
fi
echo "-- 对照：宿主环回 127.0.0.1:3000 = $(curl -s http://127.0.0.1:3000/health)"
$COMPOSE down -v > "$EV/p16b-down.out" 2>&1; echo "-- down 退出码=$?"
echo "-- down 后残留: $(docker ps -a --filter "label=com.docker.compose.project=$PROJ" --format '{{.Names}}' | tr '\n' ' ')(空=已清空)"
echo "-- 他人容器: $(docker ps --format '{{.Names}}' | tr '\n' ' ')"
