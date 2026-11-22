#!/usr/bin/env sh
# 커밋의 main push CI(.github/workflows/ci.yml — 전체 lint·typecheck·웹 vitest)가 이미 통과했는지 한 번 본다(WP-2003).
# 검토자 풀테스트(full-regression.sh, FULL_REGRESSION_CI_VITEST=1)가 web vitest 를 직접 도는 대신 쓴다 — 같은 커밋에서
# CI 가 이미 통과했으면 풀테스트에서 다시 돌지 않아 15분 안팎을 줄인다.
# 기다리지 않는다: 머지가 이어지면 main CI 가 밀려 30분을 기다려도 안 끝난 적이 있다(cd973d058) — 아직이면 바로 직접 돈다.
# CI 실패도 직접 돈다: CI 의 web vitest 는 가끔 흔들려(useMailTrash 등) 그것만으로 풀테스트를 실패시키지 않는다.
#
#   sh scripts/husky/ci-vitest-result.sh <커밋 sha>
#
# 종료 코드: 0 = CI 통과(vitest 를 건너뛴다) · 2 = 그 밖(진행 중·실패·실행 없음·gh 없음·조회 실패) — 부른 쪽이 vitest 를 직접 돈다.

sha=$1
[ -n "$sha" ] || { echo "[ci-vitest] 사용법: ci-vitest-result.sh <커밋 sha>" >&2; exit 2; }
command -v gh >/dev/null 2>&1 || { echo "[ci-vitest] gh 가 없어 CI 결과를 볼 수 없다 — vitest 를 직접 돈다"; exit 2; }

# 같은 커밋에 push 실행이 여럿이면(다시 돌림) 가장 최근 것을 본다.
if ! out=$(gh run list --commit "$sha" --workflow ci.yml --event push --limit 1 --json status,conclusion --jq '.[0] | "\(.status) \(.conclusion)"' 2>/dev/null); then
  echo "[ci-vitest] CI 조회 실패 — vitest 를 직접 돈다"; exit 2
fi
case "$out" in
  'completed success') echo "[ci-vitest] main CI 통과 — web vitest 를 다시 돌지 않는다"; exit 0 ;;
  ''|'null null') echo "[ci-vitest] $sha 의 main push CI 실행이 없다 — vitest 를 직접 돈다"; exit 2 ;;
  completed\ *) echo "[ci-vitest] main CI 실패($out) — 흔들림일 수 있어 vitest 를 직접 돈다(gh run list --commit $sha 로 확인)"; exit 2 ;;
  *) echo "[ci-vitest] CI 가 아직 끝나지 않았다($out) — 기다리지 않고 vitest 를 직접 돈다"; exit 2 ;;
esac
