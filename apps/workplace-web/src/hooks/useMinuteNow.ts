// 분 단위로 갱신되는 "지금" — 화면을 열어 둔 채(PWA) 시간이 흘러도 지금 선·끝난 일정 흐림·오늘 판정이 따라가게 한다(WP-136 A4).
// 1분마다, 그리고 탭·앱으로 돌아왔을 때(visibilitychange — 백그라운드에선 타이머가 멈추거나 늦어진다) 다시 읽는다.
// 같은 분이면 이전 Date 를 그대로 돌려 재렌더하지 않는다.
import { useEffect, useState } from 'react'

const MINUTE_MS = 60_000

/** enabled 인 동안만 타이머·리스너를 단다(꺼져 있으면 마지막 값 그대로). 켜질 때 한 번 즉시 다시 읽는다. */
export function useMinuteNow(enabled: boolean): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    if (!enabled) return
    const tick = () =>
      setNow((prev) => {
        const next = new Date()
        return Math.floor(next.getTime() / MINUTE_MS) === Math.floor(prev.getTime() / MINUTE_MS) ? prev : next
      })
    // 꺼져 있던 동안(다른 보기) 흐른 시간을 바로 반영한다 — 다음 tick(최대 1분)까지 낡은 지금으로 그리지 않게.
    tick()
    const id = window.setInterval(tick, MINUTE_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled])
  return now
}
