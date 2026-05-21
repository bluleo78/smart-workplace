#!/usr/bin/env sh
# pre-push gate (firehub 패턴 기반)
# - push 직전 전체 회귀 안전망
# - pre-commit 에서 build-cache hit 으로 사실상 즉시 통과한 케이스를 풀로 재검증
# - AI 자동화가 여러 커밋을 쌓아 push 할 때 누적 회귀 차단

set -e

cd apps/workplace-api && ./gradlew test -x generateJooq --build-cache --configuration-cache

# TODO: workplace-web 추가 시
#  pnpm test:e2e
