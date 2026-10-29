#!/usr/bin/env sh
# 훅 셸 테스트 공용 단언 — pre-commit.test.sh·pre-push.test.sh 가 source 한다 (WP-446).
PASS=0
FAIL=0

# git 훅 안에서 돌면(pre-commit 3.7) git 이 넘긴 GIT_DIR·GIT_INDEX_FILE 등이 남아, 테스트가 만든 임시 저장소 대신
# 바깥 저장소·인덱스를 건드린다(WP-1208). 테스트는 늘 자기 cwd 의 저장소만 보게 끊는다.
unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE GIT_PREFIX GIT_OBJECT_DIRECTORY GIT_COMMON_DIR

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
