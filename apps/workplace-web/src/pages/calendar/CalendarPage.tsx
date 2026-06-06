import { addDays, addMonths, format, startOfDay } from 'date-fns'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { CalendarSidebar } from '@/components/calendar/CalendarSidebar'
import { EventDialog } from '@/components/calendar/EventDialog'
import { AgendaView } from '@/components/calendar/views/AgendaView'
import { MonthView } from '@/components/calendar/views/MonthView'
import { DayView, WeekView } from '@/components/calendar/views/WeekView'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { useCalendarEvents } from '@/hooks/queries/useCalendarEvents'
import {
  useCreateEvent,
  useDeleteEvent,
  useUpdateEvent,
} from '@/hooks/queries/useCalendarMutations'
import { useMyIssueDues } from '@/hooks/queries/useMyIssueDues'
import { visibleRange } from '@/lib/calendar'
import type {
  CalendarEvent,
  CalendarEventRequest,
  CalendarViewType,
  IssueDueMarker,
} from '@/types/calendar'

// 뷰 전환 탭 목록 — key 는 CalendarViewType 과 대응
const VIEWS: { key: CalendarViewType; label: string }[] = [
  { key: 'month', label: '월' },
  { key: 'week', label: '주' },
  { key: 'day', label: '일' },
  { key: 'agenda', label: '목록' },
]

/** 캘린더 페이지 — 뷰 전환·날짜 네비·일정 CRUD 를 통합 관리. */
export function CalendarPage() {
  const navigate = useNavigate()
  const [view, setView] = useState<CalendarViewType>('month')
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()))
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<CalendarEvent | null>(null)
  const [defaultStart, setDefaultStart] = useState<Date | undefined>()

  // anchor·view 변경 시에만 from/to 재계산
  const { from, to } = useMemo(() => visibleRange(view, anchor), [view, anchor])
  const { data: events = [] } = useCalendarEvents(from, to)
  // 내게 할당된 이슈 마감일을 같은 가시 범위로 조회해 읽기전용 오버레이.
  const { data: issueDues = [] } = useMyIssueDues(from, to)

  const create = useCreateEvent()
  const update = useUpdateEvent()
  const remove = useDeleteEvent()

  // 방향(dir)과 현재 뷰에 따라 anchor 이동
  const step = (dir: 1 | -1) =>
    setAnchor((a) =>
      view === 'month' ? addMonths(a, dir) : addDays(a, view === 'day' ? dir : 7 * dir),
    )

  // 새 일정 다이얼로그 열기 (시작 시각 선택 시 전달)
  const openNew = (start?: Date) => {
    setEditing(null)
    setDefaultStart(start)
    setDialogOpen(true)
  }

  // 기존 일정 편집 다이얼로그 열기
  const openEdit = (e: CalendarEvent) => {
    setEditing(e)
    setDialogOpen(true)
  }

  // 생성·수정 공용 submit 핸들러
  const submit = (body: CalendarEventRequest) => {
    if (editing) {
      update.mutate({ id: editing.id, body }, { onSuccess: () => setDialogOpen(false) })
    } else {
      create.mutate(body, { onSuccess: () => setDialogOpen(false) })
    }
  }

  const onDelete = () => {
    if (editing) remove.mutate(editing.id, { onSuccess: () => setDialogOpen(false) })
  }

  // 이슈 마감 칩 클릭 → 해당 이슈 상세로 이동(읽기전용 오버레이).
  const openIssue = (m: IssueDueMarker) =>
    navigate(`/projects/${m.projectKey}/issues/${m.number}`)

  const viewProps = {
    events,
    issueDues,
    anchor,
    onSelectEvent: openEdit,
    onSelectIssue: openIssue,
    onCreateAt: openNew,
  }

  return (
    <>
      <CalendarSidebar onNew={() => openNew()} />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 상단 네비게이션 바 — 오늘/이전/다음 + 뷰 전환 */}
        <PageHeader
          icon={
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                data-testid="calendar-today"
                onClick={() => setAnchor(startOfDay(new Date()))}
              >
                오늘
              </Button>
              <Button
                variant="ghost"
                size="sm"
                data-testid="calendar-prev"
                onClick={() => step(-1)}
              >
                ‹
              </Button>
              <Button
                variant="ghost"
                size="sm"
                data-testid="calendar-next"
                onClick={() => step(1)}
              >
                ›
              </Button>
            </div>
          }
          title={<span data-testid="calendar-title">{format(anchor, 'yyyy년 M월')}</span>}
          actions={VIEWS.map((v) => (
            <Button
              key={v.key}
              size="sm"
              variant={view === v.key ? 'default' : 'ghost'}
              data-testid={`calendar-view-${v.key}-btn`}
              onClick={() => setView(v.key)}
            >
              {v.label}
            </Button>
          ))}
        />

        {/* 뷰 렌더링 */}
        {view === 'month' && <MonthView {...viewProps} />}
        {view === 'week' && <WeekView {...viewProps} />}
        {view === 'day' && <DayView {...viewProps} />}
        {view === 'agenda' && <AgendaView {...viewProps} />}
      </div>

      <EventDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        event={editing ?? undefined}
        defaultStart={defaultStart}
        onSubmit={submit}
        onDelete={onDelete}
      />
    </>
  )
}
