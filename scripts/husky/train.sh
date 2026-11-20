#!/usr/bin/env sh
# 기차(개발자 통합 브랜치) (WP-1216) — 한 AI 가 끝낸 이슈들을 통합 브랜치 `integ/<AI 이름>-<번호>` 에 이슈당 커밋 하나로 쌓아,
# push 게이트를 기차마다 한 번 돌리고 PR 하나로 올린다. 게이트 락이 저장소마다 하나라 이슈마다 게이트를 띄우면 줄이 길어지고,
# 묶음 게이트(WP-1208)처럼 합쳐 돌린 뒤 PR 을 이슈마다 내면 A+B 로 통과한 뒤 B 가 반려될 때 A 혼자의 트리가 검증 없이 머지됐다.
# 기차는 돌린 트리 그대로를 PR 로 올리므로 그 틈이 없다.
#
# 사용(저장소의 아무 워크트리 안에서):
#   sh scripts/husky/train.sh stack <AI 이름> <feature 브랜치> <이슈 키>  — 다음 기차에 그 브랜치를 커밋 하나로 쌓는다(없으면 만든다)
#   sh scripts/husky/train.sh rebase <기차 브랜치>                         — 출발 전이면 최신 origin/main 으로, 출발했으면 충돌할 때만
#   sh scripts/husky/train.sh next <AI 이름>                               — 아직 출발하지 않은 기차 이름(없으면 빈 출력)
#   sh scripts/husky/train.sh depart <기차 브랜치>                         — 게이트를 띄우기 전에 출발 표시(이 뒤 쌓는 이슈는 다음 기차로)
#   sh scripts/husky/train.sh keys <기차 브랜치>                           — 실린 이슈 키를 쌓은 순서로 「K1·K2」(PR 제목 `통합 K1·K2`)
#   sh scripts/husky/train.sh check <기차 브랜치>                          — 실린 이슈마다 절차 검사(procedure-check). 하나라도 실패하면 1(출발 전 게이트를 띄우지 않는다)
#
# - 「출발」 = 기차 브랜치를 origin 에 push 했거나(origin/<기차> 가 있거나, 머지 뒤 원격이 지워져도 push -u 가 남긴 upstream 설정이 있음)
#   depart 로 표지(branch.<기차>.trainDeparted, 기차를 git branch -D 로 지우면 함께 지워짐)를 남긴 것. 게이트는 push 전에 돌아 오래 걸리므로
#   그 사이 끝난 이슈가 게이트가 보지 않은 트리로 나가지 않게 게이트 전에 표지를 남긴다(WP-1839). 출발한 기차에는 새 이슈를 쌓지 않는다 —
#   다음 번호로 새 기차를 만든다. 표지가 서면 rebase 는 충돌 때만 하므로 depart 는 최신 origin/main 위인지·앞 기차가 머지됐는지 먼저 본다.
# - 기차마다 워크트리 MAIN/.claude/worktrees/integ-<AI 이름>-<번호> 를 둔다. 게이트·수정 커밋·push 는 그 안에서 한다.
# - 쌓기는 feature 의 마지막 커밋 메시지(제목 끝 `(<이슈 키>)`)와 작성자를 그대로 쓰고, 끝에 `Stacked-From: <feature 커밋 SHA>` 트레일러를 단다
#   (끝난 이슈 정리 worktree-sweep 이 feature 커밋이 들어갔는지 가리는 데 쓴다 — WP-1643). 쌓는 커밋은 커밋 훅을 다시 돌지 않는다 —
#   같은 변경을 feature 커밋 때 훅이 이미 봤고, 쌓은 결과 전체는 출발 때 push 게이트가 본다.
# - 마이그레이션 번호가 origin/main·앞서 쌓은 이슈와 겹치면 쌓지 않고 멈춘다(번호를 feature 에서 옮긴 뒤 다시 쌓는다).
# - 쌓기 전·출발 전에 이슈별 절차 검사(plugins/genia-works/scripts/procedure-check, WP-1836)를 돌린다. 쌓을 때·check 때 TRAIN_NO_PROCEDURE_CHECK=1 이면 건너뛴다.
# git 은 origin 에서 한 번 fetch 한다(TRAIN_NO_FETCH=1 이면 건너뜀). 커밋 신원은 호출한 환경의 것을 쓴다(rebase 가 committer 를 쓴다).

set -e

HOOK_DIR=$(cd "$(dirname "$0")" && pwd)
# 이슈 절차 검사 스크립트(WP-1836) — notes 의 절차 줄·계획 파일·원장을 기계로 확인한다.
PROC_CHECK="$HOOK_DIR/../../plugins/genia-works/scripts/procedure-check"
BASE=refs/remotes/origin/main

# 커밋 신원이 없는 환경(AI 에이전트 서버)에서도 쌓고 rebase 한다(WP-1213 과 같은 이유) — committer 만 고정값으로 채운다.
# 작성자는 쌓을 때 feature 의 것을 그대로 쓰고, rebase 는 원래 작성자를 지킨다.
if ! git var GIT_COMMITTER_IDENT >/dev/null 2>&1; then
  export GIT_COMMITTER_NAME=train GIT_COMMITTER_EMAIL=train@localhost
fi

say() { echo "[train] $*"; }
die() { echo "[train] $*" >&2; exit "${2:-1}"; }

usage() {
  cat >&2 <<'EOF'
사용: sh scripts/husky/train.sh stack <AI 이름> <feature 브랜치> <이슈 키>
      sh scripts/husky/train.sh rebase <기차 브랜치>
      sh scripts/husky/train.sh next <AI 이름>
      sh scripts/husky/train.sh keys <기차 브랜치>
      sh scripts/husky/train.sh check <기차 브랜치>
      sh scripts/husky/train.sh depart <기차 브랜치>
EOF
  exit 2
}

COMMON=$(cd "$(git rev-parse --git-common-dir)" && pwd)
MAIN_DIR=$(dirname "$COMMON")

fetch() {
  [ "${TRAIN_NO_FETCH:-}" = 1 ] && return 0
  git fetch --quiet origin || say "origin fetch 실패 — 가진 원격 정보로 판정합니다"
}

check_name() {
  # 이름이 정규식(train_numbers)에 들어가므로 . 같은 메타 문자는 받지 않는다.
  case "$1" in ''|*[!A-Za-z0-9_-]*) die "AI 이름은 영문·숫자·_·- 만: '$1'" 2 ;; esac
}

# 기차 번호들(로컬·origin) — integ/<이름>-<번호> 의 번호만 한 줄씩.
train_numbers() {
  git for-each-ref --format='%(refname)' "refs/heads/integ/" "refs/remotes/origin/integ/" |
    sed -e 's#^refs/heads/##' -e 's#^refs/remotes/origin/##' |
    sed -n "s#^integ/$1-\([0-9][0-9]*\)\$#\1#p" | sort -n -u
}

# origin 에 올렸는지 — origin/<기차> 가 있거나, 원격 브랜치가 머지 뒤 지워지고 prune 돼도 push -u 가 남긴 upstream 설정이 있다.
pushed() {
  git rev-parse --verify --quiet "refs/remotes/origin/$1" >/dev/null ||
    [ "$(git config --get "branch.$1.merge")" = "refs/heads/$1" ]
}

# 출발 = push 했거나 depart 표지(맨 위 「출발」 설명 참고).
departed() {
  pushed "$1" || [ "$(git config --get "branch.$1.trainDeparted")" = true ]
}

worktree_of() { echo "$MAIN_DIR/.claude/worktrees/$(echo "$1" | tr '/' '-')"; }

# 아직 출발하지 않은 로컬 기차 중 가장 낮은 번호(출발 정의는 맨 위 설명).
next_train() {
  for n in $(train_numbers "$1"); do
    b="integ/$1-$n"
    git rev-parse --verify --quiet "refs/heads/$b" >/dev/null || continue
    departed "$b" || { echo "$b"; return 0; }
  done
}

# 기차 워크트리 — 없으면 만든다(브랜치가 없으면 origin/main 에서). 커밋 안 한 변경이 있으면 멈춘다.
ensure_worktree() {
  b=$1; wt=$(worktree_of "$b")
  if [ ! -d "$wt" ]; then
    if git rev-parse --verify --quiet "refs/heads/$b" >/dev/null; then
      git worktree add --quiet "$wt" "$b"
    else
      git worktree add --quiet --no-track -b "$b" "$wt" "$BASE"
    fi
  fi
  [ -z "$(git -C "$wt" status --porcelain)" ] || die "$b 워크트리에 커밋 안 한 변경이 있습니다: $wt"
  echo "$wt"
}

# 마이그레이션 번호 — 1(겹침)이면 실패, 2(읽지 못함)는 알리고 넘어간다.
migrations_ok() {
  rc=0
  (cd "$1" && node "$HOOK_DIR/../check-migration-versions.mjs" "$BASE" "$2") || rc=$?
  [ "$rc" -ne 1 ] || return 1
  [ "$rc" -eq 0 ] || say "마이그레이션 번호를 확인하지 못함(종료 코드 $rc) — 넘어갑니다"
  return 0
}

# 사람 세션 우회(TRAIN_NO_PROCEDURE_CHECK=1) — 쌓기·check 가 같은 규칙으로 건너뛰게 한 곳에 둔다. 건너뛰면 알리고 0.
proc_check_skipped() {
  [ "${TRAIN_NO_PROCEDURE_CHECK:-}" = 1 ] || return 1
  say "절차 검사를 건너뜁니다(TRAIN_NO_PROCEDURE_CHECK=1)"
}

# origin/main 이 있어야 한다(없으면 종료 코드 2). stack·rebase·depart 가 같이 쓴다.
require_base() {
  git rev-parse --verify --quiet "$BASE" >/dev/null || die "origin/main 이 없습니다 — git fetch origin 뒤 다시" 2
}

# 기차 브랜치 검증 — integ/* 이고 로컬에 있어야 한다(아니면 종료 코드 2). rebase·depart 가 같이 쓴다.
require_train() {
  case "$1" in integ/*) : ;; *) die "기차 브랜치(integ/…)가 아닙니다: $1" 2 ;; esac
  git rev-parse --verify --quiet "refs/heads/$1" >/dev/null || die "기차 브랜치가 없습니다: $1" 2
}

cmd_stack() {
  [ $# -eq 3 ] || usage
  name=$1; feature=$2; key=$3
  check_name "$name"
  echo "$key" | grep -Eq '^[A-Z][A-Z0-9]*-[0-9]+$' || die "이슈 키 형식이 아닙니다: '$key'" 2
  # 절차를 안 지킨 이슈는 기차를 만들기 전에 막는다(WP-1836). 검사 종료 코드 2(사용법·notes 없음)는 그대로 2, 그 밖의 실패는 1.
  if ! proc_check_skipped; then
    prc=0
    sh "$PROC_CHECK" "$key" || prc=$?
    if [ "$prc" -ne 0 ]; then
      [ "$prc" -eq 2 ] || prc=1
      die "$key: 절차 검사 실패 — 쌓지 않습니다(process-issue.md 5번부터 다시)" "$prc"
    fi
  fi
  fetch
  require_base
  fsha=$(git rev-parse --verify --quiet "$feature^{commit}") || die "커밋을 찾을 수 없음: $feature" 2
  subject=$(git log -1 --format=%s "$fsha")
  case "$subject" in *"($key)") : ;; *) die "$feature 의 마지막 커밋 제목 끝에 ($key) 가 없습니다 — 「$subject」(커밋 하나로 합친 뒤 쌓습니다)" ;; esac

  train=$(next_train "$name")
  if [ -z "$train" ]; then
    last=$(train_numbers "$name" | tail -n 1)
    train="integ/$name-$(( ${last:-0} + 1 ))"
    say "새 기차 $train 을 origin/main 에서 만듭니다"
  fi
  wt=$(ensure_worktree "$train")
  # 출발 전 기차는 최신 origin/main 위에서 쌓는다 — 더 새 main 에서 딴 feature 를 낡은 기차에 합치면 그 사이 main 변경이 이 이슈의 커밋에 섞인다.
  TRAIN_NO_FETCH=1 cmd_rebase "$train" >/dev/null || die "$train 을 최신 origin/main 으로 옮기지 못해 쌓지 않습니다 — sh scripts/husky/train.sh rebase $train 로 확인하세요"
  if git -C "$wt" log --format=%s "$BASE..HEAD" | grep -Fq "($key)"; then
    die "$key 는 이미 $train 에 실려 있습니다 — 고친 것은 기차 워크트리에서 제목 끝에 ($key) 를 단 수정 커밋으로 더합니다"
  fi

  # 합치기 판정은 묶음 게이트(WP-1208)와 같다 — 풀지 못한 파일이 남으면 충돌, origin/main 과 바로 충돌하는지로 이유를 가른다.
  if ! git -C "$wt" merge --squash --quiet "$fsha" >/dev/null 2>&1; then
    unmerged=$(git -C "$wt" diff --name-only --diff-filter=U 2>/dev/null || true)
    git -C "$wt" reset --hard --quiet HEAD
    [ -n "$unmerged" ] || die "$feature: 합치지 못함(충돌 아님) — git merge --squash 를 기차 워크트리에서 직접 보세요: $wt"
    if ! git merge-tree --write-tree "$BASE" "$fsha" >/dev/null 2>&1; then
      die "$feature: origin/main 과 충돌 — feature 를 rebase 해 푼 뒤 다시 쌓습니다(파일: $(echo $unmerged))"
    fi
    die "$feature: 앞서 실린 이슈와 충돌 — 다음 기차로 미루거나 feature 에서 풀어 다시 쌓습니다(파일: $(echo $unmerged))"
  fi
  if git -C "$wt" diff --cached --quiet; then
    git -C "$wt" reset --hard --quiet HEAD
    die "$feature: 기차에 더할 변경이 없습니다(이미 들어 있음)"
  fi

  # 커밋 하나 — feature 의 메시지·작성자를 그대로(쌓는 사람은 committer). 번호가 겹치면 브랜치를 옮기지 않고 되돌린다.
  tree=$(git -C "$wt" write-tree)
  msg=$(mktemp); git log -1 --format=%B "$fsha" > "$msg"
  # 옮긴 커밋에 원래 feature 끝 커밋 SHA(40자)를 트레일러로 남긴다 — 끝난 이슈 정리(worktree-sweep ws_unpushed)가 patch 가 바뀐
  # feature 커밋이 들어갔는지 이 SHA 로 정확히 가린다(그 앞 커밋도 함께 들어간 것으로 본다). 작성자 정보만으로는 쌓은 뒤 amend 한
  # feature 커밋(작성자 정보 그대로·SHA 다름)을 들어간 것으로 잘못 봐 고친 내용을 잃는다 — 그래서 정리는 트레일러가 있는 main
  # 커밋을 작성자 정보로 견주지 않는다(WP-1643).
  git interpret-trailers --in-place --trailer "Stacked-From: $fsha" "$msg" || {
    rm -f "$msg"; git -C "$wt" reset --hard --quiet HEAD; die "Stacked-From 트레일러를 달지 못했습니다"
  }
  commit=$(GIT_AUTHOR_NAME=$(git log -1 --format=%an "$fsha") GIT_AUTHOR_EMAIL=$(git log -1 --format=%ae "$fsha") \
    GIT_AUTHOR_DATE=$(git log -1 --format=%aI "$fsha") git -C "$wt" commit-tree "$tree" -p HEAD -F "$msg") || {
    rm -f "$msg"; git -C "$wt" reset --hard --quiet HEAD; die "커밋을 만들지 못했습니다(커밋 신원 확인)"
  }
  rm -f "$msg"
  if ! migrations_ok "$wt" "$commit"; then
    git -C "$wt" reset --hard --quiet HEAD
    die "마이그레이션 번호가 겹칩니다 — $feature 에서 번호를 옮긴 뒤 다시 쌓습니다"
  fi
  git -C "$wt" reset --hard --quiet "$commit"
  say "$key → $train 에 쌓음 $(printf %.9s "$commit") 「$subject」"
  say "기차 워크트리: $wt"
}

cmd_rebase() {
  [ $# -eq 1 ] || usage
  train=$1
  require_train "$train"
  fetch
  require_base
  wt=$(ensure_worktree "$train")
  if git -C "$wt" merge-base --is-ancestor "$BASE" HEAD; then
    say "$train: 이미 최신 origin/main 위입니다"; return 0
  fi
  # 출발한 기차는 충돌할 때만 — rebase 하면 트리가 바뀌어 게이트를 다시 돌아야 한다(WP-998).
  if departed "$train" && git merge-tree --write-tree "$BASE" "$train" >/dev/null 2>&1; then
    # 줄 충돌이 없어도 그 사이 main 이 같은 마이그레이션 번호를 더했으면 함께 들어가 Flyway 가 깨진다 — 번호는 따로 본다.
    migrations_ok "$wt" HEAD || die "$train: origin/main 과 마이그레이션 번호가 겹칩니다 — 그 이슈의 번호를 옮기는 수정 커밋을 더합니다"
    say "$train: 출발한 기차 — origin/main 과 충돌하지 않아 rebase 하지 않습니다"; return 0
  fi
  log=$(mktemp)
  if ! git -C "$wt" rebase --quiet "$BASE" >"$log" 2>&1; then
    stopped=$(git -C "$wt" log -1 --format=%s REBASE_HEAD 2>/dev/null || true)
    unmerged=$(git -C "$wt" diff --name-only --diff-filter=U 2>/dev/null || true)
    git -C "$wt" rebase --abort >/dev/null 2>&1 || true
    if [ -z "$unmerged" ]; then
      # 충돌이 아닌 실패(신원·훅·잠금 등)는 충돌로 알리지 않고 git 이 낸 이유를 보인다.
      reason=$(grep -v '^[[:space:]]*$' "$log" | tail -n 3 | tr '\n' ' '); rm -f "$log"
      die "$train: rebase 하지 못함(충돌 아님) — git: $reason"
    fi
    rm -f "$log"
    die "$train: rebase 중 충돌 — 「$stopped」($(echo $unmerged)) — 기차 워크트리에서 git rebase origin/main 으로 풀어 주세요: $wt"
  fi
  rm -f "$log"
  migrations_ok "$wt" HEAD || die "$train: rebase 뒤 마이그레이션 번호가 origin/main 과 겹칩니다 — 그 이슈의 번호를 옮기는 수정 커밋을 더합니다"
  if departed "$train"; then
    # 올라간 기차는 force-with-lease, 표지만 있고 push 전이면 처음 올리는 push -u.
    if pushed "$train"; then push_cmd="git push --force-with-lease"; else push_cmd="git push -u origin $train"; fi
    say "$train: rebase 했습니다 — 게이트(pnpm test:full)를 다시 돈 뒤 $push_cmd 합니다"
  else
    say "$train: 최신 origin/main 으로 rebase 했습니다"
  fi
}

cmd_next() {
  [ $# -eq 1 ] || usage
  check_name "$1"
  fetch
  next_train "$1"
}

cmd_keys() {
  [ $# -eq 1 ] || usage
  git rev-parse --verify --quiet "$1^{commit}" >/dev/null || die "커밋을 찾을 수 없음: $1" 2
  git log --reverse --format=%s "$BASE..$1" |
    sed -n 's/.*(\([A-Z][A-Z0-9]*-[0-9][0-9]*\))$/\1/p' |
    awk '!seen[$0]++ { out = out (out == "" ? "" : "·") $0 } END { if (out != "") print out }'
}

# 기차에 실린 이슈마다 절차 검사 — 출력은 그대로 보이고, 하나라도 실패하면 1 (출발 전 push 게이트를 띄우지 않기 위한 관문).
cmd_check() {
  [ $# -eq 1 ] || usage
  keys=$(cmd_keys "$1") || exit $?
  [ -n "$keys" ] || die "실린 이슈가 없습니다" 2
  proc_check_skipped && return 0
  failed=0
  for k in $(echo "$keys" | tr '·' ' '); do
    sh "$PROC_CHECK" "$k" || failed=1
  done
  [ "$failed" -eq 0 ] || die "절차 검사 실패 — 게이트를 띄우지 않습니다"
}

# 출발 표시 — 게이트를 띄우기 전에 부른다(왜 표지가 필요한지는 맨 위 「출발」). 표지가 서기 전에 최신 origin/main 위인지,
# 앞 번호 기차가 main 에 들어갔는지 확인한다(process-issue.md 「기차」 3번).
cmd_depart() {
  [ $# -eq 1 ] || usage
  train=$1
  require_train "$train"
  fetch
  require_base
  if ! departed "$train"; then
    git merge-base --is-ancestor "$BASE" "$train" ||
      die "$train: 최신 origin/main 위가 아닙니다 — 먼저 sh scripts/husky/train.sh rebase $train 뒤 depart 합니다"
    # 앞 번호 기차(로컬·origin)가 아직 main 에 없으면 출발하지 않는다.
    rest=${train#integ/}
    name=${rest%-*}
    num=${rest##*-}
    for n in $(train_numbers "$name"); do
      [ "$n" -lt "$num" ] || continue
      for ref in "refs/heads/integ/$name-$n" "refs/remotes/origin/integ/$name-$n"; do
        git rev-parse --verify --quiet "$ref" >/dev/null || continue
        git merge-base --is-ancestor "$ref" "$BASE" ||
          die "$train: 앞 기차 integ/$name-$n 이 아직 main 에 들어가지 않아 출발하지 않습니다"
      done
    done
    # 빈 기차는 출발시키지 않는다 — 표지만 남으면 아무것도 싣지 못한 채 번호만 소모된다.
    [ "$(git rev-list --count "$BASE..$train")" -gt 0 ] || die "$train: 실린 이슈가 없어 출발하지 않습니다"
    git config "branch.$train.trainDeparted" true
  fi
  say "$train: 출발 표시 — 이제 쌓는 이슈는 다음 기차로 갑니다"
}

[ $# -ge 1 ] || usage
cmd=$1; shift
case "$cmd" in
  stack) cmd_stack "$@" ;;
  rebase) cmd_rebase "$@" ;;
  next) cmd_next "$@" ;;
  keys) cmd_keys "$@" ;;
  check) cmd_check "$@" ;;
  depart) cmd_depart "$@" ;;
  *) usage ;;
esac
