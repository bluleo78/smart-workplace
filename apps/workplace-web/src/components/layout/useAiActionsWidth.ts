// 상단 오른쪽 액션 폭과 칩 반폭 보정을 칩 포털에 CSS 변수로 넘기는 훅(WP-1415).
// 왜: 칩은 body 에 portal 된 fixed 요소라 헤더 우측 액션의 폭·칩 자신의 폭을 CSS 로 알 수 없다.
// 액션이 칩을 침범할 만큼 넓으면 TopCenterSlot 의 3 번째 min() 항이 칩을 왼쪽으로 밀어 겹침을 막는다.
// 3 항의 오프셋은 칩 반폭에 맞게 바뀐다 — 동그라미(32px)면 88px, 일반 칩(140px)이면 142px.
// (오프셋 = 88 + (칩폭-32)/2: 88px 는 동그라미 반폭 16 + 간격 8 + 검색 32 + 간격 16 + 여백 16.)
import { useEffect } from 'react'

import { useActiveDensityHeader } from './HeaderDensityContext'

/** 헤더 우측 액션 표식(Page.Header 의 data-ai-actions). */
const ACTIONS_SELECTOR = '[data-ai-actions]'
/** 상단 가운데 틀 표식(TopCenterSlot 의 data-ai-chip — 폭이 칩 폭과 같다, 검색은 absolute). */
const CHIP_SELECTOR = '[data-ai-chip]'

/**
 * [data-ai-actions] 의 폭을 --ai-actions-width 로, [data-ai-chip] 의 폭을 --ai-chip-offset 로 복사한다.
 * 액션이 없으면(모바일·헤더 없는 화면) 0px — 3 번째 항이 100%-오프셋 가 돼 기본 중앙보다 항상 크므로 영향 없음.
 * 액션은 칩보다 늦게 마운트될 수 있어(페이지 헤더가 포털 이후 렌더) MutationObserver 로 등장까지 기다린다.
 * 재측정: 액션 크기·칩 크기(동그라미↔일반 전환)·창 resize·액션 등장/사라짐.
 */
export function useAiActionsWidth() {
  const header = useActiveDensityHeader()
  useEffect(() => {
    let actions: HTMLElement | null = null
    let chip: HTMLElement | null = null
    const update = () => {
      if (!chip) return
      chip.style.setProperty('--ai-actions-width', `${actions?.getBoundingClientRect().width ?? 0}px`)
      const width = chip.getBoundingClientRect().width
      chip.style.setProperty('--ai-chip-offset', `${88 + Math.max(0, (width - 32) / 2)}px`)
    }
    const ro = new ResizeObserver(update)
    // 헤더와 포털이 각기 늦게 나타나도 두 요소를 함께 다시 연결한다.
    const attach = () => {
      const nextActions = header?.querySelector<HTMLElement>(ACTIONS_SELECTOR) ?? null
      const nextChip = document.querySelector<HTMLElement>(CHIP_SELECTOR)
      if (actions !== nextActions || chip !== nextChip) {
        ro.disconnect()
        actions = nextActions
        chip = nextChip
        if (actions) ro.observe(actions)
        if (chip) ro.observe(chip)
      }
      update()
    }
    attach()
    const bodyObserver = new MutationObserver(attach)
    bodyObserver.observe(document.body, { childList: true })
    const headerObserver = new MutationObserver(attach)
    if (header) headerObserver.observe(header, { childList: true, subtree: true })
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      bodyObserver.disconnect()
      headerObserver.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [header])
}
