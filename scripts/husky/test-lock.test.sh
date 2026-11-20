#!/usr/bin/env sh
# 테스트 게이트 락 경로·run-locked.sh 검증 (WP-1811) — AI Pod 에서는 락이 저장소를 넘어 AI 폴더 하나이고,
# Pod 가 아니면 저장소별(git common dir) 그대로임을, run-locked.sh 가 종료 코드·인자를 보존함을 단언한다.
# 이 테스트는 환경변수를 케이스마다 명시해(env -u / env VAR=) 돌리는 곳이 Pod 인지에 기대지 않고, 물려받은 재진입 표시(TEST_GATE_LOCK_HELD)는 맨 앞에서 지운다.
#
# 사용: 리포지토리 루트에서 `sh scripts/husky/test-lock.test.sh`

set -e
HOOKS="$(cd "$(dirname "$0")" && pwd)"
. "$HOOKS/test-helpers.sh"

# 바깥이 이미 락 안(run-locked 로 감싼 커밋 등)이어도 결과가 같게, 물려받은 재진입 표시를 지우고 시작한다(WP-1811 리뷰 후속).
unset TEST_GATE_LOCK_HELD

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir "$TMP/ai"
git init -q -b main "$TMP/work"
cd "$TMP/work"

# lock_path <env 인자...> — 주어진 환경에서 test-lock.sh 를 source 해 정해진 TEST_GATE_LOCK 을 찍는다.
lock_path() {
  env "$@" HOOKS="$HOOKS" sh -c '. "$HOOKS/test-lock.sh"; echo "$TEST_GATE_LOCK"'
}

check "Pod 면 AI 폴더" "$(lock_path GENIA_WORKS_AGENT_DIR="$TMP/ai" KUBERNETES_SERVICE_HOST=10.0.0.1)" "$TMP/ai/.test-gate.lock"
check "AGENT_DIR 만 있으면 저장소별" "$(lock_path -u KUBERNETES_SERVICE_HOST GENIA_WORKS_AGENT_DIR="$TMP/ai")" "workplace-test-gate.lock" "$TMP/ai"
check "K8S 변수만 있으면 저장소별" "$(lock_path -u GENIA_WORKS_AGENT_DIR KUBERNETES_SERVICE_HOST=10.0.0.1)" "workplace-test-gate.lock" "$TMP/ai"
check "둘 다 없으면 저장소별" "$(lock_path -u GENIA_WORKS_AGENT_DIR -u KUBERNETES_SERVICE_HOST)" "workplace-test-gate.lock" "$TMP/ai"

# 종료 코드 보존
rc=0
env GENIA_WORKS_AGENT_DIR="$TMP/ai" KUBERNETES_SERVICE_HOST=10.0.0.1 sh "$HOOKS/run-locked.sh" sh -c 'exit 7' >/dev/null 2>&1 || rc=$?
# rc=7 은 부분 문자열로 비교하면 70~79 도 통과하므로, 정확히 7 일 때만 고정 문자열을 찍는다.
if [ "$rc" -eq 7 ]; then code=종료코드7; else code="rc=$rc"; fi
check "run-locked 종료 코드 보존" "$code" "종료코드7"

# 인자 경계 보존
out=$(env GENIA_WORKS_AGENT_DIR="$TMP/ai" KUBERNETES_SERVICE_HOST=10.0.0.1 sh "$HOOKS/run-locked.sh" printf '%s|' 'a b' c)
check "run-locked 인자 보존" "$out" "a b|c|"

# Pod 환경에서 잡은 락 파일이 AI 폴더에 생긴다
if [ -f "$TMP/ai/.test-gate.lock" ]; then lockfile=있음; else lockfile=없음; fi
check "Pod 락 파일이 AI 폴더에 생김" "$lockfile" "있음"

# 감싼 명령 안에서 다시 run-locked 를 불러도 멈추지 않는다(같은 락 재진입, WP-1811) — 멈추면 timeout 이 끊는다
# macOS 기본에는 timeout 이 없어 있을 때만 쓴다.
TO=""
if command -v timeout >/dev/null 2>&1; then TO="timeout 10"; fi
out=$(env GENIA_WORKS_AGENT_DIR="$TMP/ai" KUBERNETES_SERVICE_HOST=10.0.0.1 $TO sh "$HOOKS/run-locked.sh" sh "$HOOKS/run-locked.sh" echo 안쪽실행 2>&1) || true
check "재진입해도 멈추지 않음" "$out" "안쪽실행"

# 표시(TEST_GATE_LOCK_HELD)는 잡은 락 경로다 — 같은 경로면 건너뛰고, 다른 경로면 그 락을 잡으려 기다린다(WP-1811 리뷰 후속).
# 다른 프로세스가 AI 락을 쥔 동안 확인한다. 기다리는 쪽은 timeout 이 끊으므로 timeout 이 있을 때만 한다.
if [ -n "$TO" ]; then
  # 쥐는 쪽은 fd 로 락을 잡은 채 sleep 으로 바뀐다(exec) — kill 한 번으로 락이 풀리고 남는 자식이 없다.
  # 시간이 아니라 「락이 실제로 잡혔는지」를 기다려(flock -n 실패) 부하가 큰 곳에서도 흔들리지 않게 한다.
  ( exec 9>"$TMP/ai/.test-gate.lock"; flock 9; exec sleep 60 ) &
  holder=$!
  i=0
  while flock -n "$TMP/ai/.test-gate.lock" true && [ "$i" -lt 100 ]; do sleep 0.1; i=$((i + 1)); done
  # 심볼릭 링크로 가리킨 같은 AI 폴더 — 철자가 달라도 같은 락으로 본다
  ln -s "$TMP/ai" "$TMP/ai-link"
  out=$(env TEST_GATE_LOCK_HELD="$(cd -P "$TMP/ai" && pwd -P)/.test-gate.lock" GENIA_WORKS_AGENT_DIR="$TMP/ai-link" KUBERNETES_SERVICE_HOST=10.0.0.1 timeout 3 sh "$HOOKS/run-locked.sh" echo 같은표시실행 2>&1) || true
  check "같은 락 표시면(링크 철자여도) 건너뛰고 바로 실행" "$out" "같은표시실행" "대기합니다"
  out=$(env TEST_GATE_LOCK_HELD="$TMP/other.lock" GENIA_WORKS_AGENT_DIR="$TMP/ai" KUBERNETES_SERVICE_HOST=10.0.0.1 timeout 3 sh "$HOOKS/run-locked.sh" echo 다른표시실행 2>&1) || true
  check "다른 락 표시면 건너뛰지 않고 기다림" "$out" "대기합니다" "다른표시실행"
  out=$(env TEST_GATE_LOCK_HELD=1 GENIA_WORKS_AGENT_DIR="$TMP/ai" KUBERNETES_SERVICE_HOST=10.0.0.1 timeout 3 sh "$HOOKS/run-locked.sh" echo 옛표시실행 2>&1) || true
  check "옛 표시(=1)는 호환으로 건너뜀" "$out" "옛표시실행" "대기합니다"
  kill "$holder" 2>/dev/null || true
  wait "$holder" 2>/dev/null || true
fi

# 인자 없으면 사용법 + 종료 2
rc=0
env GENIA_WORKS_AGENT_DIR="$TMP/ai" KUBERNETES_SERVICE_HOST=10.0.0.1 sh "$HOOKS/run-locked.sh" >/dev/null 2>&1 || rc=$?
check "인자 없으면 종료 2" "rc=$rc" "rc=2"

finish
