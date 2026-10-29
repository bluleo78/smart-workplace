#!/usr/bin/env sh
# 전체 회귀(이미지 입력 타입 검사 → web vitest → web E2E 전체 → admin E2E → api gradle test) — pre-push 가 부르고, 워크트리에서 머지 전에 직접 돌려도 된다(`pnpm test:full`).
# 바뀐 곳(origin/main 기준)에 따라 단계를 줄인다(gate-scope.sh, WP-1208): web 만 → 타입 검사·web vitest·web E2E,
#   admin 만 → 타입 검사·admin E2E, web+admin → gradle 만 건너뜀, 그 밖은 전체.
# 끝까지 통과하면 지금 커밋의 트리 해시를 「검증 완료 트리」로 그 범위와 함께 기록한다 (WP-446).
#   같은 트리(스쿼시·--no-ff 머지해도 트리는 같다)를 push 할 때 pre-push 가 회귀를 다시 돌지 않는다.
#   회귀는 작업 트리를 검사하므로, 추적 파일이 커밋과 같고 커밋하지 않은 코드 파일(noncode.sh 규칙 밖의 추적 안 된 파일)이 없을 때만 기록한다.
# 환경변수:
#   PREPUSH_VERIFIED_FILE — 기록 파일 경로(기본: git common dir 의 workplace-prepush-verified-trees, 모든 워크트리 공유)
#   FULL_REGRESSION_CMD   — 회귀 대신 실행할 명령(테스트 전용 — 락 없이 실행). 공유 기록을 더럽히지 않게 PREPUSH_VERIFIED_FILE 이 함께 있어야 한다.
#                           고른 범위는 GATE_SCOPE 환경변수로 그 명령에 넘어간다.
#   FULL_REGRESSION_SCOPE — 범위를 판정하지 않고 이 값으로 돈다(full 로 전체를 강제할 때). full|web|admin|web+admin

set -e

HOOK_DIR=$(dirname "$0")
. "$HOOK_DIR/noncode.sh"
. "$HOOK_DIR/gate-scope.sh"
. "$HOOK_DIR/verified-trees.sh"

if [ -n "$FULL_REGRESSION_CMD" ] && [ -z "$PREPUSH_VERIFIED_FILE" ]; then
  echo "[full-regression] FULL_REGRESSION_CMD 는 테스트 전용 — PREPUSH_VERIFIED_FILE 없이 쓰면 공유 기록에 가짜 통과가 남는다" >&2
  exit 1
fi

# 작업 트리가 커밋과 같은가 — 추적 파일 변경 없음 + 커밋하지 않은 코드 파일 없음(빠뜨린 git add 로 통과하는 경우를 막는다).
matches_commit() {
  git diff --quiet HEAD -- && [ -z "$(code_files "$(git -c core.quotePath=false ls-files --others --exclude-standard)")" ]
}

# 회귀 시작 시점의 트리 — 추적 파일이 커밋과 다르면 기록하지 않는다(검사한 것이 커밋 트리가 아니므로).
TREE=$(git rev-parse 'HEAD^{tree}')
CLEAN_AT_START=1
matches_commit || CLEAN_AT_START=0

# 돌릴 범위 — 기록·pre-push 와 같은 기준(origin/main 과 갈라진 뒤 바꾼 코드 파일). origin/main 이 없으면 전체.
if [ -n "$FULL_REGRESSION_SCOPE" ]; then
  GATE_SCOPE=$FULL_REGRESSION_SCOPE
elif git rev-parse --verify --quiet refs/remotes/origin/main >/dev/null; then
  GATE_SCOPE=$(gate_scope refs/remotes/origin/main HEAD)
else
  GATE_SCOPE=full
fi
case "$GATE_SCOPE" in
  full) STAGES="이미지 타입 검사 · web vitest · web E2E · admin E2E · api gradle" ;;
  web) STAGES="이미지 타입 검사 · web vitest · web E2E (admin E2E·gradle 건너뜀)" ;;
  admin) STAGES="이미지 타입 검사 · admin E2E (web vitest·web E2E·gradle 건너뜀)" ;;
  web+admin) STAGES="이미지 타입 검사 · web vitest · web E2E · admin E2E (gradle 건너뜀)" ;;
  *) echo "[full-regression] 알 수 없는 범위 '$GATE_SCOPE' — full|web|admin|web+admin" >&2; exit 1 ;;
esac
export GATE_SCOPE
echo "[full-regression] 범위: $GATE_SCOPE — $STAGES"

if [ -n "$FULL_REGRESSION_CMD" ]; then
  sh -c "$FULL_REGRESSION_CMD"
else
  # 게이트 전체를 저장소 전역 락 하나로 감싼다 — 워크트리 간 동시 실행이 겹치면 여기서 대기 (WP-98).
  # 단계별로 락을 잡으면 사이사이 다른 세션이 끼어들어 한 게이트가 길게 늘어지므로 통째로 잡는다.
  . "$HOOK_DIR/test-lock.sh"
  run_locked sh -c '
    set -e
    # 범위에 든 앱인가 — full 이면 모두.
    want() { [ "$GATE_SCOPE" = full ] || case "+$GATE_SCOPE+" in *"+$1+"*) return 0 ;; *) return 1 ;; esac; }
    # 이미지 빌드와 같은 입력(.dockerignore 로 테스트 파일·src/test/ 를 뺌)으로 web·admin·collab 타입 검사(1분 안팎, WP-1026).
    # 테스트 아닌 파일이 src/test/ 를 import 하면 로컬·CI typecheck 는 통과하고 이미지 빌드만 깨진다(v0.9.24) — PR 전에 잡는다.
    node scripts/image-typecheck.mjs
    if want web; then
      # web 단위·페이지 테스트(vitest 전체, 3분 안팎) — E2E 보다 먼저 돌려 순수 로직 회귀를 빠르게 실패시킨다 (WP-79).
      # 페이지 테스트는 pre-commit 이 빼고 돌므로 여기가 유일한 게이트다 (WP-995)
      (cd apps/workplace-web && pnpm test)
      # web 전체 E2E 는 preview 서버(빌드 결과물 서빙)로 실행 — 워커 4 기준 dev 13.3분 → 7.9분 (WP-76)
      # 재시도로 통과한 flaky 를 git common dir 의 누적 로그에 남긴다(모든 워크트리 공유, WP-225).
      # 실패해도 기록은 남기고 게이트 결과는 그대로 돌려준다.
      FLAKY_LOG="$(cd "$(git rev-parse --git-common-dir)" && pwd)/workplace-e2e-flaky.tsv"
      REPORT_JSON="$(pwd)/test-results/e2e-report.json"
      rm -f "$REPORT_JSON"
      e2e_status=0
      (cd apps/workplace-web && PLAYWRIGHT_JSON_OUTPUT_FILE="$REPORT_JSON" E2E_SERVER=preview pnpm test:e2e --reporter=html,json) || e2e_status=$?
      node scripts/e2e-flaky-record.mjs "$REPORT_JSON" "$FLAKY_LOG" || true
      [ "$e2e_status" -eq 0 ] || exit "$e2e_status"
    fi
    if want admin; then (cd apps/workplace-admin && pnpm test:e2e); fi
    # api gradle 은 전체 범위에서만 — web·admin 만 바꾼 변경은 api 동작을 바꾸지 않는다.
    [ "$GATE_SCOPE" = full ] || exit 0
    # 게이트는 통과/실패만 필요 — test 의 finalizedBy 로 매번 도는 JaCoCo 리포트 생성은 제외 (WP-76),
    # 리포트를 안 만드니 계측 에이전트도 끈다(-PnoCoverage, WP-1028). 이 단계는 앞 단계가 끝난 뒤 혼자 돌므로
    # 포크를 기본 2 보다 하나 늘린다(-PtestForks=3, 452→376초)
    cd apps/workplace-api && ./gradlew test -PnoCoverage -PtestForks=3 -x generateJooq -x jacocoTestReport --build-cache --configuration-cache
  '
fi

# 회귀 도중 커밋·체크아웃이 바뀌었거나 작업 트리가 커밋과 달랐으면 기록하지 않는다.
if [ "$CLEAN_AT_START" -eq 1 ] && [ "$(git rev-parse 'HEAD^{tree}')" = "$TREE" ] && matches_commit; then
  record_verified "$TREE" "$GATE_SCOPE"
  echo "[full-regression] 통과 — 검증 완료 트리 기록 $(printf %.12s "$TREE") (범위 $GATE_SCOPE)"
else
  echo "[full-regression] 통과 — 작업 트리가 커밋과 달라 검증 완료 트리로 기록하지 않음"
fi
