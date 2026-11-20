// 주간 뷰 — TimeGrid에 weekDays(anchor) 7열을 넘긴다. 작업주 뷰(월~금 5열)도 함께 export.
// DayView(일간 뷰)도 함께 export — anchor 날 하루 컬럼.
import { startOfDay } from 'date-fns'

import { weekDays, workWeekDays } from '@/lib/calendar'

import { TimeGrid, type ViewProps } from './TimeGrid'

// 주간 뷰: 해당 주(일~토) 7일 컬럼
export function WeekView(props: ViewProps) {
  return <TimeGrid {...props} days={weekDays(props.anchor)} testid="calendar-view-week" />
}

// 작업주 뷰: 해당 주 월~금 5일 컬럼(WP-1815).
// 열 너비는 TimeGrid 의 flex-1 이 나눠 7열보다 넓어지고, 끌기는 열 요소 기준이라 그대로 동작한다.
export function WorkWeekView(props: ViewProps) {
  return <TimeGrid {...props} days={workWeekDays(props.anchor)} testid="calendar-view-workweek" />
}

// 일간 뷰: anchor 날 단일 컬럼
export function DayView(props: ViewProps) {
  return <TimeGrid {...props} days={[startOfDay(props.anchor)]} testid="calendar-view-day" />
}
