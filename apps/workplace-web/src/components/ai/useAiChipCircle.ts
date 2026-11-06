// AI 칩을 글자 없는 동그라미로 줄이기(WP-1415). 제목 자리가 160px보다 좁으면(보조 단추를 접고도) 32px 동그라미(✦만)로 줄인다.
// 동그라미면 칩이 좁아져 틀이 오른쪽으로 이동할 수 있고 제목 자리가 넓어진다. 진동 방지: hysteresis(켜짐 <160px,
// 꺼짐 >160px+108px — 108px 는 일반 칩(140px)과 동그라미(32px)의 폭 차이).
// useAiChipClamp·useFoldAuxiliaryActions 와 같은 결 — ResizeObserver·window resize·body MutationObserver.
import { useCallback, useEffect, useState } from 'react'

/** 제목 자리 최소 폭(px) — 이보다 좁으면 동그라미. */
export const MIN_TITLE_SPACE = 160
/** 동그라미/풀기 임계 간격(px) — 일반 칩(140px)과 동그라미(32px)의 폭 차이. */
export const CIRCLE_HYSTERESIS = 108

/**
 * 제목 자리에 따른 동그라미 판정(hysteresis 포함). 진동 방지: 켜짐 <160px, 꺼짐 >160px+108px.
 * @param titleSpace 제목 자리 폭(px)
 * @param circle 현재 동그라미 상태
 * @returns 다음 동그라미 상태
 */
export function circleDecision(titleSpace: number, circle: boolean): boolean {
  if (titleSpace < MIN_TITLE_SPACE) return true
  if (titleSpace > MIN_TITLE_SPACE + CIRCLE_HYSTERESIS) return false
  return circle
}

/**
 * 제목 자리가 160px보다 좁으면 true(동그라미). 좌측 그룹([data-ai-left-group])이 없으면(헤더가 없는 화면) 항상 false.
 * 틀([data-ai-chip])의 left 를 실측해 제목 자리를 계산한다.
 */
export function useAiChipCircle(): boolean {
  const [circle, setCircle] = useState(false)
  const apply = useCallback(() => {
    const chip = document.querySelector<HTMLElement>('[data-ai-chip]')
    const leftGroup = document.querySelector<HTMLElement>('[data-ai-left-group]')
    if (!chip || !leftGroup) {
      setCircle(false)
      return
    }
    // jsdom 에서 getBoundingClientRect 이 0 을 주므로 동그라미가 아니다(테스트가 일반 칩을 찾게).
    if (chip.getBoundingClientRect().width === 0 || leftGroup.getBoundingClientRect().width === 0) {
      setCircle(false)
      return
    }
    const titleSpace = chip.getBoundingClientRect().left - leftGroup.getBoundingClientRect().left - 16
    // 함수형 업데이트로 최신 circle 을 본다(apply 가 stale 상태 를 포획하지 않게).
    setCircle(prev => circleDecision(titleSpace, prev))
  }, [])
  useEffect(() => {
    // DOM 실측 → 상태 동기화(합법 패턴) — useAiChipClamp 과 같은 결.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    apply()
    const ro = new ResizeObserver(apply)
    const chip = document.querySelector<HTMLElement>('[data-ai-chip]')
    const leftGroup = document.querySelector<HTMLElement>('[data-ai-left-group]')
    if (chip) ro.observe(chip)
    if (leftGroup) ro.observe(leftGroup)
    window.addEventListener('resize', apply)
    const mo = new MutationObserver(apply)
    mo.observe(document.body, { childList: true, subtree: true })
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', apply)
      mo.disconnect()
    }
  }, [apply])
  return circle
}
