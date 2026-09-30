import { addDays, addMonths, format, startOfDay } from 'date-fns'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { useRegisterAiScreenContext } from '@/components/ai/screen-context/useAiScreenContext'
import { CalendarEditDialog } from '@/components/calendar/CalendarEditDialog'
import { CalendarSidebar } from '@/components/calendar/CalendarSidebar'
import { EventDialog } from '@/components/calendar/EventDialog'
import { RecurrenceScopeDialog } from '@/components/calendar/RecurrenceScopeDialog'
import { AgendaView } from '@/components/calendar/views/AgendaView'
import { MonthView } from '@/components/calendar/views/MonthView'
import { DayView, WeekView } from '@/components/calendar/views/WeekView'
import { PageHeader } from '@/components/layout/PageHeader'
import { MobileSidebarSheet } from '@/components/mobile/MobileSidebarSheet'
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
import { useCalendarEvent, useCalendarEvents } from '@/hooks/queries/useCalendarEvents'
import {
  useCreateEvent,
  useDeleteEvent,
  useUpdateEvent,
} from '@/hooks/queries/useCalendarMutations'
import { useCalendars, useCreateCalendar, useDeleteCalendar, useResetCalendarEvents, useUpdateCalendar } from '@/hooks/queries/useCalendars'
import { useMyIssueDues } from '@/hooks/queries/useMyIssueDues'
import { useIsMobile } from '@/hooks/useIsMobile'
import { buildCalendarContext } from '@/lib/aiScreenContext/builders/calendar'
import {
  CALENDAR_VIEWS,
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


/** 캘린더 페이지 — 뷰 전환·날짜 네비·일정 CRUD + 캘린더 컨테이너 CRUD + 필터를 통합 관리. */
export function CalendarPage() {
  const navigate = useNavigate()
  // 알림 딥링크(?eventId=) — 특정 일정으로 이동 + 상세 모달 자동 오픈 (#659).
  const [searchParams, setSearchParams] = useSearchParams()
  const deepLinkEventId = useMemo(() => {
    const raw = searchParams.get('eventId')
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  }, [searchParams])
  // 새 일정 딥링크(?new=true) — 홈 대시보드 "오늘 일정" 위젯 빈 상태 CTA(#653) 등에서 진입.
  const deepLinkNew = searchParams.get('new') === 'true'
  const [view, setView] = useState<CalendarViewType>('month')
  // 모바일(<lg) 헤더는 ☰·오늘‹›·🔔 가 이미 폭을 차지해 뷰 버튼 4개를 두면 제목이 잘린다 → 단일 선택 컨트롤로 축약.
  const isMobile = useIsMobile()
  // 모바일은 오늘/‹/› 좌우 여백을 줄여 제목 폭을 확보한다(375px 급 기기에서도 'yyyy년 MM월' 이 잘리지 않게). 데스크톱은 기본값.
  const navBtnClass = isMobile ? 'px-2' : undefined
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
  const { data: events = [], isSuccess: eventsLoaded } = useCalendarEvents(from, to)
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

  // WP-54: 캘린더 화면 컨텍스트 — 보기·기간·일정 수 + 열린 일정(다이얼로그).
  // 일정 수는 조회 성공 후에만 싣는다(로딩 중 0건으로 오인 방지). 다이얼로그가 닫히면 editing 이 남아 있어도 focus 를 뺀다.
  const openEditing = dialogOpen ? editing : null
  const screenContext = useMemo(
    () =>
      buildCalendarContext({
        view,
        from,
        to,
        count: eventsLoaded ? visibleEvents.length : undefined,
        creating: dialogOpen && editing == null,
        editing: openEditing
          ? {
              id: openEditing.id,
              masterEventId: openEditing.masterEventId ?? null,
              title: openEditing.title,
              startsAt: openEditing.startsAt,
              endsAt: openEditing.endsAt,
              allDay: openEditing.allDay,
              location: openEditing.location,
              calendarName: openEditing.calendarName,
              myRsvpStatus: openEditing.myRsvpStatus ?? null,
              occurrenceDate: openEditing.occurrenceDate ?? null,
            }
          : null,
      }),
    [view, from, to, eventsLoaded, visibleEvents.length, dialogOpen, editing, openEditing],
  )
  useRegisterAiScreenContext(screenContext)

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

  // 새 일정 딥링크(?new=true) 처리 — 진입 시 1회 다이얼로그 오픈 후 쿼리파라미터 정리(replace).
  useEffect(() => {
    if (!deepLinkNew) return
    openNew()
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('new')
        return next
      },
      { replace: true },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkNew])

  // 알림 딥링크로 지목된 일정 조회 — 성공 시 해당 날짜로 이동 + 상세 모달 자동 오픈,
  // 삭제됐거나 접근 권한 없으면(404/403) 조용히 /calendar 기본 화면으로 폴백 + 토스트 안내.
  // (반복 일정 회차를 가리키더라도 GET /events/{id} 는 마스터 일정을 반환하므로 회차 특정 없이
  //  마스터로 이동한다 — 사람 결정 지침 4항.)
  const { data: deepLinkEvent, isSuccess: deepLinkSuccess, isError: deepLinkFailed } =
    useCalendarEvent(deepLinkEventId)
  useEffect(() => {
    if (deepLinkEventId == null) return
    if (deepLinkSuccess && deepLinkEvent) {
      setAnchor(startOfDay(new Date(deepLinkEvent.startsAt)))
      openEdit(deepLinkEvent)
    } else if (deepLinkFailed) {
      toast.error('일정을 찾을 수 없거나 접근 권한이 없습니다')
    } else {
      return
    }
    // 처리 후 쿼리파라미터 정리 — 새로고침/뒤로가기 시 모달이 다시 열리지 않게 replace.
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('eventId')
        return next
      },
      { replace: true },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkEventId, deepLinkSuccess, deepLinkFailed, deepLinkEvent])

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
      {/* 모바일: 사이드바는 바텀시트(☰), 데스크톱: 기존 가로 배치 */}
      <MobileSidebarSheet
        title="캘린더"
        sidebar={
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
        }
      >
        <div className="flex min-w-0 flex-1 flex-col">
          {/* 상단 네비게이션 바 — 오늘/이전/다음 + 뷰 전환 */}
          <PageHeader
            icon={
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="calendar-today"
                  className={navBtnClass}
                  onClick={() => setAnchor(startOfDay(new Date()))}
                >
                  오늘
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid="calendar-prev"
                  className={navBtnClass}
                  // 글리프(‹)만으로는 accessible name이 무의미해 뷰별 구체적 라벨 지정 (#818).
                  // step() 은 month=한달, day=하루, 그 외(week/agenda)=7일 단위로 이동한다.
                  aria-label={view === 'month' ? '이전 달' : view === 'day' ? '이전 날' : '이전 주'}
                  onClick={() => step(-1)}
                >
                  ‹
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid="calendar-next"
                  className={navBtnClass}
                  aria-label={view === 'month' ? '다음 달' : view === 'day' ? '다음 날' : '다음 주'}
                  onClick={() => step(1)}
                >
                  ›
                </Button>
              </div>
            }
            title={<span data-testid="calendar-title">{format(anchor, 'yyyy년 M월')}</span>}
            actions={isMobile ? (
              // 모바일: 네이티브 select — OS 피커(iOS 휠)로 열리고 현재 뷰를 한 칸에 보여준다. 데스크톱 버튼 testid 는 그대로.
              <select
                data-testid="calendar-view-select"
                aria-label="보기 전환"
                value={view}
                onChange={(e) => setView(e.target.value as CalendarViewType)}
                className="h-9 shrink-0 rounded-md border bg-background px-2 text-sm"
              >
                {CALENDAR_VIEWS.map((v) => (
                  <option key={v.key} value={v.key}>{v.label}</option>
                ))}
              </select>
            ) : CALENDAR_VIEWS.map((v) => (
              <Button
                key={v.key}
                size="sm"
                variant={view === v.key ? 'default' : 'ghost'}
                // 시각적으로만(배경색) 표현되던 선택 상태를 프로그램적으로도 노출 (#818).
                aria-pressed={view === v.key}
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
      </MobileSidebarSheet>

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
