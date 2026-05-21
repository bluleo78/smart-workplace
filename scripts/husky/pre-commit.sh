#!/usr/bin/env sh
# pre-commit gate (firehub 패턴 기반)
# - 가벼운 정합성 검사는 항상 (lint-staged)
# - 변경 파일 비코드 단독이면 회귀 skip
# - 그 외에는 gradle test (build-cache 로 변경 없으면 즉시 통과)
# - 풀 회귀 안전망은 .husky/pre-push
#
# 본 스크립트는 husky 외부에서도 테스트 가능하도록 분리.
# 환경변수:
#   PRECOMMIT_CHANGED_FILES — git stage 대신 주입 (테스트용)
#   PRECOMMIT_DRY_RUN       — gradle/E2E 실제 실행 skip

set -e

# 1) 변경 파일 목록
if [ -n "$PRECOMMIT_CHANGED_FILES" ]; then
  CHANGED="$PRECOMMIT_CHANGED_FILES"
else
  CHANGED=$(git diff --cached --name-only --diff-filter=ACMR)
fi

# 2) lint-staged 는 항상 (테스트 주입 모드면 skip — 실제 stage 가 없어 의미 없음)
if [ -z "$PRECOMMIT_CHANGED_FILES" ]; then
  pnpm exec lint-staged
fi

# 3) 비코드 단독 변경? → 회귀 skip
NEEDS_REGRESSION=$(printf '%s\n' "$CHANGED" | grep -vE '^(docs/|.*\.md$|LICENSE.*|\.gitignore$|\.gitattributes$|\.vscode/|\.idea/|\.editorconfig$|\.github/(ISSUE_TEMPLATE|PULL_REQUEST_TEMPLATE))' || true)
if [ -z "$NEEDS_REGRESSION" ]; then
  echo "[pre-commit] 비코드 변경만 감지 — gradle test skip"
  exit 0
fi

# 4) Gradle test — build-cache 로 변경 없으면 즉시 통과
[ -n "$PRECOMMIT_DRY_RUN" ] && { echo "[pre-commit][dry-run] gradle test skip"; exit 0; }
cd apps/workplace-api && ./gradlew test -x generateJooq --build-cache --configuration-cache

# TODO: workplace-web 추가 시 firehub 패턴 도입
#  - 변경 영역(공유/도메인) 분석 → 전체 E2E vs 도메인 한정 smoke
