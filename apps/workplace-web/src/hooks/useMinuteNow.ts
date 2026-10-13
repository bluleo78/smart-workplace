// 주기적으로 갱신되는 "지금" — 화면을 열어 둔 채(PWA) 시간이 흘러도 지금 선·끝난 일정 흐림·오늘 판정이 따라가게 한다(WP-136).
// 1분마다, 그리고 탭·앱으로 돌아왔을 때(백그라운드에선 타이머가 멈추거나 늦어진다) 다시 읽는다.
import { isSameDay } from 'date-fns'
import { useLayoutEffect, useState } from 'react'

const MINUTE_MS = 60_000

/** 갱신 단위 — 'minute' 은 분이 바뀔 때, 'day' 는 날짜가 바뀔 때만 새 값(그 사이엔 재렌더 없음), null 이면 멈춤. */
export type NowResolution = 'minute' | 'day' | null

/** 같은 단위 구간인지 — 같으면 이전 Date 를 그대로 둬 재렌더·memo 무효화를 막는다. */
function sameBucket(a: Date, b: Date, resolution: 'minute' | 'day'): boolean {
  if (resolution === 'minute') return Math.floor(a.getTime() / MINUTE_MS) === Math.floor(b.getTime() / MINUTE_MS)
  return isSameDay(a, b)
}

/**
 * now 와 화면 복귀 횟수(resumeCount)를 함께 돌려준다 — 복귀 때 now 갱신과 복귀 신호가 한 상태 갱신으로 반영돼
 * 호출부의 렌더 중 판정(자정 따라가기)에 순서 경합이 없다. 켜지거나 단위가 바뀌면 페인트 전에 한 번 다시 읽는다.
 */
export function useMinuteNow(resolution: NowResolution): { now: Date; resumeCount: number } {
  const [state, setState] = useState(() => ({ now: new Date(), resumeCount: 0 }))
  useLayoutEffect(() => {
    if (!resolution) return
    const read = (resumed: boolean) =>
      setState((prev) => {
        const next = new Date()
        const now = sameBucket(prev.now, next, resolution) ? prev.now : next
        if (!resumed && now === prev.now) return prev
        return { now, resumeCount: prev.resumeCount + (resumed ? 1 : 0) }
      })
    // 꺼져 있던 동안(데스크톱·다른 보기) 흐른 시간을 바로 반영한다 — 낡은 지금으로 한 프레임 그리지 않게 레이아웃 effect.
    read(false)
    const id = window.setInterval(() => read(false), MINUTE_MS)
    // 복귀 횟수는 분 단위(목록 보기)일 때만 센다 — 자정 따라가기 판정은 목록 안에서만 의미가 있다.
    const onVisible = () => {
      if (document.visibilityState === 'visible') read(resolution === 'minute')
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [resolution])
  return state
}
