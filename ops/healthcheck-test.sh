#!/usr/bin/env bash
# HC-1a: proves a Dockerfile's HEALTHCHECK probe is honest, using the Dockerfile's own base image and HEALTHCHECK line.
# A stub server stands in for the app. Container "live" listens on <port>; container "dead" listens on <port>+1, so the
# probe's port is dead. Expect: live -> Health.Status=healthy, dead -> unhealthy (probe exits non-zero).
# usage: ops/healthcheck-test.sh <Dockerfile> <port> <path>        (needs docker; no app build, no DB, no network)
set -euo pipefail
DF=${1:?Dockerfile}; PORT=${2:?port}; URLPATH=${3:?path}
D=$(mktemp -d); trap 'docker rm -f hc-live hc-dead >/dev/null 2>&1 || true; rm -rf "$D"' EXIT
# resolve the final stage's base image (follows "FROM <stage> AS ..." chains in multi-stage Dockerfiles)
BASE=$(awk '/^FROM /{img=$2; if(img in a) img=a[img]; if($3=="AS"||$3=="as") a[$4]=img; last=img} END{print last}' "$DF")
HC=$(awk '/^HEALTHCHECK/{f=1} f{print} f&&!/\\$/{exit}' "$DF")
[ -n "$HC" ] || { echo "no HEALTHCHECK in $DF"; exit 1; }
cat > "$D/srv.js" <<J
require('http').createServer((q,s)=>{s.statusCode=q.url==='$URLPATH'?200:404;s.end('ok')}).listen(process.env.APP_LISTEN||$PORT)
J
{ echo "FROM $BASE"; echo 'COPY srv.js /srv.js'; echo "$HC"; echo 'CMD ["node","/srv.js"]'; } > "$D/Dockerfile"
docker build -q -t hc-test "$D" >/dev/null
echo "healthcheck: $(docker inspect hc-test --format '{{json .Config.Healthcheck.Test}}')"
FAST=(--health-interval 2s --health-start-period 1s --health-retries 2 --health-timeout 10s)
docker run -d --name hc-live "${FAST[@]}" hc-test >/dev/null
docker run -d --name hc-dead "${FAST[@]}" -e APP_LISTEN=$((PORT+1)) hc-test >/dev/null
ls=starting; ds=starting
for _ in $(seq 1 30); do
  ls=$(docker inspect hc-live --format '{{.State.Health.Status}}'); ds=$(docker inspect hc-dead --format '{{.State.Health.Status}}')
  [ "$ls" = healthy ] && [ "$ds" = unhealthy ] && break; sleep 2
done
echo "live: Health.Status=$ls"; echo "dead: Health.Status=$ds"
echo "dead last probe: exit=$(docker inspect hc-dead --format '{{(index .State.Health.Log 0).ExitCode}}')"
[ "$ls" = healthy ] && [ "$ds" = unhealthy ] && echo PASS || { echo FAIL; exit 1; }
