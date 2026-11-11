#!/usr/bin/env sh
# 「비코드 변경」 판정 규칙 — pre-commit/pre-push 가 source 해 같은 규칙을 쓴다 (WP-446).
# 앱 동작과 회귀 결과를 바꾸지 않는 경로만: 문서·릴리스 노트·릴리스 도구 데이터(deploy/release/abandoned-releases.json)·에이전트 작업 메모·편집기 설정.
# - Markdown 은 저장소 루트와 README/CLAUDE/AGENTS 만 비코드다. apps/·packages/·plugins/ 아래 .md 는 런타임이 읽는 것이 있어
#   (ai-agent 서브에이전트 정의 agent.md 등) 코드로 본다.
# - releases/ 는 web 이 원문 그대로 번들하지만 파싱이 관대하고(형식이 틀리면 제외) E2E 는 fixture 노트를 쓰므로, 회귀가 검증하지 않는다.
# - deploy/release/abandoned-releases.json 은 릴리스 도구(build·verify-tag·prepare)만 읽는 데이터이고 전체 회귀가 검증하지 않는다
#   (도구 테스트는 내용을 흉내 내 쓴다). 정확히 이 경로만 비코드이고 deploy/release/ 의 다른 파일은 코드다 (WP-1349).

NON_CODE_RE='^(docs/|releases/|deploy/release/abandoned-releases\.json$|\.claude/|\.work-loop/|[^/]*\.md$|.*/(README|CLAUDE|AGENTS)\.md$|LICENSE.*|\.gitignore$|\.gitattributes$|\.vscode/|\.idea/|\.editorconfig$|\.github/(ISSUE_TEMPLATE|PULL_REQUEST_TEMPLATE))'

# 웹 빌드 입력인 매뉴얼 lib 파일 — 도움말 묶음 vite 플러그인(scripts/vite-manual-help.mjs)이 import 그래프로 실제 불러오는 파일만 (WP-1504).
# 이 한 곳에서 정하고 비코드 예외(아래 CODE_IN_NONCODE_RE)와 push 게이트 web 범위(gate-scope.sh GATE_SCOPE_WEB_EXTRA_RE)가 함께 쓴다
# (gate-scope.sh 는 이 파일을 먼저 source 한다). 목록이 플러그인의 실제 import 그래프와 같은지는 scripts/vite-manual-help.test.mjs 가 대조한다
# — 플러그인이 새 lib 파일을 불러오면 그 테스트가 깨져 여기에 더하게 한다. 앵커(^·$)는 쓰는 쪽이 붙인다(gate-scope 는 다른 경로와 묶는다).
MANUAL_WEB_LIB_RE='docs/manual/scripts/lib/(books|chapters|figure|frontmatter|help-bundle|help-markup|help-vars|html|markdown)\.mjs'

# 비코드 경로 안에 있어도 코드로 보는 경로(NON_CODE_RE 보다 먼저다).
# - 웹 빌드 입력인 매뉴얼 lib(MANUAL_WEB_LIB_RE)는 앱 동작(/help/ 묶음)을 바꾼다 — push 게이트가 web 범위로 돌게 코드로 본다(gate-scope.sh).
#   lib 의 나머지(캡처·PDF·검사 도구)·lib 밖 매뉴얼 도구·장 원고(docs/manual/user·operator)·도움말 그림 PNG(docs/manual/help-figures)는
#   앱 동작과 무관해 비코드다 — 대신 pre-commit 이 비코드 판정 전에 test:manual·manual:check 를 돌려 검사한다(pre-commit.sh 2.5).
CODE_IN_NONCODE_RE="^${MANUAL_WEB_LIB_RE}\$"

# code_files <파일 목록(줄 단위)> — 비코드 규칙에 걸리지 않는 파일(또는 CODE_IN_NONCODE_RE 에 드는 파일)만 출력한다(빈 출력 = 비코드만).
# grep -E 에는 앞보기가 없어 두 번 거른다: 비코드 규칙 밖 + 비코드 규칙 안이지만 코드로 보는 경로.
code_files() {
  {
    printf '%s\n' "$1" | sed '/^$/d' | grep -vE "$NON_CODE_RE"
    printf '%s\n' "$1" | sed '/^$/d' | grep -E "$NON_CODE_RE" | grep -E "$CODE_IN_NONCODE_RE"
  } || true
}
