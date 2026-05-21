#!/usr/bin/env sh
# pre-push gate
# - push 직전 전체 회귀 안전망 (E2E 전체 + gradle 풀)
# - pre-commit 에서 도메인 한정/smoke 로 우회된 spec 을 풀로 재검증
# - AI 자동화가 여러 커밋을 쌓아 push 할 때 누적 회귀 차단

set -e

# apps 추가 시 활성화
# pnpm test:e2e
# cd apps/workplace-api && ./gradlew test -x generateJooq --build-cache --configuration-cache

echo "(pre-push) apps 미존재 — 실제 회귀 테스트는 apps 추가 후 활성화"
