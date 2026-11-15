// 헤더의 접기와 AI 축소를 순서대로 결정해 서로 다른 측정이 상태를 되돌리지 않게 한다.
// 순서: ① 보조 액션 접기(folded) → ② AI 칩 동그라미(circle) → ③ 상단 가운데 단추를 헤더 안으로 넣기(docked, WP-1611).
/**
 * 페이지 헤더(Page.tsx DesktopPageHeader)가 열어 두는 상단 가운데 단추 자리 표식(WP-1611).
 * 헤더 넣기 단계에서 TopCenterSlot 이 단추를 이 안으로 옮기고, 밀도 측정(HeaderDensityContext)은 이 자리가 있는 화면만 그 단계를 쓴다.
 * 순수 모듈에 두어 TopCenterSlot ↔ HeaderDensityContext 사이에 import 고리가 생기지 않게 한다.
 */
export const HEADER_DOCK_ATTR = 'data-ai-header-dock'
/** HEADER_DOCK_ATTR 를 찾는 선택자 — 문자열을 곳곳에 따로 적지 않는다. */
export const HEADER_DOCK_SELECTOR = `[${HEADER_DOCK_ATTR}]`

export interface HeaderDensityState {
  folded: boolean
  circle: boolean
  /**
   * 떠 있는 상단 가운데 틀(검색·「?」, 비서가 있으면 AI 동그라미)을 숨기고 같은 단추를 헤더 오른쪽 액션 앞에 그린다(WP-1611).
   * 앞 단계를 다 써도 제목 자리가 160px 보다 좁을 때만 켠다 — 틀이 min() 항에 밀려 좌측 그룹(이슈 키·제목)을 덮지 않게.
   */
  docked: boolean
}

/** 제목 최소 공간(px) — 이보다 좁으면 다음 단계로 줄인다(WP-1415). */
const MIN_TITLE_SPACE = 160

/**
 * 헤더에서 다시 가운데로 돌아가는 이력 여유(px, WP-1611).
 * 숨긴 틀은 돌아갔을 때의 자리에 그대로 있어(헤더 단추는 [data-ai-actions] 밖이라 --ai-actions-width 에 들지 않는다)
 * 측정한 제목 자리가 곧 「돌아가면 남을 자리」다 — 기하 변위가 없어 여유는 순수한 깜빡임 방지용이다.
 * 40px = 상단 단추 하나(32px) + 단추 간격(8px): 스크롤바 등장(약 15px)·소수점 반올림·패널 손잡이 한 걸음(20px) 정도의 흔들림으로는
 * 헤더 ↔ 가운데를 오가지 않고, 단추 한 개 자리가 더 생겨야 돌아간다.
 */
const UNDOCK_MARGIN = 40

/** 제목 최소 공간 160px, 칩 폭 차이 108px를 복귀 여유로 사용한다. 헤더 넣기는 160 + 40px 를 넘어야 푼다. */
export function nextHeaderDensityState({ titleSpace, hasAuxiliaryActions, hasAiChip = true, hasDockSlot = false, current, foldDisplacement }: {
  titleSpace: number
  hasAuxiliaryActions: boolean
  hasAiChip?: boolean
  /** 헤더에 단추를 넣을 자리([data-ai-header-dock])가 있는지 — 없으면(헤더 없는 화면) 마지막 단계를 쓰지 않는다. */
  hasDockSlot?: boolean
  current: HeaderDensityState
  foldDisplacement: number
}): HeaderDensityState {
  // ③ 헤더 안에 있는 동안은 앞 단계를 그대로 둔다 — 숨긴 틀의 폭(동그라미)이 바뀌면 측정 기준이 흔들린다.
  // 충분히 넓어지면 헤더 넣기만 풀고, 동그라미·접기는 다음 측정부터 기존 규칙으로 차례로 풀린다.
  if (current.docked) {
    if (!hasDockSlot || titleSpace > MIN_TITLE_SPACE + UNDOCK_MARGIN) return { ...current, docked: false }
    // 넣은 뒤에 보조 액션이 새로 나타나면(펼친 채) 그것만은 접는다 — 그대로 두면 좌측 그룹이 0 폭까지 밀린다(WP-1611 리뷰).
    // 헤더 넣기·동그라미는 유지한다(접기는 숨긴 틀의 폭을 바꾸지 않아 측정 기준이 흔들리지 않는다).
    if (hasAuxiliaryActions && !current.folded && titleSpace < MIN_TITLE_SPACE) return { ...current, folded: true }
    return current
  }
  if (hasAuxiliaryActions && !current.folded && titleSpace < MIN_TITLE_SPACE) return { folded: true, circle: false, docked: false }
  // 앞 단계(있는 것만)를 이미 다 쓴 상태에서도 좁으면 헤더로 넣는다. 한 측정에 한 단계씩만 나아간다.
  const exhausted = (!hasAuxiliaryActions || current.folded) && (!hasAiChip || current.circle)
  if (hasDockSlot && exhausted && titleSpace < MIN_TITLE_SPACE) return { ...current, docked: true }
  // 동그라미부터 풀어 원래 칩 폭으로 측정한 뒤 보조 단추를 펼친다.
  const circle = hasAiChip && (titleSpace < MIN_TITLE_SPACE || (current.circle && titleSpace <= 268))
  const folded = hasAuxiliaryActions && current.folded
    && ((hasAiChip && current.circle) || titleSpace <= MIN_TITLE_SPACE + foldDisplacement)
  return { folded, circle, docked: false }
}
