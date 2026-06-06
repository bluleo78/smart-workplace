#!/usr/bin/env bash
# Smart Workplace — GitHub Issue 라벨 일괄 생성/업데이트 (idempotent, 최초 1회)
# 사용법: bash .claude/skills/ai-driven-pilot/scripts/init-labels.sh
# - 이미 존재하는 라벨은 색상/설명만 갱신 (gh label create --force)
# - 라이프사이클 모델: .claude/docs/issue-lifecycle.md (ai-fix 게이트 모델)
# - explorer/solver/pilot이 첫 `gh issue create` 전에 이 라벨 셋을 전제한다.

set -e

REPO="bluleo78/smart-workplace"

# 라벨 정의: name|color(hex without #)|description
# 스킬(explorer/solver/pilot)이 실제로 생성·참조하는 기능 라벨만 둔다 (lean 14종).
# 종료 사유(duplicate/wontfix/by-design/not-reproducible/invalid 등)는 GitHub 네이티브
# close reason(completed/not planned)으로 대체 — 필요 시 사람이 ad-hoc 라벨로 추가.
LABELS=(
  # 기본
  "bug|d73a4a|기능/UI 결함 (explorer 발견)"

  # severity — 파일럿 우선순위 (Critical=red, Major=orange, Minor=yellow, UX=blue-gray)
  "severity:critical|b60205|데이터 유실, 기능 완전 불가, 보안 이슈"
  "severity:major|d93f0b|핵심 기능 일부 오동작, 데이터 오류"
  "severity:minor|fbca04|비핵심 기능 오동작, 처리되지 않은 예외"
  "severity:ux|c5def5|혼란스러운 UI, 잘못된 레이블, 시각적 이상"

  # 라이프사이클
  "resolved|c2e0c6|solver 수정 완료, explorer 크로스체크 대기"
  "regression|e99695|크로스체크에서 회귀 발견 — 재작업 대기"
  "needs-info|d876e3|재현 단계/환경/입력값 추가 필요"
  "needs-decision|fbca04|진단이 도메인/스펙 가정에 의존 — 사람 결정 필요"

  # 자율 처리 게이트
  "ai-fix|0e8a16|pilot 자율 처리 옵트인 신호 (사람 개입 필요 시 pilot이 자동 제거)"
  "pilot:processing|ededed|pilot 자율 사이클이 처리 중 (작업 종료 시 자동 제거)"

  # 관점/라우팅 (design/a11y/perf는 solver Step 0이 자율 수정 부적합으로 차단)
  "design|fef2c0|디자인 토큰/시각/카피 — 사람 결정 필요"
  "a11y|7057ff|접근성 (WCAG 2.2 AA) — SR 청취/키보드 흐름 사람 검증"
  "perf|1d76db|성능 (Core Web Vitals) — DevTools 측정/heap snapshot 사람 캡처"
  "security|b60205|보안 이슈 — 코드 fix 가능 시 자율, 정책 결정 필요 시 사람"
)

echo "🏷  Smart Workplace — 라벨 초기화 시작 (repo=$REPO)"
echo

UPDATED=0
FAILED=0

for entry in "${LABELS[@]}"; do
  IFS='|' read -r NAME COLOR DESC <<< "$entry"
  # 이미 있으면 --force로 색상/설명 갱신 (gh label create는 force 시 update로 동작)
  if gh label create "$NAME" --color "$COLOR" --description "$DESC" --repo "$REPO" --force >/dev/null 2>&1; then
    echo "  ✓ $NAME"
    UPDATED=$((UPDATED+1))
  else
    echo "  ✗ $NAME (실패)"
    FAILED=$((FAILED+1))
  fi
done

echo
echo "완료: 처리 $UPDATED건, 실패 $FAILED건"
echo "확인: gh label list --repo $REPO"
