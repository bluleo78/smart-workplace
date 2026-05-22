#!/usr/bin/env sh
# pre-commit gate (firehub 패턴 기반)
# - 가벼운 정합성 검사는 항상 실행 (lint-staged)
# - 무거운 회귀(E2E + gradle)는 변경 영역 분석으로 선택 실행
#   - 비코드 단독: skip
#   - workplace-web 공유 영역/매핑 모호: 전체 E2E
#   - 도메인(admin) 단독: 전역 smoke + 해당 도메인 non-smoke
#   - workplace-web 외만 변경: gradle 만
# - 풀 회귀 안전망은 .husky/pre-push 가 담당
#
# 본 스크립트는 husky 외부에서도 테스트 가능하도록 분리됨.
# 환경변수:
#   PRECOMMIT_CHANGED_FILES — git stage 대신 주입 (테스트용)
#   PRECOMMIT_DRY_RUN       — gradle/E2E 실제 실행 skip

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
fi

# 3) 비코드만? → skip
NEEDS_REGRESSION=$(printf '%s\n' "$CHANGED" | grep -vE '^(docs/|.*\.md$|LICENSE.*|\.gitignore$|\.gitattributes$|\.vscode/|\.idea/|\.editorconfig$|\.github/(ISSUE_TEMPLATE|PULL_REQUEST_TEMPLATE))' || true)
if [ -z "$NEEDS_REGRESSION" ]; then
  echo "[pre-commit] 비코드 변경만 감지 — E2E + gradle test skip"
  exit 0
fi

# 4) workplace-web 변경 영역 분석
# 현재 도메인 구조: src/pages/ 평탄 파일 + admin/ 서브디렉토리.
# 도메인 후보: admin (확장 시 여기 추가)
WEB_DOMAINS_RE='admin|projects'

# 공유 영역: components/api/lib/hooks/types/route/엔트리/설정/e2e infra
FORCE_FULL=$(printf '%s\n' "$CHANGED" | grep -E '^apps/workplace-web/(src/(components|api|lib|hooks|types|main\.tsx|App\.tsx|index\.css|router\.tsx|vite-env\.d\.ts|setupTests\.ts)|(vite|playwright|eslint|postcss|tailwind)\.config\.(ts|js|cjs|mjs)|tsconfig.*\.json|package\.json|e2e/(factories|fixtures)/|scripts/)' 2>/dev/null | head -1 || true)

WEB_PAGE_CHANGES=$(printf '%s\n' "$CHANGED" | grep -E '^apps/workplace-web/src/pages/' || true)
# 도메인 디렉토리 외 페이지(평탄 파일: LoginPage/SignupPage/HomePage 등) → 매핑 모호로 풀 E2E
NON_DOMAIN_PAGE=$(printf '%s\n' "$WEB_PAGE_CHANGES" | grep -vE "^apps/workplace-web/src/pages/($WEB_DOMAINS_RE)/" || true)

if [ -n "$FORCE_FULL" ] || [ -n "$NON_DOMAIN_PAGE" ]; then
  echo "[pre-commit] 공유 영역/매핑 외 변경 감지 — 전체 E2E 실행"
  [ -n "$PRECOMMIT_DRY_RUN" ] || (cd apps/workplace-web && pnpm test:e2e)
elif [ -n "$WEB_PAGE_CHANGES" ]; then
  # 5) 도메인 단독 변경 → 전역 smoke + 해당 도메인의 non-smoke (중복 0)
  DOMAINS_STR=$(printf '%s\n' "$WEB_PAGE_CHANGES" | sed -E 's|^apps/workplace-web/src/pages/([^/]+)/.*$|\1|' | sort -u | tr '\n' ' ')
  echo "[pre-commit] 도메인 한정 변경 감지: ${DOMAINS_STR}— 전역 smoke + 해당 도메인 non-smoke 실행"

  if [ -z "$PRECOMMIT_DRY_RUN" ]; then
    cd apps/workplace-web
    DOMAIN_SPECS=""
    for d in $DOMAINS_STR; do
      # 해당 도메인 spec 디렉토리가 있을 때만 추가 (현재는 e2e/pages 평탄)
      if [ -d "e2e/pages/$d" ]; then
        DOMAIN_SPECS="$DOMAIN_SPECS e2e/pages/$d"
      fi
    done

    # step 1: 전역 smoke
    npx playwright test --grep "@smoke"
    # step 2: 해당 도메인의 non-smoke (디렉토리가 있을 때만)
    if [ -n "$DOMAIN_SPECS" ]; then
      npx playwright test $DOMAIN_SPECS --grep-invert "@smoke"
    fi
    cd - >/dev/null
  fi
else
  # 6) workplace-web 외 변경 (api 단독 등) — gradle 단계에서 회귀 검증
  echo "[pre-commit] workplace-web 변경 없음 — E2E skip (gradle 단계에서 회귀 검증)"
fi

# 7) Gradle — 모든 코드 변경 케이스에서 실행. build-cache 로 변경 없으면 즉시 통과.
[ -n "$PRECOMMIT_DRY_RUN" ] && { echo "[pre-commit][dry-run] gradle test skip"; exit 0; }
cd apps/workplace-api && ./gradlew test -x generateJooq --build-cache --configuration-cache
