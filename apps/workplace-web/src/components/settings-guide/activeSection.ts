// 설정 가이드 섹션 따라가기(WP-1281) — 본문에서 「지금 보고 있는 섹션」을 고르는 순수 판정. 화면 측정과 분리해 vitest 로 지킨다.

/** 본문 스크롤 요소 기준 섹션 머리 위치(px, 보이는 영역 위쪽이 0). */
export interface SectionPosition {
  id: string
  top: number
}

/** 기준선 — 본문 보이는 높이의 위쪽 30%. 섹션 머리가 이 선을 넘어 올라오면 그 섹션을 보고 있는 것으로 본다. */
export const ACTIVE_SECTION_BASELINE = 0.3
/**
 * 맨 아래까지 내렸을 때의 기준선 — 보이는 높이의 60%. 짧은 마지막 섹션은 머리가 30% 선까지 못 올라오므로 아래에서는 선을 내려 잡는다.
 * 「맨 아래면 무조건 마지막 섹션」으로 두면 넓은 화면에서 실행·코드 저장소·위험 구역이 한 화면에 다 보일 때 위험 구역이 잡혀,
 * 실행 섹션의 「가이드 열기」를 눌러도 위험 구역 도움말이 열렸다.
 */
export const ACTIVE_SECTION_BASELINE_AT_BOTTOM = 0.6

/**
 * 지금 섹션 id — 머리가 기준선 위(top ≤ 기준선)에 있는 섹션 중 마지막. 아직 아무 섹션도 기준선에 닿지 않았으면 첫 섹션. 섹션이 없으면 null.
 * 기준선은 보이는 높이(viewHeight)의 30%, 맨 아래까지 내렸으면(atBottom) 60%. positions 는 화면 순서(위→아래)다.
 */
export function pickActiveSection(positions: SectionPosition[], viewHeight: number, atBottom: boolean): string | null {
  if (positions.length === 0) return null
  const baseline = viewHeight * (atBottom ? ACTIVE_SECTION_BASELINE_AT_BOTTOM : ACTIVE_SECTION_BASELINE)
  let active = positions[0].id
  for (const p of positions) {
    if (p.top <= baseline) active = p.id
    else break
  }
  return active
}
