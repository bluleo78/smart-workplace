// 캘린더 공용 현재 시각 선(WP-1557) — 모바일 일정 목록(MobileAgendaView)과 주·일 보기 시간 그리드(TimeGrid)가 같은 모양을 쓴다.
// 빨간 선 + 왼쪽 끝 점. 위치(여백·절대 배치·top)는 쓰는 쪽이 className·style 로 정한다.
import type { CSSProperties } from 'react'

interface NowLineProps {
  /** data-testid — 목록은 calendar-agenda-now, 시간 그리드는 calendar-grid-now */
  testid: string
  /** 위치·쌓임 클래스 — 선 색·두께는 여기서 고정한다 */
  className?: string
  /** 절대 배치일 때 top 등 */
  style?: CSSProperties
}

/** 현재 시각 선 — 스크린 리더에는 「현재 시각」 구분선으로 읽힌다. */
export function NowLine({ testid, className = '', style }: NowLineProps) {
  return (
    <div
      data-testid={testid}
      role="separator"
      aria-label="현재 시각"
      className={`${className} border-t-2 border-destructive`}
      style={style}
    >
      <span className="absolute -top-[5px] -left-1 size-2 rounded-full bg-destructive" aria-hidden="true" />
    </div>
  )
}
