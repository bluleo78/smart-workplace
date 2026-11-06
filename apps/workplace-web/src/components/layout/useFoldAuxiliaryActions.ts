// 페이지 헤더의 보조 단추(auxiliaryActions) 접기(WP-1415). 제목 자리(틀 left − 좌측 그룹 left − 16px)가
// 160px보다 좁으면 보조 단추를 「더보기」(⋯)로 접는다. 접으면 actions 가 좁아지고 틀이 오른쪽으로 이동해 제목 자리가
// 넓어진다(right-stop). 진동 방지: hysteresis(켜짐 <160px, 꺼짐 >160px+120px).
// useAiChipClamp·useAiChipRightClamp 과 같은 결 — ResizeObserver·window resize·body MutationObserver.
import { type RefObject, useCallback, useEffect, useState } from 'react'

/** 제목 자리 최소 폭(px) — 이보다 좁으면 보조 단추 접기. */
export const MIN_TITLE_SPACE = 160
/** 접기/펼치기 임계 간격(px) — 접힘 효과(actions 가 좁아지는 폭)보다 커야 진동하지 않는다. */
export const FOLD_HYSTERESIS = 120

/**
 * 제목 자리에 따른 접기 판정(hysteresis 포함). 진동 방지: 켜짐 <160px, 꺼짐 >160px+120px.
 * @param titleSpace 제목 자리 폭(px)
 * @param folded 현재 접힘 상태
 * @returns 다음 접힘 상태
 */
export function foldDecision(titleSpace: number, folded: boolean): boolean {
  if (titleSpace < MIN_TITLE_SPACE) return true
  if (titleSpace > MIN_TITLE_SPACE + FOLD_HYSTERESIS) return false
  return folded
}

/**
 * 제목 자리가 160px보다 좁으면 true(보조 단추 접기). hasAux 가 false 면(접을 보조 단추가 없으면) 항상 false.
 * leftGroupRef 은 좌측 그룹(제목)의 ref. 틀([data-ai-chip])의 left 를 실측해 제목 자리를 계산한다.
 */
export function useFoldAuxiliaryActions(leftGroupRef: RefObject<HTMLElement | null>, hasAux: boolean): boolean {
  const [folded, setFolded] = useState(false)
  const apply = useCallback(() => {
    if (!hasAux) {
      setFolded(false)
      return
    }
    const leftGroup = leftGroupRef.current
    if (!leftGroup) return
    const chip = document.querySelector<HTMLElement>('[data-ai-chip]')
    if (!chip) return
    // jsdom 에서 getBoundingClientRect 이 0 을 주므로 접지 않는다(테스트가 보조 단추를 DOM 에서 찾게).
    const leftGroupBox = leftGroup.getBoundingClientRect()
    const chipBox = chip.getBoundingClientRect()
    if (leftGroupBox.width === 0 || chipBox.width === 0) {
      setFolded(false)
      return
    }
    const titleSpace = chipBox.left - leftGroupBox.left - 16
    // 함수형 업데이트로 최신 folded 를 본다(apply 가 stale 상태 를 포획하지 않게).
    setFolded(prev => foldDecision(titleSpace, prev))
  }, [leftGroupRef, hasAux])
  useEffect(() => {
    // DOM 실측 → 상태 동기화(합법 패턴) — useAiChipClamp 과 같은 결.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    apply()
    const leftGroup = leftGroupRef.current
    const chip = document.querySelector<HTMLElement>('[data-ai-chip]')
    if (!leftGroup || !chip) return
    const ro = new ResizeObserver(apply)
    ro.observe(leftGroup)
    ro.observe(chip)
    window.addEventListener('resize', apply)
    const mo = new MutationObserver(apply)
    mo.observe(document.body, { childList: true, subtree: true })
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', apply)
      mo.disconnect()
    }
  }, [leftGroupRef, apply])
  return folded
}
