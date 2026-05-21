#!/usr/bin/env sh
# pre-commit gate
# - 가벼운 정합성 검사 (lint-staged, typecheck) 는 항상 실행
# - 무거운 회귀는 .husky/pre-push 에서 실행
#
# 본 스크립트는 husky 외부에서도 테스트 가능하도록 분리.
# 환경변수 PRECOMMIT_CHANGED_FILES 로 변경 파일 목록을 주입 가능.

set -e

# 1) 변경 파일 목록 (테스트용 주입 우선, 없으면 git stage 에서 추출)
if [ -n "$PRECOMMIT_CHANGED_FILES" ]; then
  CHANGED="$PRECOMMIT_CHANGED_FILES"
else
  CHANGED=$(git diff --cached --name-only --diff-filter=ACMR)
fi

# 2) lint-staged 는 항상 (테스트 주입 모드면 skip — 실제 stage 가 없어 의미 없음)
if [ -z "$PRECOMMIT_CHANGED_FILES" ]; then
  pnpm exec lint-staged
  # apps 추가 시 typecheck 활성화
  # pnpm typecheck
fi

# 3) 변경 영역 기반 분기는 apps 가 생긴 뒤 추가 예정
#    - apps/workplace-web 단독 → smoke E2E
#    - apps/workplace-api 단독 → gradle test
#    - 공유 영역 → 전체
