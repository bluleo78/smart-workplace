#!/usr/bin/env sh
# 테스트 게이트 락 경로·run-locked.sh 검증 (WP-1811) — AI Pod 에서는 락이 저장소를 넘어 AI 폴더 하나이고,
# Pod 가 아니면 저장소별(git common dir) 그대로임을, run-locked.sh 가 종료 코드·인자를 보존함을 단언한다.
# 이 테스트는 환경변수를 케이스마다 명시해(env -u / env VAR=) 돌리는 곳이 Pod 인지에 기대지 않는다.
#
# 사용: 리포지토리 루트에서 `sh scripts/husky/test-lock.test.sh`

set -e
HOOKS="$(cd "$(dirname "$0")" && pwd)"
. "$HOOKS/test-helpers.sh"

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

# 인자 없으면 사용법 + 종료 2
rc=0
env GENIA_WORKS_AGENT_DIR="$TMP/ai" KUBERNETES_SERVICE_HOST=10.0.0.1 sh "$HOOKS/run-locked.sh" >/dev/null 2>&1 || rc=$?
check "인자 없으면 종료 2" "rc=$rc" "rc=2"

finish
