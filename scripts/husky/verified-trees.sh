#!/usr/bin/env sh
# 「전체 회귀를 통과한 트리」 기록 — full-regression.sh 가 쓰고 pre-push.sh 가 읽는다 (WP-446).
# 기록 파일은 git common dir 에 둬 모든 워크트리가 공유한다. PREPUSH_VERIFIED_FILE 로 바꿀 수 있다(테스트용).

VERIFIED_FILE="${PREPUSH_VERIFIED_FILE:-$(cd "$(git rev-parse --git-common-dir)" && pwd)/workplace-prepush-verified-trees}"

# is_verified <트리 해시> — 기록에 있으면 0.
is_verified() {
  [ -f "$VERIFIED_FILE" ] && grep -qx "$1" "$VERIFIED_FILE"
}

# record_verified <트리 해시> — 기록에 더한다(같은 트리는 한 줄, 최근 500개만). 동시 기록이 서로 덮지 않게 임시 파일은 매번 새로 만든다.
record_verified() {
  tmp=$(mktemp "$VERIFIED_FILE.XXXXXX")
  { grep -vx "$1" "$VERIFIED_FILE" 2>/dev/null || true; echo "$1"; } | tail -n 500 > "$tmp"
  mv "$tmp" "$VERIFIED_FILE"
}
