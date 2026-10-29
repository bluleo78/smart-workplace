#!/usr/bin/env sh
# push 게이트 범위 검증 (WP-1208) — 임시 git 저장소(+ bare 원격)에 실제 브랜치를 만들어
#   1) 범위 판정(gate-scope.sh), 2) 범위와 함께 남는 검증 기록과 옛 형식 호환(verified-trees.sh),
#   3) pre-push 가 필요한 범위를 덮는 기록만 인정하는지를 단언한다(묶음 게이트는 기차로 바뀌었다 — train.test.sh, WP-1216).
# 회귀는 FULL_REGRESSION_CMD(가짜 회귀)로 대신한다 — 고른 범위는 GATE_SCOPE 로 넘어온다.
#
# 사용: 리포지토리 루트에서 `sh scripts/husky/gate-scope.test.sh`

set -e
HOOKS="$(cd "$(dirname "$0")" && pwd)"
. "$HOOKS/test-helpers.sh"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
export PREPUSH_VERIFIED_FILE="$TMP/verified"
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
ZERO=0000000000000000000000000000000000000000

git init -q --bare "$TMP/remote.git"
git init -q -b main "$TMP/work"
cd "$TMP/work"
git remote add origin "$TMP/remote.git"
printf '.claude/worktrees/\n' > .git/info/exclude

. "$HOOKS/noncode.sh"
. "$HOOKS/gate-scope.sh"
. "$HOOKS/verified-trees.sh"

# commit_file <경로> <내용> — 파일을 쓰고 커밋한다.
commit_file() {
  mkdir -p "$(dirname "$1")"
  printf '%s\n' "$2" > "$1"
  git add -A
  git commit -qm "change $1"
}

# branch_with <브랜치> <경로>... — main 에서 브랜치를 만들어 경로마다 커밋하고 main 으로 돌아온다.
branch_with() {
  b=$1; shift
  git checkout -q -b "$b" main
  for f in "$@"; do commit_file "$f" "$b"; done
  git checkout -q main
}

decide() {
  printf '%s\n' "$1" | PREPUSH_DRY_RUN=1 sh "$HOOKS/pre-push.sh" origin "$TMP/remote.git" 2>&1 || echo "(종료 코드 $?)"
}
line() { echo "refs/heads/$1 $(git rev-parse "$1") refs/heads/$1 $ZERO"; }
tree_of() { git rev-parse "$1^{tree}"; }

commit_file apps/workplace-web/src/a.ts 'a'
commit_file apps/workplace-admin/src/a.ts 'a'
commit_file apps/workplace-api/src/A.java 'a'
git push -q origin main
git fetch -q origin

# ---- 1) 범위 판정 ----
branch_with s-web apps/workplace-web/src/b.ts apps/workplace-web/README.md docs/x.md
branch_with s-admin apps/workplace-admin/src/b.ts
branch_with s-both apps/workplace-web/src/c.ts apps/workplace-admin/src/c.ts
branch_with s-api apps/workplace-web/src/d.ts apps/workplace-api/src/B.java
branch_with s-pkg packages/shared/x.ts
branch_with s-lock pnpm-lock.yaml
branch_with s-docs docs/only.md
branch_with s-contract apps/workplace-web/src/lib/resource-contract.json
check "web 코드만(+문서) → web" "$(gate_scope origin/main s-web)" "web" "full"
check "admin 만 → admin" "$(gate_scope origin/main s-admin)" "admin"
check "web+admin → web+admin" "$(gate_scope origin/main s-both)" "web+admin"
check "api 가 섞이면 → full" "$(gate_scope origin/main s-api)" "full"
check "공유 패키지 → full" "$(gate_scope origin/main s-pkg)" "full"
check "lockfile → full" "$(gate_scope origin/main s-lock)" "full"
check "코드 변경 없음(판정 불가) → full" "$(gate_scope origin/main s-docs)" "full"
check "api 테스트가 읽는 web 파일(resource-contract.json) → full" "$(gate_scope origin/main s-contract)" "full"
# main 이 앞서 나가도(api 변경) 브랜치가 바꾼 것만 센다
git checkout -q main; commit_file apps/workplace-api/src/C.java 'main moved'; git push -q origin main; git fetch -q origin
check "main 이 api 로 앞서 나가도 브랜치 기준 → web" "$(gate_scope origin/main s-web)" "web" "full"

check "full 은 web 을 덮음" "$(scope_covers full web && echo yes || echo no)" "yes"
check "web 은 full 을 못 덮음" "$(scope_covers web full && echo yes || echo no)" "no"
check "web+admin 은 admin 을 덮음" "$(scope_covers web+admin admin && echo yes || echo no)" "yes"
check "web 은 web+admin 을 못 덮음" "$(scope_covers web web+admin && echo yes || echo no)" "no"
check "합: web·admin → web+admin" "$(scope_union web admin)" "web+admin"
check "합: web·full → full" "$(scope_union web full)" "full"
need=web+admin; scope_covers web+admin admin; scope_union web admin >/dev/null; is_verified zzzz web >/dev/null || true
check "판정 함수가 호출하는 쪽 변수(need)를 덮지 않음" "$need" "web+admin"

# ---- 2) 기록 형식 ----
record_verified aaaa web
check "범위 기록은 두 칸" "$(cat "$PREPUSH_VERIFIED_FILE")" "aaaa web"
check "범위 기록은 옛 형식(grep -qx) 으로 전체 통과로 읽히지 않음" "$(grep -qx aaaa "$PREPUSH_VERIFIED_FILE" && echo matched || echo no)" "no"
record_verified aaaa
check "같은 트리를 전체로 다시 기록하면 한 줄(트리만)" "$(grep -c aaaa "$PREPUSH_VERIFIED_FILE"):$(grep -x aaaa "$PREPUSH_VERIFIED_FILE")" "1:aaaa"
record_verified aaaa web
check "전체 기록을 좁은 범위로 덮지 않음" "$(verified_scope aaaa)" "full"
echo bbbb >> "$PREPUSH_VERIFIED_FILE"
check "옛 형식 줄(트리만)은 전체 통과" "$(is_verified bbbb && echo yes || echo no)" "yes"
check "범위 생략한 is_verified 는 full 을 요구" "$(record_verified cccc admin; is_verified cccc && echo yes || echo no)" "no"
record_verified dddd web; record_verified dddd admin
check "따로 통과한 범위는 합쳐 기록(web → admin = web+admin)" "$(verified_scope dddd)" "web+admin"

# ---- 3) full-regression 범위 → pre-push 인정 ----
git checkout -q s-web
out=$(FULL_REGRESSION_CMD='echo "scope=$GATE_SCOPE"' sh "$HOOKS/full-regression.sh" 2>&1)
check "web 브랜치 게이트는 web 범위로 돌고 기록" "$out" "scope=web" "scope=full"
check "web 범위 단계 안내" "$out" "admin E2E·gradle 건너뜀"
check "is_verified_head 가 범위를 스스로 구해 인정" "$(is_verified_head && echo yes || echo no)" "yes"
git checkout -q main
check "web 범위로 통과한 트리 push → 생략" "$(decide "$(line s-web)")" "회귀 생략" "전체 회귀 실행"
# 같은 트리라도 필요한 범위가 넓으면(원격 main 이 그 web 파일을 이미 갖고 있지 않은 다른 브랜치로 api 를 바꿈) 인정하지 않는다
git checkout -q -b s-web-api s-web; commit_file apps/workplace-api/src/D.java 'x'; git checkout -q main
out=$(cd "$TMP/work" && git checkout -q s-web-api && FULL_REGRESSION_CMD=true FULL_REGRESSION_SCOPE=web sh "$HOOKS/full-regression.sh" 2>&1; git checkout -q main)
check "api 를 바꾼 트리를 web 범위로 강제 기록해도 push 는 전체 회귀" "$(decide "$(line s-web-api)")" "전체 회귀 실행" "회귀 생략"

git checkout -q s-api
out=$(FULL_REGRESSION_CMD='echo "scope=$GATE_SCOPE"' sh "$HOOKS/full-regression.sh" 2>&1)
check "api 를 바꾼 브랜치는 전체로 돈다" "$out" "scope=full"
git checkout -q main
check "전체로 통과한 api 브랜치 push → 생략" "$(decide "$(line s-api)")" "회귀 생략"
check "전체 통과 기록은 트리만(옛 형식)" "$(grep -cx "$(tree_of s-api)" "$PREPUSH_VERIFIED_FILE")" "1"

out=$(FULL_REGRESSION_CMD=true FULL_REGRESSION_SCOPE=nope sh "$HOOKS/full-regression.sh" 2>&1 || true)
check "알 수 없는 범위 거부" "$out" "알 수 없는 범위"

# pre-push 가 전체 회귀로 넘길 때 범위: HEAD 를 push 하면 그 범위, HEAD 가 아닌 ref 면 전체(회귀는 HEAD 를 검사하므로)
branch_with p-web apps/workplace-web/src/p.ts
branch_with p-api apps/workplace-api/src/P.java
git checkout -q p-web
check "HEAD(web) push → web 범위로 회귀" "$(decide "$(line p-web)")" "범위 web"
check "HEAD 가 web 인데 api 브랜치를 push → 전체로 회귀" "$(decide "$(line p-api)")" "범위 full"
git checkout -q -b p-web-api p-web; commit_file apps/workplace-api/src/Q.java 'q'
check "HEAD(api 포함) push → 전체로 회귀" "$(decide "$(line p-web-api)")" "범위 full"
git checkout -q main

finish
