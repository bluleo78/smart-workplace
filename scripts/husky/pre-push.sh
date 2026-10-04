#!/usr/bin/env sh
# pre-push gate (firehub 패턴 기반)
# - push 직전 전체 회귀 안전망 (E2E 전체 + gradle 풀)
# - pre-commit 에서 도메인 한정/smoke 로 우회된 spec 들을 풀로 재검증
# - AI 자동화가 여러 커밋을 쌓아 push 할 때 누적 회귀 차단

set -e

# 게이트 전체를 저장소 전역 락 하나로 감싼다 — 워크트리 간 동시 push 가 겹치면 여기서 대기 (WP-98).
# 단계별로 락을 잡으면 사이사이 다른 세션이 끼어들어 한 게이트가 길게 늘어지므로 통째로 잡는다.
. "$(dirname "$0")/test-lock.sh"

run_locked sh -c '
  set -e
  # web 단위 테스트(vitest, 수 초) — E2E 보다 먼저 돌려 순수 로직 회귀를 빠르게 실패시킨다 (WP-79)
  (cd apps/workplace-web && pnpm test)
  # web 전체 E2E 는 preview 서버(빌드 결과물 서빙)로 실행 — 워커 4 기준 dev 13.3분 → 7.9분 (WP-76)
  # 재시도로 통과한 flaky 를 git common dir 의 누적 로그에 남긴다(모든 워크트리 공유, WP-225).
  # 실패해도 기록은 남기고 게이트 결과는 그대로 돌려준다.
  FLAKY_LOG="$(cd "$(git rev-parse --git-common-dir)" && pwd)/workplace-e2e-flaky.tsv"
  REPORT_JSON="$(pwd)/test-results/e2e-report.json"
  rm -f "$REPORT_JSON"
  e2e_status=0
  (cd apps/workplace-web && PLAYWRIGHT_JSON_OUTPUT_FILE="$REPORT_JSON" E2E_SERVER=preview pnpm test:e2e --reporter=html,json) || e2e_status=$?
  node scripts/e2e-flaky-record.mjs "$REPORT_JSON" "$FLAKY_LOG" || true
  [ "$e2e_status" -eq 0 ] || exit "$e2e_status"
  (cd apps/workplace-admin && pnpm test:e2e)
  # 게이트는 통과/실패만 필요 — test 의 finalizedBy 로 매번 도는 JaCoCo 리포트 생성은 제외 (WP-76)
  cd apps/workplace-api && ./gradlew test -x generateJooq -x jacocoTestReport --build-cache --configuration-cache
'
