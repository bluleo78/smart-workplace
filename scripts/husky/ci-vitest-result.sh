#!/usr/bin/env sh
# 커밋의 main push CI(.github/workflows/ci.yml — 전체 lint·typecheck·웹 vitest) 결과를 기다려 알려 준다(WP-2003).
# 검토자 풀테스트(full-regression.sh, FULL_REGRESSION_CI_VITEST=1)가 web vitest 를 직접 도는 대신 쓴다 — 같은 커밋에서
# CI 가 이미 돌았으니 풀테스트에서 다시 돌지 않아 몇 분을 줄인다.
#
#   sh scripts/husky/ci-vitest-result.sh <커밋 sha>
#
# 종료 코드: 0 = CI 통과 · 1 = CI 실패(main 이 깨졌다 — 풀테스트도 실패로 본다) ·
#           2 = 결과를 알 수 없음(gh 없음·조회 실패·그 커밋의 push 실행 없음·기다림 초과) — 부른 쪽이 vitest 를 직접 돈다.
# 환경변수: CI_VITEST_WAIT_SECONDS — 진행 중인 CI 를 기다릴 최대 시간(기본 1800초). CI_VITEST_POLL_SECONDS — 확인 간격(기본 30초).

sha=$1
[ -n "$sha" ] || { echo "[ci-vitest] 사용법: ci-vitest-result.sh <커밋 sha>" >&2; exit 2; }
command -v gh >/dev/null 2>&1 || { echo "[ci-vitest] gh 가 없어 CI 결과를 볼 수 없다 — vitest 를 직접 돈다"; exit 2; }

deadline=$(( $(date +%s) + ${CI_VITEST_WAIT_SECONDS:-1800} ))
while :; do
  # 같은 커밋에 push 실행이 여럿이면(다시 돌림) 가장 최근 것을 본다.
  if ! out=$(gh run list --commit "$sha" --workflow ci.yml --event push --limit 1 --json status,conclusion --jq '.[0] | "\(.status) \(.conclusion)"' 2>/dev/null); then
    echo "[ci-vitest] CI 조회 실패 — vitest 를 직접 돈다"; exit 2
  fi
  case "$out" in
    ''|'null null') echo "[ci-vitest] $sha 의 main push CI 실행이 없다 — vitest 를 직접 돈다"; exit 2 ;;
    'completed success') echo "[ci-vitest] main CI 통과 — web vitest 를 다시 돌지 않는다"; exit 0 ;;
    completed\ *) echo "[ci-vitest] main CI 실패($out) — main 이 깨졌다(gh run list --commit $sha 로 확인)"; exit 1 ;;
  esac
  [ "$(date +%s)" -lt "$deadline" ] || { echo "[ci-vitest] CI 가 끝나지 않았다($out) — vitest 를 직접 돈다"; exit 2; }
  sleep "${CI_VITEST_POLL_SECONDS:-30}"
done
