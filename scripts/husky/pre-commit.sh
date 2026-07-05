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
# src/pages/ 서브디렉토리 = 도메인. 하드코딩하면 도메인 추가 시 드리프트되므로 동적으로 도출한다.
WEB_DOMAINS_RE=$(ls -d apps/workplace-web/src/pages/*/ 2>/dev/null | xargs -n1 basename | sort | tr '\n' '|' | sed 's/|$//')

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

# 7) Gradle — 변경분 기반 선택 실행 (타임아웃 회피). 풀 회귀는 pre-push 가 담당.
#    - 변경된 Java 에서 실행할 테스트 클래스를 도출:
#        · 테스트 파일 변경 → 그 클래스 자신(--tests "*Xxx")
#        · 메인 파일 변경   → 이름 규칙(Foo*Test/Foo*Tests/Foo*IT) 매칭 테스트를 파일시스템에서 검색
#    - 매칭 테스트 있음 → spotlessCheck + 해당 --tests 만 실행(빠른 피드백)
#    - Java/마이그/빌드 변경됐으나 매칭 테스트 없음 → spotlessCheck + compileTestJava 만(전체 test 는 pre-push 위임)
#    - api 변경 없음 → skip
#    spotlessCheck 로 Google Java Format 드리프트도 커밋 단계에서 차단(실패 시 `./gradlew :spotlessApply` 안내).

API_CHANGED=$(printf '%s\n' "$CHANGED" | grep -E '^apps/workplace-api/' || true)
if [ -z "$API_CHANGED" ]; then
  echo "[pre-commit] workplace-api 변경 없음 — gradle skip"
  exit 0
fi

JAVA_CHANGED=$(printf '%s\n' "$CHANGED" | grep -E '^apps/workplace-api/src/(main|test)/java/.*\.java$' || true)

# 변경된 Java → 실행할 테스트 --tests 패턴 누적(중복 제거)
TEST_ARGS=""
add_test() {
  case " $TEST_ARGS " in
    *" --tests \"$1\" "*) : ;;               # 이미 있음
    *) TEST_ARGS="$TEST_ARGS --tests \"$1\"" ;;
  esac
}

for f in $JAVA_CHANGED; do
  base=$(basename "$f" .java)
  case "$f" in
    apps/workplace-api/src/test/java/*)
      # 테스트 파일 변경 → 그 클래스 자신. 단 @Test 가 있는 구체 테스트일 때만(추상 베이스
      # /헬퍼는 0개 매칭 → vacuous green 위험이라 제외 → compile-only 로 떨어져 pre-push 위임).
      if grep -qE '@Test|@ParameterizedTest|@RepeatedTest|@TestFactory' "$f" 2>/dev/null; then
        add_test "*$base"
      fi
      ;;
    apps/workplace-api/src/main/java/*)
      # 메인 파일 변경 → 이름 규칙 매칭 테스트를 파일시스템에서 검색(없으면 추가 안 함 → No tests found 회피)
      while IFS= read -r tf; do
        [ -n "$tf" ] || continue
        add_test "*$(basename "$tf" .java)"
      done <<EOF
$(find apps/workplace-api/src/test/java -type f \( -name "${base}*Test.java" -o -name "${base}*Tests.java" -o -name "${base}*IT.java" \) 2>/dev/null)
EOF
      ;;
  esac
done

cd apps/workplace-api
GRADLE_BASE="-x generateJooq --build-cache --configuration-cache"
if [ -n "$TEST_ARGS" ]; then
  CMD="./gradlew spotlessCheck test$TEST_ARGS $GRADLE_BASE"
  echo "[pre-commit] 변경분 한정 gradle:$TEST_ARGS"
elif [ -n "$JAVA_CHANGED" ]; then
  CMD="./gradlew spotlessCheck compileTestJava $GRADLE_BASE"
  echo "[pre-commit] 매칭 테스트 없음(이름 규칙 밖) — compile/format 만, 전체 test 는 pre-push 위임"
else
  # Java 변경이 없으므로 spotlessCheck(자바 포맷)는 무의미 — compile 만(관련 없는 기존 드리프트로
  # 마이그/설정-only 커밋이 깨지지 않게). 전체 test 는 pre-push 위임.
  CMD="./gradlew compileTestJava $GRADLE_BASE"
  echo "[pre-commit] api 비-Java 변경(마이그/설정 등) — compile 만, 전체 test 는 pre-push 위임"
fi

if [ -n "$PRECOMMIT_DRY_RUN" ]; then
  echo "[pre-commit][dry-run] $CMD"
  exit 0
fi
eval "$CMD"
