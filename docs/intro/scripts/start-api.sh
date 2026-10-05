#!/usr/bin/env bash
# 격리 촬영 스택의 API 만 (다시) 띄운다 — DB 는 건드리지 않는다.
# 사용: JAR=<api jar> LOG=<로그 경로> docs/intro/scripts/start-api.sh
#
# 메일·캘린더(M365) 장면: M365_CLIENT_ID / M365_TENANT_ID / M365_CLIENT_SECRET 를 환경변수로 넘기면 함께 켜진다.
# OAuth 돌아오는 주소가 http://localhost:6173/oauth/m365/callback 으로 고정(Azure 등록값)이라 그때는 웹도 6173 으로 띄운다.
set -euo pipefail
pkill -f -- "--server.port=6160" || true
sleep 2
nohup java -jar "$JAR" --spring.profiles.active=local --server.port=6160 \
  --spring.datasource.url=jdbc:postgresql://localhost:5444/workplace \
  --spring.flyway.url=jdbc:postgresql://localhost:5444/workplace \
  "--app.cors.allowed-origins=http://localhost:6273,http://localhost:6173" \
  --app.mail.m365.redirect-uri=http://localhost:6173/oauth/m365/callback \
  --workplace.ai-agent.base-url=http://localhost:6170 \
  --workplace.worker.base-url=http://localhost:6180 > "$LOG" 2>&1 &
until curl -s localhost:6160/actuator/health | grep -q '"UP"'; do sleep 2; done
echo "api ready"
