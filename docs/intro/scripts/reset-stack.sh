#!/usr/bin/env bash
# 격리 촬영 스택의 DB 를 비우고 API 를 다시 띄운다(시드는 빈 DB 에서만 돈다).
# 사용: JAR=<api jar> LOG=<로그 경로> docs/intro/scripts/reset-stack.sh
set -euo pipefail
docker rm -f intro-deck-db >/dev/null 2>&1 || true
docker run -d --name intro-deck-db -e POSTGRES_DB=workplace -e POSTGRES_USER=app -e POSTGRES_PASSWORD=app -p 5444:5432 pgvector/pgvector:pg18 >/dev/null
sleep 4
"$(dirname "$0")/start-api.sh"
echo "stack ready"
