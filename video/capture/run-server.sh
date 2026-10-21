#!/bin/bash
# Restart the demo server (the app in this repo, built into ../../dist) from the pristine demo data.
HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$HERE/../.." && pwd)"
mkdir -p /tmp/sc-demo
pkill -f "[s]ound-carvers-demo-server" 2>/dev/null; sleep 1
rm -rf /tmp/sc-demo/data && cp -a "$HERE/demo-data" /tmp/sc-demo/data
cd "$APP"
DATA_DIR=/tmp/sc-demo/data STATIC_DIR=./dist PORT=18791 BAND_PASSWORD=demo-ensaio-2026 SECURE_COOKIES=false \
  nohup bash -c 'exec -a sound-carvers-demo-server node server/index.ts' > /tmp/sc-demo/server.log 2>&1 &
for i in $(seq 1 30); do curl -sf http://127.0.0.1:18791/api/health >/dev/null && exit 0; sleep 0.5; done; exit 1
