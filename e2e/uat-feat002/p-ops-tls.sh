#!/usr/bin/env bash
# FEAT-002 UAT · P-19 反代终结 TLS + COOKIE_SECURE / TRUST_PROXY 黑盒取证
set -u
cd "$(dirname "$0")/../.." || exit 99
EV="reports/uat/evidence/FEAT-002-uat/ops"
mkdir -p "$EV"
SECRET="$(openssl rand -hex 32)"
D="$EV/data"; mkdir -p "$D"
H=127.0.0.1
PID=""

echo "##### P-19a 应用自身只跑 HTTP（不读证书、不监听 443）#####"
echo "-- 明文 HTTP /health: $(curl -s -o /dev/null -w '%{http_code}' http://$H:3000/health)"
echo "-- 直接向 3000 发 TLS 握手（期望失败）:"
curl -sS -o /dev/null -w '   status=%{http_code}\n' https://$H:3000/health 2>"$EV/p19-tls.err"; echo "   curl 退出码=$?；stderr=$(head -c 160 "$EV/p19-tls.err")"
echo "-- 本机 443 监听（期望没有本应用的进程）:"; lsof -nP -iTCP:443 -sTCP:LISTEN 2>/dev/null | sed 's/^/   /'; echo "   (无输出=没有 443 监听)"

echo; echo "##### P-19b 应用侧会话 cookie 属性（COOKIE_SECURE=0 / 1）#####"
env NODE_ENV=production SESSION_SECRET="$SECRET" PORT=3141 DB_PATH="$D/p19a.db" node server/src/index.mjs > "$EV/p19a.log" 2>&1 & PID=$!
sleep 1.8
echo "-- COOKIE_SECURE 未设（默认 0）注册响应头 Set-Cookie:"
curl -s -D - -o /dev/null -X POST -H 'content-type: application/json' -d '{"email":"uat-tls1@example.com","password":"uat-pass-12345"}' http://$H:3141/api/v1/auth/register | grep -i '^set-cookie' | sed 's/^/   /'
kill -TERM "$PID"; wait "$PID" 2>/dev/null
env NODE_ENV=production SESSION_SECRET="$SECRET" PORT=3141 DB_PATH="$D/p19a.db" COOKIE_SECURE=1 node server/src/index.mjs > "$EV/p19b.log" 2>&1 & PID=$!
sleep 1.8
echo "-- COOKIE_SECURE=1 时登录响应头 Set-Cookie:"
curl -s -D - -o /dev/null -X POST -H 'content-type: application/json' -d '{"email":"uat-tls1@example.com","password":"uat-pass-12345"}' http://$H:3141/api/v1/auth/login | grep -i '^set-cookie' | sed 's/^/   /'
kill -TERM "$PID"; wait "$PID" 2>/dev/null

echo; echo "##### P-19c TRUST_PROXY：是否采信转发头（我自采实例日志）#####"
env NODE_ENV=production SESSION_SECRET="$SECRET" PORT=3142 DB_PATH="$D/p19c.db" LOG_LEVEL=debug node server/src/index.mjs > "$EV/p19c.log" 2>&1 & PID=$!
sleep 1.8
curl -s -o /dev/null -H 'X-Forwarded-For: 203.0.113.9' http://$H:3142/api/v1/products
sleep 0.4; echo "-- TRUST_PROXY=0（默认）时日志里是否出现 203.0.113.9: $(grep -c '203.0.113.9' "$EV/p19c.log") 次"
grep 'api/v1/products' "$EV/p19c.log" | tail -1 | sed 's/^/   /'
kill -TERM "$PID"; wait "$PID" 2>/dev/null
env NODE_ENV=production SESSION_SECRET="$SECRET" PORT=3142 DB_PATH="$D/p19c.db" LOG_LEVEL=debug TRUST_PROXY=1 node server/src/index.mjs > "$EV/p19d.log" 2>&1 & PID=$!
sleep 1.8
curl -s -o /dev/null -H 'X-Forwarded-For: 203.0.113.9' http://$H:3142/api/v1/products
sleep 0.4; echo "-- TRUST_PROXY=1 时日志里是否出现 203.0.113.9: $(grep -c '203.0.113.9' "$EV/p19d.log") 次"
grep 'api/v1/products' "$EV/p19d.log" | tail -1 | sed 's/^/   /'
kill -TERM "$PID"; wait "$PID" 2>/dev/null

echo; echo "##### P-19d 反代示例配置能否被 Caddy 接受（caddy validate）#####"
docker run --rm -v "$(pwd)/deploy/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1 | sed 's/^/   /'
echo "   validate 退出码=$?"

echo; echo "##### P-19e 真握手：compose proxy 档案起 Caddy，从宿主做 TLS 握手 #####"
ENVF="$EV/compose-env.env"; printf 'SESSION_SECRET=%s\n' "$SECRET" > "$ENVF"
PROJ=uat002t
export SESSION_SECRET="$SECRET"
COMPOSE="docker compose --env-file ${ENVF} -f deploy/docker-compose.yml -p $PROJ"
DOCKER_BUILDKIT=0 $COMPOSE --profile proxy up -d > "$EV/p19-up.out" 2>&1
echo "  proxy 档案 up -d 退出码=$?"; tail -8 "$EV/p19-up.out" | sed 's/^/   /'
echo "-- ps:"; $COMPOSE --profile proxy ps --format '{{.Service}} {{.Status}} {{.Ports}}' 2>&1 | sed 's/^/   /'
for SVC in proxy caddy; do
  echo "-- $SVC 发布端口: $(docker compose --env-file "$ENVF" -f deploy/docker-compose.yml -p $PROJ port $SVC 443 2>&1 | head -1)"
done
PORT443=$(docker compose --env-file "$ENVF" -f deploy/docker-compose.yml -p $PROJ port proxy 443 2>/dev/null | awk -F: '{print $NF}')
if [ -z "${PORT443}" ]; then PORT443=$(docker compose --env-file "$ENVF" -f deploy/docker-compose.yml -p $PROJ port caddy 443 2>/dev/null | awk -F: '{print $NF}'); fi
echo "-- 推定 TLS 端口=${PORT443:-未发布}"
if [ -n "${PORT443}" ]; then
  sleep 6
  echo "-- openssl s_client 握手（真实 TLS，证书由 Caddy 内部 CA 签发）:"
  echo | openssl s_client -connect $H:$PORT443 -servername localhost 2>"$EV/p19-sclient.err" | openssl x509 -noout -subject -issuer -dates 2>&1 | sed 's/^/   /'
  echo "-- curl -k -I https://$H:$PORT443/ :"; curl -sk -D - -o /dev/null "https://$H:$PORT443/" | grep -iE '^(HTTP|content-type|set-cookie)' | sed 's/^/   /'
  echo "-- curl -k https://$H:$PORT443/health : $(curl -sk -o "$EV/p19-health.body" -w '%{http_code}' "https://$H:$PORT443/health") body=$(cat "$EV/p19-health.body")"
  echo "-- 不给 -k（验证书链是否被系统信任，期望失败 = 内部 CA）: $(curl -s -o /dev/null -w '%{http_code}' "https://$H:$PORT443/health" 2>/dev/null || echo 失败)"
  echo "-- HTTP 是否被重定向到 HTTPS:"; curl -s -D - -o /dev/null "http://$H:$PORT443/health" 2>/dev/null | grep -iE '^(HTTP|location)' | sed 's/^/   /'
fi
$COMPOSE --profile proxy down -v > "$EV/p19-down.out" 2>&1; echo "  down 退出码=$?"; tail -4 "$EV/p19-down.out" | sed 's/^/   /'
echo "-- down 后本项目残留: $(docker ps -a --filter "label=com.docker.compose.project=$PROJ" --format '{{.Names}}' | tr '\n' ' ')"

echo; echo "##### 收尾自查 #####"
for p in 3141 3142; do lsof -nP -iTCP:$p -sTCP:LISTEN 2>/dev/null | tail -n +2 | sed "s/^/  [$p] /"; done; echo "(无输出=无残留)"
echo "-- 别人的容器仍在: $(docker ps --format '{{.Names}}' | tr '\n' ' ')"
