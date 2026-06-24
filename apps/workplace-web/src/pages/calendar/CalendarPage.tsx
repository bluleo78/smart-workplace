import { addDays, addMonths, format, startOfDay } from 'date-fns'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

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
import { useMyIssueDues } from '@/hooks/queries/useMyIssueDues'
import { type CalendarLayers, loadLayers, saveLayers, visibleRange } from '@/lib/calendar'
import type {
  CalendarEvent,
  CalendarEventRequest,
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

/** 캘린더 페이지 — 뷰 전환·날짜 네비·일정 CRUD 를 통합 관리. */
export function CalendarPage() {
  const navigate = useNavigate()
  const [view, setView] = useState<CalendarViewType>('month')
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()))
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<CalendarEvent | null>(null)
  const [defaultStart, setDefaultStart] = useState<Date | undefined>()
  // 반복 회차 수정/삭제 시 scope 선택 다이얼로그 모드(null=닫힘) (이슈 #111)
  const [scopeMode, setScopeMode] = useState<'edit' | 'delete' | null>(null)
  // scope 선택 전까지 보류하는 수정 body
  const [pendingBody, setPendingBody] = useState<CalendarEventRequest | null>(null)
  // 단일 일정 삭제 확인 다이얼로그 표시 여부 (이슈 #128)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)

  // 사이드바 표시 레이어 토글 — localStorage 에서 초기화.
  const [layers, setLayers] = useState<CalendarLayers>(loadLayers)
  // saveLayers 를 setState 업데이터 밖에서 호출 — StrictMode 이중 실행(사이드 이펙트) 방지.
  const toggleLayer = (key: keyof CalendarLayers, value: boolean) => {
    const next = { ...layers, [key]: value }
    saveLayers(next)
    setLayers(next)
  }

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
      // 반복 회차(occurrenceDate 존재) → body 보류 후 EventDialog 닫고 scope 선택 다이얼로그 표시.
      if (editing.occurrenceDate != null) {
        setPendingBody(body)
        setDialogOpen(false)
        setScopeMode('edit')
        return
      }
      // 단일 일정 → scope 없이 바로 수정(서버 기본 ALL)
      update.mutate({ id: editing.id, body }, { onSuccess: () => setDialogOpen(false) })
    } else {
      create.mutate(body, { onSuccess: () => setDialogOpen(false) })
    }
  }

  const onDelete = () => {
    if (!editing) return
    // 반복 회차 → EventDialog 닫고 scope 선택 다이얼로그 표시.
    if (editing.occurrenceDate != null) {
      setDialogOpen(false)
      setScopeMode('delete')
      return
    }
    // 단일 일정 → EventDialog 닫고 삭제 확인 다이얼로그 표시. (이슈 #128)
    setDialogOpen(false)
    setConfirmDeleteOpen(true)
  }

  // 단일 일정 삭제 확인 후 실행
  const confirmDelete = () => {
    if (!editing) return
    remove.mutate({ id: editing.id }, { onSuccess: () => setConfirmDeleteOpen(false) })
    setConfirmDeleteOpen(false)
  }

  // scope 선택 후 실행 — 반복은 마스터 id 로, occurrenceDate 는 서버 값 그대로 전달.
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

  // scope 다이얼로그 취소 — 보류 상태 정리
  const cancelScope = () => {
    setScopeMode(null)
    setPendingBody(null)
  }

  // 이슈 마감 칩 클릭 → 해당 이슈 상세로 이동(읽기전용 오버레이).
  const openIssue = (m: IssueDueMarker) =>
    navigate(`/projects/${m.projectKey}/issues/${m.number}`)

  const viewProps = {
    events: layers.events ? events : [],
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

      {/* isPending: API 진행 중일 때 저장 버튼 비활성화 — 중복 제출 방지 (이슈 #130) */}
      <EventDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        event={editing ?? undefined}
        defaultStart={defaultStart}
        onSubmit={submit}
        onDelete={onDelete}
        isPending={create.isPending || update.isPending}
      />

      {/* 반복 회차 수정/삭제 시 적용 범위 선택 (이슈 #111) */}
      {scopeMode && (
        <RecurrenceScopeDialog
          open={!!scopeMode}
          mode={scopeMode}
          onPick={onPickScope}
          onCancel={cancelScope}
        />
      )}

      {/* 단일 일정 삭제 확인 다이얼로그 — 되돌릴 수 없으므로 confirm 필요 (이슈 #128) */}
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
            {/* 파괴적 작업임을 시각적으로 표시 */}
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
