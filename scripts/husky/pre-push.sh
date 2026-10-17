#!/usr/bin/env sh
# pre-push gate (firehub 패턴 기반)
# - push 직전 전체 회귀 안전망 (E2E 전체 + gradle 풀) — 실제 회귀는 full-regression.sh
# - pre-commit 에서 도메인 한정/smoke 로 우회된 spec 들을 풀로 재검증
# - AI 자동화가 여러 커밋을 쌓아 push 할 때 누적 회귀 차단
# 검증이 필요 없는 push 는 회귀를 건너뛴다 (WP-446) — ref 마다 실제로 올라가는 커밋 범위로 판정:
#   범위 = push 하는 커밋에서 <원격>/main 과 원격의 그 ref 가 가리키던 커밋(있으면)을 뺀 것.
#          (다른 원격 브랜치는 빼지 않는다 — 훅을 거치지 않고 올라간 커밋일 수 있다)
#   - 범위가 비었다(태그·삭제, 이미 main 에 있는 커밋) → 생략
#   - 범위의 변경이 모두 비코드(noncode.sh — pre-commit 과 같은 규칙) → 생략
#   - push 하는 커밋의 트리가 이미 전체 회귀를 통과한 트리(verified-trees.sh) → 생략
#   ref 하나라도 위에 해당하지 않으면 전체 회귀. stdin 이 비었거나 터미널이면(직접 실행) 전체 회귀.
# 인자: $1 = 원격 이름(git 이 넘긴다), stdin = `<local ref> <local sha> <remote ref> <remote sha>` 줄들.
# 환경변수:
#   PREPUSH_DRY_RUN       — 판정만 출력하고 회귀는 돌리지 않는다(테스트용)
#   PREPUSH_VERIFIED_FILE — 검증 완료 트리 기록 파일(verified-trees.sh)

set -e

HOOK_DIR=$(dirname "$0")
. "$HOOK_DIR/noncode.sh"
. "$HOOK_DIR/verified-trees.sh"

REMOTE="${1:-origin}"

# run_full <사유> — 전체 회귀로 넘어간다(dry-run 이면 표시만).
run_full() {
  echo "[pre-push] 전체 회귀 실행 — $1"
  if [ -n "$PREPUSH_DRY_RUN" ]; then
    echo "[pre-push][dry-run] full-regression.sh"
    exit 0
  fi
  exec "$HOOK_DIR/full-regression.sh"
}

# is_zero_sha <sha> — 0 으로만 된 sha(없는 ref)인가.
is_zero_sha() { case "$1" in *[!0]*) return 1 ;; esac; }

# skip <ref 이름> <사유> — 생략 사유를 쌓는다.
skip() { SKIP_REASONS="${SKIP_REASONS}$1: $2; "; }

# 터미널에서 직접 실행하면 push 정보가 없다 — read 가 입력을 기다리며 멈추지 않게 바로 전체 회귀.
[ ! -t 0 ] || run_full "직접 실행 (머지 전 회귀는 pnpm test:full)"

# 락을 잡기 전에 stdin 을 다 읽고 판정한다 — 건너뛸 push 가 다른 세션의 회귀를 기다리지 않게.
SEEN=0
SKIP_REASONS=""
while read -r local_ref local_sha remote_ref remote_sha; do
  [ -n "$local_ref" ] || continue
  SEEN=1
  name=${local_ref#refs/*/}
  # 원격 ref 삭제(로컬 sha 가 0) — 올라가는 커밋이 없다.
  if is_zero_sha "$local_sha"; then skip "$name" "삭제"; continue; fi

  commit=$(git rev-parse --verify --quiet "$local_sha^{commit}" || true)
  [ -n "$commit" ] || run_full "$name: 커밋을 가리키지 않음"

  # 뺄 기준: 원격 main + (있으면) 원격 ref 의 이전 값. 로컬에 없는 원격 sha 는 쓸 수 없으니 빼지 않는다(범위가 커질 뿐).
  # sha·ref 이름엔 공백이 없어 단어 분리로 넘겨도 안전하다.
  NOT_REFS=""
  git rev-parse --verify --quiet "refs/remotes/$REMOTE/main" >/dev/null && NOT_REFS="refs/remotes/$REMOTE/main"
  if ! is_zero_sha "$remote_sha" && git cat-file -e "$remote_sha^{commit}" 2>/dev/null; then NOT_REFS="$NOT_REFS $remote_sha"; fi

  # 범위의 커밋과 바꾼 파일을 한 번에 — 머지 커밋은 첫 부모 대비(충돌 해결분 포함), 삭제·이름 변경 전후 경로도 포함.
  # 한글 경로가 따옴표·8진수로 바뀌지 않게 quotePath 를 끈다.
  LOG=$(git -c core.quotePath=false log --format='@%H' --name-only --no-renames --diff-merges=first-parent "$commit" --not $NOT_REFS)
  if [ -z "$LOG" ]; then
    skip "$name" "새 커밋 없음"; continue
  fi
  if [ -z "$(code_files "$(printf '%s\n' "$LOG" | grep -v '^@')")" ]; then
    skip "$name" "비코드 변경만"; continue
  fi

  tree=$(git rev-parse "$commit^{tree}")
  if is_verified "$tree"; then
    skip "$name" "이미 전체 회귀를 통과한 트리 $(printf %.12s "$tree")"; continue
  fi

  run_full "$name: 코드 변경"
done

# git 은 올릴 ref 가 있을 때만 훅을 부른다 — 빈 stdin 은 직접 실행(파이프·에이전트 셸)이다.
[ "$SEEN" -eq 1 ] || run_full "push 정보 없음 — 직접 실행으로 본다 (머지 전 회귀는 pnpm test:full)"

echo "[pre-push] 회귀 생략 — $SKIP_REASONS"
