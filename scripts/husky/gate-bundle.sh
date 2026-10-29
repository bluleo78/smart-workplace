#!/usr/bin/env sh
# 묶음 게이트 (WP-1208) — 검증까지 끝나 push 만 남은 내 브랜치 여러 개를 최신 origin/main 위에 임시로 합쳐 push 게이트(full-regression.sh)를
# 한 번만 돌린다. 전역 락으로 게이트가 하나씩만 돌아, 개발자가 PR 마다 게이트를 띄우면 락 앞에 줄을 서기 때문이다.
#   - 통과: 시작 때와 ref 가 같은 각 브랜치의 트리를 그 묶음 범위로 「검증 완료」 기록한다 — 각자 push 하면 pre-push 가 다시 돌지 않는다.
#     PR 은 이슈마다 따로 올린다(이슈 하나 = PR 하나 = 머지 하나).
#   - 실패: 아무 브랜치도 기록하지 않는다. 게이트는 처음 실패한 단계에서 멈춰 뒤 단계가 돌지 않았으니 남은 브랜치를 인정할 근거가 없다.
#     실패한 테스트를 브랜치마다 돌려 원인 브랜치를 가리고, 원인을 뺀 나머지로 다시 묶는다(하나만 남으면 그 브랜치에서 pnpm test:full).
#   - 서로 충돌하는 브랜치는 묶지 않고 알린다(따로 게이트를 돈다). 합친 트리의 마이그레이션 번호가 겹치면 돌기 전에 멈춘다 —
#     번호가 겹친 채 돌면 gradle 이 실패해 엉뚱한 브랜치를 탓하게 된다.
# 알려진 위험: 묶인 브랜치를 혼자서는 돌리지 않는다 — 기록되는 것은 각 브랜치의 트리지만 실제로 돈 것은 최신 main + 묶은 브랜치 전부를 합친 트리다.
#   A+B 통과 뒤 B 가 반려되거나, A 가 B·최신 main 에 기대 혼자로는 깨지는 경우를 이 게이트는 못 잡는다. 검토자의 머지 전 확인과
#   main CI verify 가 받친다(혼자 도는 게이트도 머지 결과는 돌리지 않으니, 합친 쪽이 머지 결과에 더 가깝다).
# 다른 AI 의 브랜치는 묶지 않는다 — 실패했을 때 책임이 갈리지 않게(이 스크립트는 넘긴 브랜치를 그대로 묶으므로 호출하는 쪽이 지킨다).
#
# 사용: 저장소(아무 워크트리) 안에서 `sh scripts/husky/gate-bundle.sh <브랜치>...` (`pnpm test:bundle <브랜치>...`)
# 합치는 곳: MAIN/.claude/worktrees/_gate-bundle-<pid>(끝나면 지운다). 설치·빌드는 락 밖에서 하고, 게이트 단계만 전역 락을 잡는다.
# 환경변수: PREPUSH_VERIFIED_FILE·FULL_REGRESSION_CMD·FULL_REGRESSION_SCOPE — full-regression.sh 와 같다(테스트에서는 설치·빌드를 건너뛴다).

set -e

HOOK_DIR=$(cd "$(dirname "$0")" && pwd)
. "$HOOK_DIR/noncode.sh"
. "$HOOK_DIR/gate-scope.sh"
. "$HOOK_DIR/verified-trees.sh"

say() { echo "[gate-bundle] $*"; }

[ $# -ge 1 ] || { echo "사용: sh scripts/husky/gate-bundle.sh <브랜치>..." >&2; exit 2; }
if [ -n "$FULL_REGRESSION_CMD" ] && [ -z "$PREPUSH_VERIFIED_FILE" ]; then
  echo "[gate-bundle] FULL_REGRESSION_CMD 는 테스트 전용 — PREPUSH_VERIFIED_FILE 없이 쓰면 공유 기록에 가짜 통과가 남는다" >&2
  exit 1
fi

BASE=refs/remotes/origin/main
git rev-parse --verify --quiet "$BASE" >/dev/null || { echo "[gate-bundle] origin/main 이 없습니다 — git fetch origin 뒤 다시" >&2; exit 2; }

COMMON=$(cd "$(git rev-parse --git-common-dir)" && pwd)
WT="$(dirname "$COMMON")/.claude/worktrees/_gate-bundle-$$"
INPUTS=$(mktemp)
cleanup() {
  rm -f "$INPUTS"
  [ -d "$WT" ] && git worktree remove --force "$WT" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# 1) 입력을 고정한다 — 시작 때의 커밋·트리. 끝날 때 ref 가 바뀐 브랜치는 기록하지 않는다(검사한 것이 그 커밋이 아니므로).
for b in "$@"; do
  sha=$(git rev-parse --verify --quiet "$b^{commit}") || { echo "[gate-bundle] 커밋을 찾을 수 없음: $b" >&2; exit 2; }
  echo "$b $sha $(git rev-parse "$sha^{tree}")" >> "$INPUTS"
done

# 2) 최신 origin/main 위에 차례로 합친다 — 앞서 합친 것과 충돌하는 브랜치는 빼고 알린다.
git worktree add --detach --quiet "$WT" "$BASE"
INCLUDED=""
while read -r b sha tree; do
  if (cd "$WT" && git merge --no-ff --no-edit --quiet "$sha" >/dev/null 2>&1); then
    INCLUDED="$INCLUDED $b"
  else
    (cd "$WT" && git merge --abort >/dev/null 2>&1) || true
    # 실패 이유를 가른다 — origin/main 과 바로 충돌하면 rebase 할 일이고, 아니면 앞서 합친 브랜치와의 충돌이다.
    if ! git merge-tree --write-tree "$BASE" "$sha" >/dev/null 2>&1; then
      say "$b: origin/main 과 충돌 — 묶음에서 뺍니다(rebase 해 충돌을 푼 뒤 게이트를 돌리세요)"
    else
      say "$b: 앞서 합친 브랜치와 충돌 — 묶음에서 뺍니다(따로 게이트를 돌리세요)"
    fi
  fi
done < "$INPUTS"
[ -n "$INCLUDED" ] || { say "합칠 수 있는 브랜치가 없습니다"; exit 1; }
say "묶은 브랜치:$INCLUDED"

# 3) 합친 트리의 마이그레이션 번호 — 브랜치끼리 같은 번호를 더했으면 돌기 전에 멈춘다(종료 코드 1만 막고 2는 알리고 넘어간다).
rc=0
(cd "$WT" && node "$HOOK_DIR/../check-migration-versions.mjs" "$BASE" HEAD) || rc=$?
[ "$rc" -ne 1 ] || { say "마이그레이션 번호가 겹칩니다 — 번호를 고친 뒤 다시 묶으세요"; exit 1; }
[ "$rc" -eq 0 ] || say "마이그레이션 번호를 확인하지 못함(종료 코드 $rc) — 넘어갑니다"

# 4) 설치·빌드는 락 밖에서 — 새 워크트리에는 node_modules·mcp-tools-shared dist 가 없다(.work-loop/project.md 1절).
if [ -z "$FULL_REGRESSION_CMD" ]; then
  (cd "$WT" && pnpm install --frozen-lockfile --prefer-offline && pnpm --filter @smart-workplace/mcp-tools-shared build)
fi

# 5) 게이트 한 번. 범위는 합친 트리의 변경(= 묶은 브랜치 변경의 합)으로 full-regression.sh 가 정한다.
status=0
(cd "$WT" && sh "$HOOK_DIR/full-regression.sh") || status=$?
if [ "$status" -ne 0 ]; then
  say "실패(종료 코드 $status) — 어느 브랜치도 기록하지 않습니다."
  say "원인 가리기: 위 로그에서 실패한 테스트를 묶은 브랜치마다 그 워크트리에서 돌려 원인 브랜치를 찾고,"
  say "  원인을 뺀 나머지로 다시 묶습니다(sh scripts/husky/gate-bundle.sh <나머지>... — 하나만 남으면 그 워크트리에서 pnpm test:full)."
  exit "$status"
fi

MERGED_TREE=$(cd "$WT" && git rev-parse 'HEAD^{tree}')
BUNDLE_SCOPE=$(verified_scope "$MERGED_TREE")
[ -n "$BUNDLE_SCOPE" ] || { say "통과했지만 합친 트리가 기록되지 않았습니다(작업 트리가 커밋과 달랐음) — 브랜치를 기록하지 않습니다"; exit 1; }

# 6) 통과 — 묶은 브랜치마다, 시작 때와 ref 가 같고 필요한 범위를 묶음 범위가 덮을 때만 그 트리를 기록한다.
while read -r b sha tree; do
  case " $INCLUDED " in *" $b "*) : ;; *) continue ;; esac
  cur=$(git rev-parse --verify --quiet "$b^{commit}" || true)
  if [ "$cur" != "$sha" ]; then say "$b: 게이트 도는 동안 커밋이 바뀜 — 기록하지 않습니다"; continue; fi
  branch_need=$(gate_scope "$BASE" "$sha")
  if ! scope_covers "$BUNDLE_SCOPE" "$branch_need"; then say "$b: 필요 범위 $branch_need 를 묶음 범위 $BUNDLE_SCOPE 가 덮지 못함 — 기록하지 않습니다"; continue; fi
  record_verified "$tree" "$BUNDLE_SCOPE"
  say "$b: 통과 — 검증 완료 트리 기록 $(printf %.12s "$tree") (범위 $BUNDLE_SCOPE)"
done < "$INPUTS"
