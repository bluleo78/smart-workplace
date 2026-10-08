// 헤더 좌측 그룹을 AI 칩 좌측 경계 앞에서 자르는 훅 — 칩 위치를 실측해 max-width 를 직접 정한다.
// 왜: 칩은 body 에 portal 된 fixed 요소라 위치가 레일 폭(56↔152px)·AI 옆 패널 폭(--ai-side-width)에 따라 바뀐다.
// 고정식(50vw-360px)은 레일 펼침에서 겹치고, 칩이 비켜난 상황에선 필요 이상으로 제목을 잘랐다(#830 일반화).
import { type RefObject, useLayoutEffect } from 'react'

/** 칩과 좌측 그룹 사이 최소 간격(px). */
const CHIP_GAP = 16
/** 칩이 아무리 가까워도 남기는 좌측 그룹 최소 폭(px) — 칩이 그룹보다 왼쪽에 있는 극단 배치 대비. */
const MIN_GROUP_WIDTH = 120

/**
 * enabled 인 동안 group 의 style.maxWidth = 칩 좌측 − 그룹 좌측 − 16px(최소 120px). 칩이 없으면 제한을 푼다.
 * 재측정 시점: 헤더 크기 변화(레일 토글·패널 열림/폭 조절·창 크기 — ResizeObserver), 창 resize,
 * 칩의 left 전환 종료(transitionend), body 직계 자식 변화(칩 portal 이 늦게 붙거나 떨어질 때).
 * 측정은 rect 두 번 읽고 style 한 줄 쓰는 것뿐이라 콜백마다 바로 돌린다(그룹 폭 변경은 헤더 크기를 바꾸지 않아 루프 없음).
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

    const measure = () => {
      // 칩 portal 은 모드 전환·재마운트로 교체될 수 있어 매번 연결 상태를 확인하고 다시 찾는다.
      const found = document.querySelector<HTMLElement>('[data-ai-chip]')
      if (found !== chip) {
        chip?.removeEventListener('transitionend', measure)
        found?.addEventListener('transitionend', measure)
        chip = found
      }
      if (!chip) {
        group.style.maxWidth = ''
        return
      }
      const room = chip.getBoundingClientRect().left - group.getBoundingClientRect().left - CHIP_GAP
      group.style.maxWidth = `${Math.max(MIN_GROUP_WIDTH, room)}px`
    }

    measure()
    const resizeObserver = new ResizeObserver(measure)
    // 그룹의 위치·가용 폭은 헤더(=콘텐츠 영역 폭)를 따라 움직인다.
    resizeObserver.observe(group.parentElement ?? group)
    const mutationObserver = new MutationObserver(measure)
    mutationObserver.observe(document.body, { childList: true })
    window.addEventListener('resize', measure)
    return () => {
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      window.removeEventListener('resize', measure)
      chip?.removeEventListener('transitionend', measure)
      group.style.maxWidth = ''
    }
  }, [groupRef, enabled])
}
