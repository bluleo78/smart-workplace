import { addDays, addMonths, format, startOfDay } from 'date-fns'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { CalendarEditDialog } from '@/components/calendar/CalendarEditDialog'
import { CalendarSidebar } from '@/components/calendar/CalendarSidebar'
import { EventDialog } from '@/components/calendar/EventDialog'
import { RecurrenceScopeDialog } from '@/components/calendar/RecurrenceScopeDialog'
import { AgendaView } from '@/components/calendar/views/AgendaView'
import { MonthView } from '@/components/calendar/views/MonthView'
import { DayView, WeekView } from '@/components/calendar/views/WeekView'
import { PageHeader } from '@/components/layout/PageHeader'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { useCalendarEvents } from '@/hooks/queries/useCalendarEvents'
import {
  useCreateEvent,
  useDeleteEvent,
  useUpdateEvent,
} from '@/hooks/queries/useCalendarMutations'
import { useCalendars, useCreateCalendar, useDeleteCalendar, useResetCalendarEvents, useUpdateCalendar } from '@/hooks/queries/useCalendars'
import { useMyIssueDues } from '@/hooks/queries/useMyIssueDues'
import {
  type CalendarLayers,
  eventsOnDay,
  isCalendarVisible,
  issueDuesOnDay,
  loadLayers,
  monthMatrix,
  saveLayers,
  toggleCalendar,
  visibleRange,
} from '@/lib/calendar'
import type {
  Calendar,
  CalendarEvent,
  CalendarEventRequest,
  CalendarRequest,
  CalendarViewType,
  EditScope,
  IssueDueMarker,
} from '@/types/calendar'

// 뷰 전환 탭 목록 — key 는 CalendarViewType 과 대응
const VIEWS: { key: CalendarViewType; label: string }[] = [
  { key: 'month', label: '월' },
  { key: 'week', label: '주' },
  { key: 'day', label: '일' },
  { key: 'agenda', label: '목록' },
]

/** 캘린더 페이지 — 뷰 전환·날짜 네비·일정 CRUD + 캘린더 컨테이너 CRUD + 필터를 통합 관리. */
export function CalendarPage() {
  const navigate = useNavigate()
  const [view, setView] = useState<CalendarViewType>('month')
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()))
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<CalendarEvent | null>(null)
  const [defaultStart, setDefaultStart] = useState<Date | undefined>()
  // 반복 회차 수정/삭제 시 scope 선택 다이얼로그 모드(null=닫힘)
  const [scopeMode, setScopeMode] = useState<'edit' | 'delete' | null>(null)
  // scope 선택 전까지 보류하는 수정 body
  const [pendingBody, setPendingBody] = useState<CalendarEventRequest | null>(null)
  // 단일 일정 삭제 확인 다이얼로그 표시 여부
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)

  // 캘린더 컨테이너 CRUD 다이얼로그 상태.
  const [calEditOpen, setCalEditOpen] = useState(false)
  const [editingCal, setEditingCal] = useState<Calendar | null>(null)

  // 사이드바 표시 레이어 토글 — localStorage 에서 초기화.
  const [layers, setLayers] = useState<CalendarLayers>(loadLayers)

  // 내 캘린더 목록.
  const { data: calendars = [] } = useCalendars()
  // 내 캘린더 id 집합 — filterByCalendar 에서 "내 캘린더인지" 판별.
  const myCalendarIds = useMemo(() => new Set(calendars.map((c) => c.id)), [calendars])

  const createCal = useCreateCalendar()
  const updateCal = useUpdateCalendar()
  const deleteCal = useDeleteCalendar()
  const resetCal = useResetCalendarEvents()
  // 리셋 확인 다이얼로그에 표시할 캘린더(null=닫힘).
  const [resettingCal, setResettingCal] = useState<Calendar | null>(null)

  // anchor·view 변경 시에만 from/to 재계산
  const { from, to } = useMemo(() => visibleRange(view, anchor), [view, anchor])
  const { data: events = [] } = useCalendarEvents(from, to)
  // 내게 할당된 이슈 마감일을 같은 가시 범위로 조회해 읽기전용 오버레이.
  const { data: issueDues = [] } = useMyIssueDues(from, to)

  // 미니 캘린더는 항상 anchor 의 한 달(6주 그리드)을 보여주므로, 본문 범위와 별개로
  // 그 그리드 범위의 일정/마감을 조회한다. 월 보기에선 from/to 가 본문과 같아 자동 dedup.
  const miniRange = useMemo(() => visibleRange('month', anchor), [anchor])
  const { data: miniEvents = [] } = useCalendarEvents(miniRange.from, miniRange.to)
  const { data: miniDues = [] } = useMyIssueDues(miniRange.from, miniRange.to)

  // 캘린더 표시 토글 + 초대받은 일정 토글 존중.
  // 내 캘린더(myCalendarIds) 면 캘린더별 토글, 아니면 invited 토글.
  const filterByCalendar = useMemo(
    () => (e: CalendarEvent) =>
      myCalendarIds.has(e.calendarId) ? isCalendarVisible(layers, e.calendarId) : layers.invited,
    [myCalendarIds, layers],
  )

  const visibleEvents = useMemo(() => events.filter(filterByCalendar), [events, filterByCalendar])

  // 점 찍을 날 — 표시 토글을 존중.
  const markedDates = useMemo(
    () =>
      monthMatrix(anchor).filter(
        (day) =>
          eventsOnDay(miniEvents.filter(filterByCalendar), day).length > 0 ||
          (layers.issueDues && issueDuesOnDay(miniDues, day).length > 0),
      ),
    [anchor, layers, miniEvents, miniDues, filterByCalendar],
  )

  const create = useCreateEvent()
  const update = useUpdateEvent()
  const remove = useDeleteEvent()

  // issueDues / invited 토글(keyof Pick 으로 타입 안전).
  const toggleLayer = (key: keyof Pick<CalendarLayers, 'issueDues' | 'invited'>, value: boolean) => {
    const next = { ...layers, [key]: value }
    saveLayers(next)
    setLayers(next)
  }

  // 캘린더 컨테이너 표시 토글.
  const onToggleCalendar = (id: number) => {
    const next = toggleCalendar(layers, id)
    saveLayers(next)
    setLayers(next)
  }

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
      if (editing.occurrenceDate != null) {
        setPendingBody(body)
        setDialogOpen(false)
        setScopeMode('edit')
        return
      }
      update.mutate({ id: editing.id, body }, { onSuccess: () => setDialogOpen(false) })
    } else {
      create.mutate(body, { onSuccess: () => setDialogOpen(false) })
    }
  }

  const onDelete = () => {
    if (!editing) return
    if (editing.occurrenceDate != null) {
      setDialogOpen(false)
      setScopeMode('delete')
      return
    }
    setDialogOpen(false)
    setConfirmDeleteOpen(true)
  }

  const confirmDelete = () => {
    if (!editing) return
    remove.mutate({ id: editing.id }, { onSuccess: () => setConfirmDeleteOpen(false) })
    setConfirmDeleteOpen(false)
  }

  const onPickScope = (scope: EditScope) => {
    if (!editing) return
    const id = editing.masterEventId ?? editing.id
    const occurrenceDate = editing.occurrenceDate
    if (scopeMode === 'edit' && pendingBody) {
      update.mutate({ id, body: pendingBody, scope, occurrenceDate })
    } else if (scopeMode === 'delete') {
      remove.mutate({ id, scope, occurrenceDate })
    }
    setScopeMode(null)
    setPendingBody(null)
  }

  const cancelScope = () => {
    setScopeMode(null)
    setPendingBody(null)
  }

  // 이슈 마감 칩 클릭 → 해당 이슈 상세로 이동(읽기전용 오버레이).
  const openIssue = (m: IssueDueMarker) =>
    navigate(`/projects/${m.projectKey}/issues/${m.number}`)

  // 캘린더 컨테이너 추가/수정 핸들러.
  const openAddCalendar = () => {
    setEditingCal(null)
    setCalEditOpen(true)
  }
  const openEditCalendar = (c: Calendar) => {
    setEditingCal(c)
    setCalEditOpen(true)
  }
  const submitCalendar = (body: CalendarRequest) => {
    if (editingCal) {
      updateCal.mutate({ id: editingCal.id, body }, { onSuccess: () => setCalEditOpen(false) })
    } else {
      createCal.mutate(body, { onSuccess: () => setCalEditOpen(false) })
    }
  }
  const deleteCalendar = () => {
    if (!editingCal) return
    deleteCal.mutate(editingCal.id, { onSuccess: () => setCalEditOpen(false) })
  }

  // 케밥 "모든 일정 삭제" → 확인 다이얼로그 오픈.
  const openResetCalendar = (c: Calendar) => setResettingCal(c)
  // 확인 → 리셋 실행 후 다이얼로그 닫기.
  const confirmResetCalendar = () => {
    if (!resettingCal) return
    resetCal.mutate(resettingCal.id, { onSuccess: () => setResettingCal(null) })
  }

  const viewProps = {
    events: visibleEvents,
    issueDues: layers.issueDues ? issueDues : [],
    anchor,
    onSelectEvent: openEdit,
    onSelectIssue: openIssue,
    onCreateAt: openNew,
  }

  return (
    <>
      <CalendarSidebar
        onNew={() => openNew()}
        anchor={anchor}
        onSelectDate={(d) => setAnchor(startOfDay(d))}
        layers={layers}
        onToggleLayer={toggleLayer}
        calendars={calendars}
        onToggleCalendar={onToggleCalendar}
        onAddCalendar={openAddCalendar}
        onEditCalendar={openEditCalendar}
        onResetCalendar={openResetCalendar}
        markedDates={markedDates}
      />
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

      {/* 일정 생성/편집 다이얼로그 */}
      <EventDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        event={editing ?? undefined}
        defaultStart={defaultStart}
        onSubmit={submit}
        onDelete={onDelete}
        isPending={create.isPending || update.isPending}
      />

      {/* 캘린더 컨테이너 추가/편집 다이얼로그 */}
      <CalendarEditDialog
        open={calEditOpen}
        onOpenChange={setCalEditOpen}
        calendar={editingCal}
        onSubmit={submitCalendar}
        onDelete={deleteCalendar}
        isPending={createCal.isPending || updateCal.isPending}
      />

      {/* 반복 회차 수정/삭제 시 적용 범위 선택 */}
      {scopeMode && (
        <RecurrenceScopeDialog
          open={!!scopeMode}
          mode={scopeMode}
          onPick={onPickScope}
          onCancel={cancelScope}
        />
      )}

      {/* 캘린더 강제 리셋(모든 일정 삭제) 확인 다이얼로그 */}
      <AlertDialog open={resettingCal != null} onOpenChange={(o) => !o && setResettingCal(null)}>
        <AlertDialogContent data-testid="calendar-reset-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>모든 일정 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              {resettingCal?.name}의 모든 일정을 영구 삭제합니다. 되돌릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              data-testid="calendar-reset-confirm-submit"
              variant="destructive"
              onClick={confirmResetCalendar}
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 단일 일정 삭제 확인 다이얼로그 */}
      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent data-testid="calendar-confirm-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>일정 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              정말 삭제하시겠습니까? 되돌릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="calendar-confirm-delete-cancel">취소</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              data-testid="calendar-confirm-delete-confirm"
              onClick={confirmDelete}
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
