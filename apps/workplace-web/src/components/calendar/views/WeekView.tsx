// 주간 뷰 — TimeGrid에 weekDays(anchor) 7열을 넘긴다.
// DayView(일간 뷰)도 함께 export — anchor 날 하루 컬럼.
import { startOfDay } from 'date-fns'

import { weekDays } from '@/lib/calendar'

import { TimeGrid, type ViewProps } from './TimeGrid'

// 주간 뷰: 해당 주(일~토) 7일 컬럼
export function WeekView(props: ViewProps) {
  return <TimeGrid {...props} days={weekDays(props.anchor)} testid="calendar-view-week" />
}

// 일간 뷰: anchor 날 단일 컬럼
export function DayView(props: ViewProps) {
  return <TimeGrid {...props} days={[startOfDay(props.anchor)]} testid="calendar-view-day" />
}
