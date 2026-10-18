#!/bin/bash
# R1-TW-MONITORING apply on 62.171.141.202. Args: apply | drill-on | drill-off | rollback <ts>
set -euo pipefail
G=/opt/g3-observability; T=$G/timeway; PROM=prom/prometheus:v3.5.5@sha256:332c2f43e7e389d74d3893b55bb02fbbd684208e681eeb604641d5d769c0fe2a
pt(){ docker run --rm -v $G:/g -w /g --entrypoint promtool $PROM "$@"; }
reload(){ docker kill -s HUP g3-prometheus >/dev/null; sleep 5; docker logs --since 10s g3-prometheus 2>&1 | grep -E "Completed loading|Error" | tail -2; }
case "$1" in
apply)
  TS=$(date -u +%Y%m%dT%H%M%SZ); echo "ts=$TS"
  cp $G/prometheus.yml $G/prometheus.yml.bak-$TS
  docker run --rm -v $T:/w -w /w --entrypoint promtool $PROM test rules timeway-slo.rules.test.yml | tail -1
  docker compose -p tw-monitoring -f $T/docker-compose.yml up -d 2>&1 | tail -1
  grep -q "job_name: 'timeway-blackbox'" $G/prometheus.yml || cat $T/scrape-job.yml >> $G/prometheus.yml
  cp $T/timeway-slo.rules.yml $G/rules/timeway-slo.rules.yml
  if ! pt check config prometheus.yml >/tmp/twcheck 2>&1; then cat /tmp/twcheck; cp $G/prometheus.yml.bak-$TS $G/prometheus.yml; rm -f $G/rules/timeway-slo.rules.yml; echo ROLLED_BACK; exit 1; fi
  tail -3 /tmp/twcheck; reload ;;
drill-on)
  grep -q "timeway-drill" $G/prometheus.yml || sed -i "s#      - targets: \['tw_version|https://timeway.co/api/version', 'tw_login|https://timeway.co/auth/login'\]#      - targets: ['tw_drill_fail|https://timeway.co/api/version']\n        labels:\n          product: 'timeway-drill'\n&#" $G/prometheus.yml
  pt check config prometheus.yml | tail -1; reload ;;
drill-off)
  python3 - <<EOF
p="$G/prometheus.yml"; s=open(p).read()
s=s.replace("      - targets: ['tw_drill_fail|https://timeway.co/api/version']\n        labels:\n          product: 'timeway-drill'\n","")
open(p,"w").write(s)
EOF
  pt check config prometheus.yml | tail -1; reload ;;
rollback)
  cp $G/prometheus.yml.bak-$2 $G/prometheus.yml; rm -f $G/rules/timeway-slo.rules.yml
  docker compose -p tw-monitoring -f $T/docker-compose.yml down; reload ;;
esac
