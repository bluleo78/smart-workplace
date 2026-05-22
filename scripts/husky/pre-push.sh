#!/usr/bin/env sh
# pre-push gate (firehub 패턴 기반)
# - push 직전 전체 회귀 안전망 (E2E 전체 + gradle 풀)
# - pre-commit 에서 도메인 한정/smoke 로 우회된 spec 들을 풀로 재검증
# - AI 자동화가 여러 커밋을 쌓아 push 할 때 누적 회귀 차단

set -e

(cd apps/workplace-web && pnpm test:e2e)
cd apps/workplace-api && ./gradlew test -x generateJooq --build-cache --configuration-cache
