// 헤더 좌측 그룹을 AI 칩 좌측 경계 앞에서 자르는 훅 — 칩 위치를 실측해 max-width 를 직접 정한다.
// 왜: 칩은 body 에 portal 된 fixed 요소라 위치가 레일 폭(56↔152px)·AI 옆 패널 폭(--ai-side-width)에 따라 바뀐다.
// 고정식(50vw-360px)은 레일 펼침에서 겹치고, 칩이 비켜난 상황에선 필요 이상으로 제목을 잘랐다(#830 일반화).
import { type RefObject, useLayoutEffect } from 'react'

/** 칩과 좌측 그룹 사이 최소 간격(px). */
const CHIP_GAP = 16
/** 칩이 아무리 가까워도 남기는 좌측 그룹 최소 폭(px) — 칩이 그룹보다 왼쪽에 있는 극단 배치 대비. */
const MIN_GROUP_WIDTH = 120
/** 칩 표식(AIChip 의 data-ai-chip). */
const CHIP_SELECTOR = '[data-ai-chip]'

/** 변경된 노드가 칩이거나 칩을 품고 있는지 — body 직계 자식 변화 중 칩과 무관한 portal(토스트·팝오버 등)은 건너뛴다. */
function touchesChip(records: MutationRecord[]) {
  return records.some((r) =>
    [...r.addedNodes, ...r.removedNodes].some(
      (n) => n instanceof Element && (n.matches(CHIP_SELECTOR) || n.querySelector(CHIP_SELECTOR) != null),
    ),
  )
}

/**
 * enabled 인 동안 group 의 style.maxWidth = 칩 좌측 − 그룹 좌측 − 16px(최소 120px). 칩이 없으면 제한을 푼다.
 * 재측정 시점: 헤더 크기 변화(레일 토글·패널 열림/폭 조절·창 크기 — ResizeObserver),
 * 칩의 left 전환 종료(transitionend), body 직계 자식 중 칩이 붙거나 떨어질 때(MutationObserver).
 * 창 resize 는 헤더(콘텐츠 영역) 크기를 바꾸므로 ResizeObserver 가 함께 잡는다.
 * 관찰자 콜백은 한 프레임에 모아(requestAnimationFrame) rect 두 번 읽고 style 한 번 쓴다 — 첫 측정만 페인트 전에 바로 한다.
 */
export function useAiChipClamp(groupRef: RefObject<HTMLElement | null>, enabled: boolean) {
  useLayoutEffect(() => {
    const group = groupRef.current
    if (!group) return
    if (!enabled) {
      group.style.maxWidth = ''
      return
    }
    let chip: HTMLElement | null = null
    let frame = 0

    // 칩 자신의 left 전환이 끝났을 때만 — 색·테두리 전환이나 자식에서 버블된 transitionend 는 위치와 무관.
    const onTransitionEnd = (e: TransitionEvent) => {
      if (e.target === chip && e.propertyName === 'left') schedule()
    }

    const measure = () => {
      // 칩 portal 은 모드 전환·재마운트로 교체될 수 있어 매번 연결 상태를 확인하고 다시 찾는다.
      const found = document.querySelector<HTMLElement>(CHIP_SELECTOR)
      if (found !== chip) {
        chip?.removeEventListener('transitionend', onTransitionEnd)
        found?.addEventListener('transitionend', onTransitionEnd)
        chip = found
      }
      if (!chip) {
        group.style.maxWidth = ''
        return
      }
      const room = chip.getBoundingClientRect().left - group.getBoundingClientRect().left - CHIP_GAP
      group.style.maxWidth = `${Math.max(MIN_GROUP_WIDTH, room)}px`
    }

    function schedule() {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        measure()
      })
    }

    measure()
    const resizeObserver = new ResizeObserver(schedule)
    // 그룹의 위치·가용 폭은 헤더(=콘텐츠 영역 폭)를 따라 움직인다.
    resizeObserver.observe(group.parentElement ?? group)
    const mutationObserver = new MutationObserver((records) => {
      if (touchesChip(records)) schedule()
    })
    mutationObserver.observe(document.body, { childList: true })
    return () => {
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      chip?.removeEventListener('transitionend', onTransitionEnd)
      group.style.maxWidth = ''
    }
  }, [groupRef, enabled])
}
