#!/usr/bin/env sh
# 무거운 테스트 게이트(vitest·E2E·gradle) 저장소 전역 직렬화 헬퍼 — pre-commit/pre-push 가 source 한다.
# - 여러 워크트리/세션이 동시에 게이트를 돌리면 CPU 가 초과 구독돼 타임아웃성 flaky 와 시스템 전체
#   부하를 낳는다. Playwright globalSetup 락(e2e/global-lock.ts)은 webServer 기동·preview 빌드보다
#   늦게 잡히고 vitest·gradle 은 덮지 못하므로, 게이트 단계 전체를 여기서 한 번 더 감싼다.
# - 락 파일은 git common dir 에 둬 모든 워크트리가 같은 락을 공유한다.
# - AI Pod 에서는 락이 저장소를 넘어 AI 폴더에 하나다(WP-1811 — 한 Pod 에서 저장소 둘의 게이트가 겹쳐 OOM).
#   Pod 판정: GENIA_WORKS_AGENT_DIR 와 KUBERNETES_SERVICE_HOST 가 둘 다 비어 있지 않을 때.
#   같은 Pod 의 다른 저장소(WD 등) 락 스크립트도 정확히 `$GENIA_WORKS_AGENT_DIR/.test-gate.lock` 을 써야 서로 겹치지 않는다 — 경로를 바꾸면 그쪽도 함께 바꾼다(WP-1811).
# - macOS 는 flock(1) 이 기본 미탑재 — 실제 실행 직전에만 확인한다(brew install flock).

if [ -n "${GENIA_WORKS_AGENT_DIR:-}" ] && [ -n "${KUBERNETES_SERVICE_HOST:-}" ]; then
  TEST_GATE_LOCK="$GENIA_WORKS_AGENT_DIR/.test-gate.lock"
else
  TEST_GATE_LOCK="$(cd "$(git rev-parse --git-common-dir)" && pwd)/workplace-test-gate.lock"
fi

# run_locked <명령...> — 락을 잡은 채 명령을 실행하고, 다른 세션이 잡고 있으면 풀릴 때까지 대기한다.
run_locked() {
  # 이미 이 락 안에서 도는 중이면(run-locked.sh 로 감싼 명령이 게이트·커밋을 부름) 다시 잡지 않고 바로 실행한다 —
  # 같은 파일을 새 fd 로 다시 잡으면 바깥 락이 풀리지 않아 영영 기다린다(WP-1811).
  if [ "${TEST_GATE_LOCK_HELD:-}" = 1 ]; then
    "$@"
    return
  fi
  command -v flock >/dev/null 2>&1 || {
    echo "[test-lock] flock 명령이 없습니다. 'brew install flock' 후 다시 시도하세요." >&2
    exit 1
  }
  # 즉시 획득 못 하면 대기 중임을 알린다(조용히 멈춘 것처럼 보이지 않게).
  if ! flock -n "$TEST_GATE_LOCK" true; then
    echo "[test-lock] 다른 세션이 테스트 게이트 실행 중 — 대기합니다 (락: $TEST_GATE_LOCK)"
  fi
  # 잡은 뒤 한 줄 알린다 — 로그에 대기 줄만 있고 이 줄이 없으면 아직 락을 기다리는 게이트다(묶음으로 다시 띄울 수 있다, WP-1208).
  # 안쪽에서 다시 run_locked 를 불러도 멈추지 않게 TEST_GATE_LOCK_HELD=1 을 물려준다.
  TEST_GATE_LOCK_HELD=1 flock "$TEST_GATE_LOCK" sh -c 'echo "[test-lock] 락 획득 — 게이트 실행"; exec "$@"' sh "$@"
}
