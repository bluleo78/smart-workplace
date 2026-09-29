#!/usr/bin/env sh
# pre-push gate (firehub 패턴 기반)
# - push 직전 전체 회귀 안전망 (E2E 전체 + gradle 풀)
# - pre-commit 에서 도메인 한정/smoke 로 우회된 spec 들을 풀로 재검증
# - AI 자동화가 여러 커밋을 쌓아 push 할 때 누적 회귀 차단

set -e

# web 단위 테스트(vitest, 수 초) — E2E 보다 먼저 돌려 순수 로직 회귀를 빠르게 실패시킨다 (WP-79)
(cd apps/workplace-web && pnpm test)
# web 전체 E2E 는 preview 서버(빌드 결과물 서빙)로 실행 — 워커 4 기준 dev 13.3분 → 7.9분 (WP-76)
(cd apps/workplace-web && E2E_SERVER=preview pnpm test:e2e)
(cd apps/workplace-admin && pnpm test:e2e)
# 게이트는 통과/실패만 필요 — test 의 finalizedBy 로 매번 도는 JaCoCo 리포트 생성은 제외 (WP-76)
cd apps/workplace-api && ./gradlew test -x generateJooq -x jacocoTestReport --build-cache --configuration-cache
