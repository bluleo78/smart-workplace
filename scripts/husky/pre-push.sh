#!/usr/bin/env sh
# pre-push gate (firehub 패턴 기반)
# - push 직전 전체 회귀 안전망 (E2E 전체 + gradle 풀)
# - pre-commit 에서 도메인 한정/smoke 로 우회된 spec 들을 풀로 재검증
# - AI 자동화가 여러 커밋을 쌓아 push 할 때 누적 회귀 차단

set -e

# web 전체 E2E 는 preview 서버(빌드 결과물 서빙) + 워커 확대로 실행 — dev 대비 약 절반 (WP-76)
(cd apps/workplace-web && E2E_SERVER=preview pnpm test:e2e)
(cd apps/workplace-admin && pnpm test:e2e)
cd apps/workplace-api && ./gradlew test -x generateJooq --build-cache --configuration-cache
