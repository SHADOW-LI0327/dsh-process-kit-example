#!/usr/bin/env bash
# FEAT-002 UAT · P-15 容器化 / P-16 编排一键起（照 docs/DEPLOY.md 的起法；环境陷阱：加 DOCKER_BUILDKIT=0）
set -u
cd "$(dirname "$0")/../.." || exit 99
EV="reports/uat/evidence/FEAT-002-uat/ops"
mkdir -p "$EV"
SECRET="$(openssl rand -hex 32)"
H=127.0.0.1
IMG=shop:uat-feat002
PROJ=uat002c
ENVF="$EV/compose-env.env"
printf 'SESSION_SECRET=%s\n' "$SECRET" > "$ENVF"
echo "SESSION_SECRET=<32+ 字符随机串>（写在我自己的取证文件 ${ENVF}，未改 deploy/.env）"

echo "##### 环境事实：动手前的容器清单（勿动他人）#####"
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Ports}}' | sed 's/^/  /'

echo; echo "##### P-15a 构建镜像（DEPLOY：docker build -f deploy/Dockerfile -t shop:local .）#####"
DOCKER_BUILDKIT=0 docker build -f deploy/Dockerfile -t "$IMG" . > "$EV/p15-build.out" 2>&1
RC=$?; echo "  构建退出码=$RC"; tail -4 "$EV/p15-build.out" | sed 's/^/  /'
echo "  镜像信息:"; docker image inspect "$IMG" --format '  User={{.Config.User}} WorkDir={{.Config.WorkingDir}} Exposed={{.Config.ExposedPorts}} Healthcheck={{json .Config.Healthcheck}} Cmd={{json .Config.Cmd}}' 2>&1

echo; echo "##### P-15b 单容器起法（DEPLOY 第 2 种）#####"
docker rm -f uat002-c1 >/dev/null 2>&1; docker volume rm uat002-vol1 >/dev/null 2>&1
docker run -d --name uat002-c1 -p 3130:3000 -v uat002-vol1:/data -e SESSION_SECRET="$SECRET" "$IMG" > "$EV/p15-run.out" 2>&1
echo "  docker run 退出码=$? 容器=$(cat "$EV/p15-run.out" | head -c 12)"
echo "  等待健康检查（interval 30s / start-period 10s，最多等 75s）:"
for i in $(seq 1 25); do
  ST=$(docker inspect uat002-c1 --format '{{.State.Health.Status}}' 2>/dev/null)
  [ "$ST" = "healthy" ] && break
  sleep 3
done
echo "  .State.Health.Status=${ST} （等待 $((i*3))s）"
echo "  curl 宿主映射端口 3130/health: status=$(curl -s -o "$EV/p15-health.body" -w '%{http_code}' http://$H:3130/health) body=$(cat "$EV/p15-health.body")"
echo "  容器内进程身份: $(docker exec uat002-c1 id 2>&1)"
echo "  容器内 /data: $(docker exec uat002-c1 ls -ld /data 2>&1)"
echo "  容器内读 /app 是否可写（期望失败）: $(docker exec uat002-c1 sh -c 'touch /app/.uat-probe 2>&1 && echo 可写-异常 || echo 只读' 2>&1)"
echo "  容器内 /tmp 是否可写: $(docker exec uat002-c1 sh -c 'touch /tmp/.uat-probe && echo 可写' 2>&1)"
echo "  宿主映射: $(docker port uat002-c1 2>&1 | tr '\n' ' ')"
echo "  健康检查定义: $(docker inspect uat002-c1 --format '{{json .Config.Healthcheck}}')"
echo "  持久化验证（写一次订单后重启容器，数据是否仍在）:"
curl -s -c "$EV/jar15.txt" -X POST -H 'content-type: application/json' -d '{"email":"uat-c15@example.com","password":"uat-pass-12345"}' http://$H:3130/api/v1/auth/register > /dev/null
curl -s -b "$EV/jar15.txt" -X POST -H 'content-type: application/json' -d '{"productId":"P-001","quantity":1}' http://$H:3130/api/v1/cart/items > /dev/null
echo "    建单=$(curl -s -b "$EV/jar15.txt" -X POST -H 'content-type: application/json' -d '{}' http://$H:3130/api/v1/orders | head -c 120)"
docker restart uat002-c1 > /dev/null 2>&1; sleep 6
echo "    重启后 /health=$(curl -s -o /dev/null -w '%{http_code}' http://$H:3130/health) 订单列表=$(curl -s -b "$EV/jar15.txt" "http://$H:3130/api/v1/orders?limit=10" | head -c 160)"

echo; echo "##### P-15c 只读根文件系统（--read-only）能否正常工作 #####"
docker rm -f uat002-c2 >/dev/null 2>&1; docker volume rm uat002-vol2 >/dev/null 2>&1
docker run -d --name uat002-c2 --read-only --tmpfs /tmp -p 3131:3000 -v uat002-vol2:/data -e SESSION_SECRET="$SECRET" "$IMG" > "$EV/p15c-run.out" 2>&1
echo "  退出码=$?"; sleep 4
echo "  rootfs 只读确认: $(docker inspect uat002-c2 --format '{{.HostConfig.ReadonlyRootfs}}')"
echo "  /health=$(curl -s -o "$EV/p15c.body" -w '%{http_code}' http://$H:3131/health) body=$(cat "$EV/p15c.body")"
echo "  写入匿名车是否成功（证明只读根下仍可服务）: $(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{"productId":"P-002","quantity":1}' http://$H:3131/api/v1/cart/items)"
docker rm -f uat002-c1 uat002-c2 > /dev/null 2>&1
docker volume rm uat002-vol1 uat002-vol2 > /dev/null 2>&1

echo; echo "##### P-16 单机编排一键起（DEPLOY 第 3 种）#####"
echo "-- 说明：.env 归 dev-agent，我不写 deploy/.env，改用 --env-file 指向我自己的取证文件（等价注入 SESSION_SECRET）"
export SESSION_SECRET="$SECRET"
COMPOSE="docker compose --env-file ${ENVF} -f deploy/docker-compose.yml -p $PROJ"
DOCKER_BUILDKIT=0 ${COMPOSE} up -d > "$EV/p16-up.out" 2>&1
echo "  up -d 退出码=$?"; tail -12 "$EV/p16-up.out" | sed 's/^/  /'
echo "-- docker compose ps:"; ${COMPOSE} ps 2>&1 | sed 's/^/  /'
echo "-- 服务与端口:"; docker compose --env-file "$ENVF" -f deploy/docker-compose.yml -p ${PROJ} ps --format '{{.Service}} {{.Status}} {{.Ports}}' 2>&1 | sed 's/^/  /'
APP_PORT=$(docker compose --env-file "$ENVF" -f deploy/docker-compose.yml -p ${PROJ} port app 3000 2>/dev/null | awk -F: '{print $NF}')
echo "-- app 发布端口=$APP_PORT"
if [ -n "${APP_PORT:-}" ]; then
  echo "   curl http://$H:$APP_PORT/health status=$(curl -s -o "$EV/p16-health.body" -w '%{http_code}' "http://$H:$APP_PORT/health") body=$(cat "$EV/p16-health.body")"
  echo "   curl http://$H:$APP_PORT/ 首页 title=$(curl -s "http://$H:$APP_PORT/" | grep -o '<title>[^<]*' | head -1)"
fi
echo "-- 备份服务（起服前快照）是否产出:"
docker compose --env-file "$ENVF" -f deploy/docker-compose.yml -p ${PROJ} ps -a --format '{{.Service}} {{.Status}}' 2>&1 | sed 's/^/  /'
echo "-- 一键停（down）:"
${COMPOSE} down -v > "$EV/p16-down.out" 2>&1; echo "  down 退出码=$?"; tail -6 "$EV/p16-down.out" | sed 's/^/  /'
echo "-- down 后残留（本项目应无）:"; docker ps -a --filter "label=com.docker.compose.project=$PROJ" --format '{{.Names}} {{.Status}}' | sed 's/^/  /'; echo "  (无输出=已清空)"

echo; echo "##### 收尾自查 #####"
echo "-- 我建的容器/卷是否清空:"; docker ps -a --format '{{.Names}}' | grep -E 'uat002' | sed 's/^/  /'; echo "  (无输出=无残留)"
docker volume ls --format '{{.Name}}' | grep -E 'uat002' | sed 's/^/  卷: /'; echo "  (无输出=无残留卷)"
echo "-- 是否影响他人的容器（应只有别人的 yente-postgres）:"; docker ps --format '{{.Names}} {{.Image}}' | sed 's/^/  /'
