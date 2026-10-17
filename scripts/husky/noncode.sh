#!/usr/bin/env sh
# 「비코드 변경」 판정 규칙 — pre-commit/pre-push 가 source 해 같은 규칙을 쓴다 (WP-446).
# 앱 동작과 회귀 결과를 바꾸지 않는 경로만: 문서·릴리스 노트·에이전트 작업 메모·편집기 설정.
# - Markdown 은 저장소 루트와 README/CLAUDE/AGENTS 만 비코드다. apps/·packages/·plugins/ 아래 .md 는 런타임이 읽는 것이 있어
#   (ai-agent 서브에이전트 정의 agent.md 등) 코드로 본다.
# - releases/ 는 web 이 원문 그대로 번들하지만 파싱이 관대하고(형식이 틀리면 제외) E2E 는 fixture 노트를 쓰므로, 회귀가 검증하지 않는다.

NON_CODE_RE='^(docs/|releases/|\.claude/|\.work-loop/|[^/]*\.md$|.*/(README|CLAUDE|AGENTS)\.md$|LICENSE.*|\.gitignore$|\.gitattributes$|\.vscode/|\.idea/|\.editorconfig$|\.github/(ISSUE_TEMPLATE|PULL_REQUEST_TEMPLATE))'

# code_files <파일 목록(줄 단위)> — 비코드 규칙에 걸리지 않는 파일만 출력한다(빈 출력 = 비코드만).
code_files() {
  printf '%s\n' "$1" | sed '/^$/d' | grep -vE "$NON_CODE_RE" || true
}
