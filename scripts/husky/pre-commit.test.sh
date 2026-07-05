#!/usr/bin/env sh
# pre-commit.sh 변경분 기반 gradle 선택 로직 검증.
# PRECOMMIT_CHANGED_FILES(변경 파일 주입) + PRECOMMIT_DRY_RUN(실제 gradle/E2E skip, 도출 명령만 출력)
# 으로 케이스별 --tests 도출 결과를 단언한다. 실제 gradle 은 돌리지 않으므로 빠르다.
#
# 사용: 리포지토리 루트에서 `sh scripts/husky/pre-commit.test.sh`

set -e
cd "$(dirname "$0")/../.."  # repo 루트로 이동(스크립트가 루트 기준 상대경로 사용)

SCRIPT="scripts/husky/pre-commit.sh"
PASS=0
FAIL=0

# run_case <설명> <CHANGED> <기대substring> <금지substring(선택)>
run_case() {
  desc="$1"; changed="$2"; expect="$3"; forbid="${4:-}"
  out=$(PRECOMMIT_DRY_RUN=1 PRECOMMIT_CHANGED_FILES="$changed" sh "$SCRIPT" 2>&1 || true)
  ok=1
  case "$out" in
    *"$expect"*) : ;;
    *) ok=0; echo "  기대 미포함: '$expect'" ;;
  esac
  if [ -n "$forbid" ]; then
    case "$out" in
      *"$forbid"*) ok=0; echo "  금지 포함됨: '$forbid'" ;;
    esac
  fi
  if [ "$ok" -eq 1 ]; then
    PASS=$((PASS + 1)); echo "PASS: $desc"
  else
    FAIL=$((FAIL + 1)); echo "FAIL: $desc"; echo "----- 출력 -----"; echo "$out"; echo "----------------"
  fi
}

# 1) 테스트 파일 변경 → 그 클래스 자신
run_case "테스트 파일 변경 → 자기 클래스 --tests" \
  "apps/workplace-api/src/test/java/com/workplace/auth/service/AuthServiceTest.java" \
  '--tests "*AuthServiceTest"'

# 2) 메인 파일 변경 → 이름 규칙 매칭 테스트를 파일시스템에서 검색
run_case "메인 파일 변경 → 매칭 테스트 도출" \
  "apps/workplace-api/src/main/java/com/workplace/auth/service/AuthService.java" \
  '--tests "*AuthServiceTest"'

# 3) 메인 파일 변경 + 매칭 테스트 없음 → compile/format 만 (--tests 없음)
run_case "매칭 테스트 없는 메인 변경 → compile 만" \
  "apps/workplace-api/src/main/java/com/workplace/calendar/CalendarPalette.java" \
  'compile/format 만' \
  '--tests'

# 4) api 비-Java(마이그레이션) 변경 → compile/format 만
run_case "마이그레이션 변경 → compile 만" \
  "apps/workplace-api/src/main/resources/db/migration/V999__x.sql" \
  'api 비-Java 변경'

# 5) web 만 변경(api 무변경) → gradle skip
run_case "web 만 변경 → gradle skip" \
  "apps/workplace-web/src/pages/mail/MailInboxPage.tsx" \
  'workplace-api 변경 없음 — gradle skip'

# 5b) 추상 베이스 테스트(@Test 없음) 변경 → vacuous green 회피: --tests 없이 compile-only
run_case "추상 베이스 테스트 변경 → compile 만(--tests 없음)" \
  "apps/workplace-api/src/test/java/com/workplace/support/IntegrationTestBase.java" \
  'compile' \
  '--tests'

# 6) 테스트 파일 2개 변경 → 둘 다 도출(중복/누적 확인)
run_case "테스트 파일 2개 → 둘 다 --tests" \
  "apps/workplace-api/src/test/java/com/workplace/auth/service/AuthServiceTest.java
apps/workplace-api/src/test/java/com/workplace/user/service/UserServiceTest.java" \
  '--tests "*UserServiceTest"'

# 7) mail 도메인 페이지 변경 → (변경 전에는 WEB_DOMAINS_RE 밖이라 전체 E2E였으나) 이제 도메인 한정 실행
run_case "mail 페이지 변경 → 도메인 한정(전체 E2E 아님)" \
  "apps/workplace-web/src/pages/mail/MailInboxPage.tsx" \
  "도메인 한정 변경 감지" \
  "공유 영역/매핑 외 변경 감지"

# 8) 여전히 톱레벨 flat 페이지(HomePage 등)는 매핑 모호 → 전체 E2E
run_case "톱레벨 flat 페이지 변경 → 전체 E2E 유지" \
  "apps/workplace-web/src/pages/HomePage.tsx" \
  "공유 영역/매핑 외 변경 감지"

echo
echo "=== 결과: PASS=$PASS FAIL=$FAIL ==="
[ "$FAIL" -eq 0 ]
