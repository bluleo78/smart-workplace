#!/usr/bin/env sh
# pre-push.sh 회귀 생략 판정 검증 (WP-446) — 임시 git 저장소(+ bare 원격)에 실제 커밋·태그를 만들고
# pre-push stdin 줄을 넣어 판정 결과(생략/전체 회귀)를 단언한다. PREPUSH_DRY_RUN 이라 회귀는 돌지 않는다.
# full-regression.sh 의 검증 완료 트리 기록은 FULL_REGRESSION_CMD(가짜 회귀)로 확인한다.
#
# 사용: 리포지토리 루트에서 `sh scripts/husky/pre-push.test.sh`

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

# commit_file <경로> <내용> — 파일을 쓰고 커밋한다.
commit_file() {
  mkdir -p "$(dirname "$1")"
  printf '%s\n' "$2" > "$1"
  git add -A
  git commit -qm "change $1"
}

# 판정: pre-push 를 원격 origin 으로 실행 — stdin 은 인자로 받은 줄들.
decide() {
  printf '%s\n' "$1" | PREPUSH_DRY_RUN=1 sh "$HOOKS/pre-push.sh" origin "$TMP/remote.git" 2>&1 || echo "(종료 코드 $?)"
}

# expect <설명> <stdin 줄> <기대 substring> [금지 substring]
expect() { check "$1" "$(decide "$2")" "$3" "${4:-}"; }

line() { echo "$1 $(git rev-parse "$1") $2 ${3:-$ZERO}"; }

# 기준: 코드 파일 하나가 원격 main 에 있다.
commit_file apps/web/a.ts 'a'
git push -q origin main
BASE=$(git rev-parse HEAD)

# 1) 빈 stdin — git 은 올릴 ref 가 있을 때만 훅을 부르므로 직접 실행으로 보고 전체 회귀
expect "빈 stdin(직접 실행) → 전체 회귀" "" "push 정보 없음" "회귀 생략"

# 2) 원격에 이미 있는 커밋에 붙인 태그만 push → 새 커밋 없음
git tag -a v0.1.0 -m v0.1.0
expect "이미 올라간 커밋의 태그 → 생략" "$(line refs/tags/v0.1.0 refs/tags/v0.1.0)" "새 커밋 없음" "전체 회귀 실행"

# 3) 원격 ref 삭제 줄 → 무시(생략)
expect "삭제 줄 → 생략" "(delete) $ZERO refs/heads/old $BASE" "회귀 생략" "전체 회귀 실행"

# 4) releases/ 노트만 → 비코드
commit_file releases/0.2.0.md '# 0.2.0'
expect "releases 노트만 → 생략" "$(line refs/heads/main refs/heads/main "$BASE")" "비코드 변경만" "전체 회귀 실행"

# 5) docs 와 노트가 섞인 여러 커밋 → 비코드
commit_file docs/ops/x.txt 'x'
expect "docs+노트 여러 커밋 → 생략" "$(line refs/heads/main refs/heads/main "$BASE")" "비코드 변경만"

# 5b) 한글 파일명 문서 — quotePath 로 경로가 바뀌어 코드로 오판하지 않는다
commit_file "docs/운영-가이드.md" "가이드"
expect "한글 파일명 문서 → 생략" "$(line refs/heads/main refs/heads/main "$BASE")" "비코드 변경만"

# 5c) 앱 아래 .md 는 런타임이 읽을 수 있어 코드로 본다(서브에이전트 정의 등)
git checkout -q -b md-in-app
commit_file apps/agent/agent.md "prompt"
expect "apps 아래 .md → 전체 회귀" "$(line refs/heads/md-in-app refs/heads/md-in-app)" "전체 회귀 실행"
git checkout -q main && git branch -q -D md-in-app

# 6) 코드 변경이 섞이면 → 전체 회귀
commit_file apps/web/b.ts 'b'
expect "코드 변경 → 전체 회귀" "$(line refs/heads/main refs/heads/main "$BASE")" "전체 회귀 실행" "회귀 생략"

# 7) 아직 안 올라간 코드 커밋에 붙인 태그만 push → 그 커밋을 검사(전체 회귀)
git tag -a v0.2.0 -m v0.2.0
expect "미반영 코드 커밋의 태그 → 전체 회귀" "$(line refs/tags/v0.2.0 refs/tags/v0.2.0)" "전체 회귀 실행"

# 8) 코드 파일 삭제만 → 코드 변경(삭제도 회귀 대상)
git push -q origin main
BASE=$(git rev-parse HEAD)
git rm -q apps/web/b.ts && git commit -qm "remove b"
expect "코드 파일 삭제 → 전체 회귀" "$(line refs/heads/main refs/heads/main "$BASE")" "전체 회귀 실행"
git reset -q --hard "$BASE"

# 9) 새 브랜치 — 원격에 없는 자기 커밋만 판정(main 의 기존 코드 커밋은 제외)
git checkout -q -b feat/notes
commit_file docs/n.md 'n'
expect "새 브랜치(노트만) → 생략" "$(line refs/heads/feat/notes refs/heads/feat/notes)" "feat/notes: 비코드 변경만"

# 10) 두 줄: 태그(새 커밋 없음) + 코드 브랜치 → 전체 회귀
git checkout -q main
git checkout -q -b feat/code
commit_file apps/web/c.ts 'c'
expect "태그+코드 브랜치 두 줄 → 전체 회귀" "$(line refs/tags/v0.1.0 refs/tags/v0.1.0)
$(line refs/heads/feat/code refs/heads/feat/code)" "전체 회귀 실행"

# 10b) 훅을 거치지 않고 원격 기능 브랜치에 올라간 코드 커밋 — main 으로 빨리감기해 push 하면 검사한다(원격 main 만 기준)
git checkout -q -b remote-only "$BASE"
commit_file apps/web/r.ts "r"
git push -q --no-verify origin remote-only
git checkout -q main && git reset -q --hard remote-only
expect "원격 기능 브랜치에만 있던 코드 커밋을 main 으로 → 전체 회귀" "$(line refs/heads/main refs/heads/main "$BASE")" "전체 회귀 실행"
git reset -q --hard "$BASE" && git checkout -q feat/code

# 11) 검증 완료 트리 기록: 가짜 회귀 통과 → 같은 트리 push 는 생략
out=$(FULL_REGRESSION_CMD=true sh "$HOOKS/full-regression.sh" 2>&1)
check "회귀 통과 → 트리 기록" "$out" "검증 완료 트리 기록"
expect "검증된 트리 → 생략" "$(line refs/heads/feat/code refs/heads/feat/code)" "이미 전체 회귀를 통과한 트리"

# 12) 그 브랜치를 main 에 --no-ff 머지(main 이 그대로라 트리 동일) → 생략
git checkout -q main
git merge -q --no-ff feat/code -m "merge feat/code"
expect "같은 트리의 --no-ff 머지 → 생략" "$(line refs/heads/main refs/heads/main "$BASE")" "이미 전체 회귀를 통과한 트리"
git reset -q --hard "$BASE"

# 13) main 이 앞서 나간 뒤 머지(트리가 달라짐) → 전체 회귀
commit_file apps/web/d.ts 'd'
git merge -q --no-ff feat/code -m "merge feat/code"
expect "main 이 움직인 뒤 머지(트리 다름) → 전체 회귀" "$(line refs/heads/main refs/heads/main "$BASE")" "전체 회귀 실행"
git reset -q --hard "$BASE"

# 14) 회귀 실패 → 기록하지 않음
git checkout -q feat/code
commit_file apps/web/e.ts 'e'
FULL_REGRESSION_CMD=false sh "$HOOKS/full-regression.sh" >/dev/null 2>&1 || true
expect "회귀 실패한 트리 → 전체 회귀" "$(line refs/heads/feat/code refs/heads/feat/code)" "전체 회귀 실행"

# 15) 추적 파일이 커밋과 다른 채로 통과 → 기록하지 않음
echo dirty >> apps/web/e.ts
out=$(FULL_REGRESSION_CMD=true sh "$HOOKS/full-regression.sh" 2>&1)
check "작업 트리가 커밋과 다르면 기록 안 함" "$out" "기록하지 않음"
git checkout -q -- apps/web/e.ts
expect "더러운 트리로 통과한 커밋 → 전체 회귀" "$(line refs/heads/feat/code refs/heads/feat/code)" "전체 회귀 실행"

# 16) 커밋하지 않은 코드 파일이 있는 채 통과(빠뜨린 git add) → 기록하지 않음
echo "x" > apps/web/untracked.ts
out=$(FULL_REGRESSION_CMD=true sh "$HOOKS/full-regression.sh" 2>&1)
check "추적 안 된 코드 파일 있으면 기록 안 함" "$out" "기록하지 않음"
rm apps/web/untracked.ts

# 17) 테스트용 가짜 회귀를 공유 기록 경로로 쓰면 거부
out=$(env -u PREPUSH_VERIFIED_FILE FULL_REGRESSION_CMD=true sh "$HOOKS/full-regression.sh" 2>&1 || true)
check "FULL_REGRESSION_CMD 단독 사용 거부" "$out" "테스트 전용"

finish
