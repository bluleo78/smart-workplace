#!/usr/bin/env sh
# 무거운 명령(vitest·gradle·E2E 등)을 테스트 게이트 락 아래에서 실행하는 래퍼 (WP-1811).
# - 훅 밖에서 손으로 돌리는 무거운 테스트도 게이트와 같은 락(AI Pod 에서는 Pod 전역)을 잡게 해
#   동시 실행으로 인한 OOM·타임아웃을 막는다.
# - 사용: sh scripts/husky/run-locked.sh <명령> [인자…] — 명령의 종료 코드로 끝난다.

if [ "$#" -eq 0 ]; then
  echo "사용법: run-locked.sh <명령> [인자…]" >&2
  exit 2
fi

. "$(dirname "$0")/test-lock.sh"
run_locked "$@"
