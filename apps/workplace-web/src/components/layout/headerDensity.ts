// 헤더의 접기와 AI 축소를 순서대로 결정해 서로 다른 측정이 상태를 되돌리지 않게 한다.
export interface HeaderDensityState {
  folded: boolean
  circle: boolean
}

/** 제목 최소 공간 160px, 칩 폭 차이 108px를 복귀 여유로 사용한다. */
export function nextHeaderDensityState({ titleSpace, hasAuxiliaryActions, current, foldDisplacement }: {
  titleSpace: number
  hasAuxiliaryActions: boolean
  current: HeaderDensityState
  foldDisplacement: number
}): HeaderDensityState {
  if (hasAuxiliaryActions && !current.folded && titleSpace < 160) return { folded: true, circle: false }
  // 동그라미부터 풀어 원래 칩 폭으로 측정한 뒤 보조 단추를 펼친다.
  const circle = titleSpace < 160 || (current.circle && titleSpace <= 268)
  const folded = hasAuxiliaryActions && current.folded
    && (current.circle || titleSpace <= 160 + foldDisplacement)
  return { folded, circle }
}
