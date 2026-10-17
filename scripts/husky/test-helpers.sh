#!/usr/bin/env sh
# 훅 셸 테스트 공용 단언 — pre-commit.test.sh·pre-push.test.sh 가 source 한다 (WP-446).
PASS=0
FAIL=0

# check <설명> <출력> <기대 substring> [금지 substring] — 출력에 기대가 있고 금지가 없으면 PASS.
check() {
  ok=1
  case "$2" in *"$3"*) : ;; *) ok=0; echo "  기대 미포함: '$3'" ;; esac
  if [ -n "${4:-}" ]; then
    case "$2" in *"$4"*) ok=0; echo "  금지 포함됨: '$4'" ;; esac
  fi
  if [ "$ok" -eq 1 ]; then
    PASS=$((PASS + 1)); echo "PASS: $1"
  else
    FAIL=$((FAIL + 1)); echo "FAIL: $1"; echo "----- 출력 -----"; echo "$2"; echo "----------------"
  fi
}

# finish — 결과 한 줄을 찍고 실패가 있으면 0 이 아닌 값으로 끝낸다.
finish() {
  echo
  echo "=== 결과: PASS=$PASS FAIL=$FAIL ==="
  [ "$FAIL" -eq 0 ]
}
