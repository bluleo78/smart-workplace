// 모바일 캘린더 헤더 미니 달력(WP-136) — 헤더 제목 버튼(「10월 ▾」)을 누르면 헤더 바로 아래에 펼쳐져 본문을 밀어 내린다(시안 ③).
// 데스크톱 사이드바 미니 캘린더와 같은 ui/calendar·점 모양을 쓰되, 표시 월(month)은 본문 anchor 와 따로 둔다 —
// 패널 안에서 ‹ › 로 달을 넘겨 보는 동안 본문은 움직이지 않고, 날짜를 골랐을 때만 그 날로 이동한다.
import { miniCalendarDotClass } from '@/components/calendar/miniCalendarClass'
import { Calendar } from '@/components/ui/calendar'

interface MobileMiniCalendarPanelProps {
  /** 헤더 제목 버튼의 aria-controls 대상. */
  id: string
  /** 선택일 = 본문 anchor(채운 원). */
  selected: Date
  /** 패널이 보여 주는 달(패널 안 ‹ › 로만 바뀐다). */
  month: Date
  onMonthChange: (month: Date) => void
  /** 날짜를 고름 — 호출부가 anchor 를 옮기고 패널을 접는다. */
  onSelect: (day: Date) => void
  /** Esc — 호출부가 패널을 접고 포커스를 제목 버튼으로 돌려준다. */
  onEscape: () => void
  /** 표시 중인 달(6주 그리드)에서 일정·마감이 있는 날 — 점을 찍는다. */
  markedDates: Date[]
}

/** 헤더 아래 미니 달력 패널 — 일정 있는 날은 점, 오늘은 primary 글자, 고른 날은 채운 원(시안 ③). */
export function MobileMiniCalendarPanel({
  id,
  selected,
  month,
  onMonthChange,
  onSelect,
  onEscape,
  markedDates,
}: MobileMiniCalendarPanelProps) {
  return (
    <div
      id={id}
      data-testid="calendar-mobile-mini"
      className="shrink-0 border-b bg-background shadow-sm"
      // 패널 안(날짜 칸·‹ ›)에 포커스가 있을 때 Esc 로 접는다.
      onKeyDown={(e) => {
        if (e.key === 'Escape') onEscape()
      }}
    >
      <Calendar
        mode="single"
        // required — 이미 고른 날을 다시 눌러도 선택이 풀리지 않고 onSelect 가 와서(그 날로 다시 이동 + 접힘) 패널이 남지 않는다.
        required
        selected={selected}
        month={month}
        onMonthChange={onMonthChange}
        onSelect={onSelect}
        // 칸 40px — 손가락으로 누를 만한 크기를 지키면서 패널 높이(≈ 6주)를 줄여 아래 목록이 보이게 한다. 주 사이 간격도 좁힌다.
        // 고른 날은 둥근 사각형 대신 채운 원(시안).
        className="mx-auto px-2 pt-1 pb-2 [--cell-size:2.5rem] [&_[data-selected-single=true]]:rounded-full"
        classNames={{
          month: 'flex w-full flex-col gap-2',
          week: 'mt-0.5 flex w-full',
          // 오늘 = 배경 없이 primary 굵은 글자(시안 ③) — 채운 원은 고른 날 전용.
          today: 'font-bold text-primary',
        }}
        modifiers={{ hasItems: markedDates }}
        modifiersClassNames={{ hasItems: miniCalendarDotClass }}
      />
    </div>
  )
}
