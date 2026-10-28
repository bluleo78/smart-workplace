// 일정 생성/편집 다이얼로그.
// event prop 이 있으면 편집 모드, 없으면 생성 모드.
// 폼은 이름표 대신 아이콘 줄(배치 B — Google·Outlook·Notion 방식)이고, 상세 보기(EventDetailView)와 같은 아이콘·순서다:
// 제목 → 시간(종일·반복) → 장소 → 참석자 → 알림 → 캘린더(점을 눌러 색) → 태그 → 설명.
import { zodResolver } from '@hookform/resolvers/zod'
import { AlignLeft, Bell, Calendar as CalendarIcon, Clock, MapPin, Repeat, Users } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'

import { useAiPanelAwareDialog } from '@/components/ai/useAiPanelAwareDialog'
import { AttendeeSection, type SelectedMember } from '@/components/calendar/AttendeeSection'
import { EventDetailView } from '@/components/calendar/EventDetailView'
import { EventFormRow, FORM_CHIP_LINE_CLASS } from '@/components/calendar/EventFormRow'
import { EventRangeInputs } from '@/components/calendar/EventRangeInputs'
import { EventTagsField } from '@/components/calendar/EventTagsField'
import { JoinMeetingButton } from '@/components/calendar/JoinMeetingButton'
import { PaletteSwatches } from '@/components/calendar/PaletteSwatches'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/overlay/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/overlay/select'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useCalendarEvent } from '@/hooks/queries/useCalendarEvent'
import {
  useInviteAttendees,
  useRemoveAttendee,
} from '@/hooks/queries/useCalendarMutations'
import { useCalendars } from '@/hooks/queries/useCalendars'
import { useAuth } from '@/hooks/useAuth'
import { INVITED_CALENDAR_LABEL } from '@/lib/calendar'
// 폼 스키마·요청 조립·편집 가능 판정은 @/lib/calendarEventForm 의 순수 함수(WP-412)
import {
  allDayFormRange,
  eventEditability,
  eventFormSchema,
  type EventFormValues as FormValues,
  keepStoredAllDayInstants,
  normalizeAllDayRange,
  recurrenceToFormValues,
  restoreTimedRange,
  shouldShowRsvp,
  toEventRequest,
} from '@/lib/calendarEventForm'
import { reminderLabel } from '@/lib/calendarEventView'
import { resolvePalette } from '@/lib/calendarPalette'
import { changedTagIds, eventTagHint } from '@/lib/calendarTag'
import { HIT_AREA_COARSE_TIGHT } from '@/lib/hitArea'
import { isFormEditableRRule, parseRRule, recurrenceUnitLabel } from '@/lib/recurrence'
import { cn } from '@/lib/utils'
import type { CalendarEvent, CalendarEventRequest, CalendarTagRef } from '@/types/calendar'

// ────────────────────────────────────────────────────────────
// ISO(UTC) ↔ datetime-local 변환 헬퍼
// ────────────────────────────────────────────────────────────

/** Date → datetime-local 문자열 (YYYY-MM-DDTHH:mm, 로컬 시각) */
function dateToLocalInput(d: Date): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

/** ISO(UTC) → datetime-local 문자열 */
function toLocalInput(iso: string): string {
  return dateToLocalInput(new Date(iso))
}

// ────────────────────────────────────────────────────────────
// Props
// ────────────────────────────────────────────────────────────
interface EventDialogProps {
  open: boolean
  onOpenChange: (o: boolean) => void
  /** 편집 모드: 이벤트 객체 제공 */
  event?: CalendarEvent | null
  /** 생성 모드: 기본 시작 시각 (미제공 시 현재 시각) */
  defaultStart?: Date
  /** 생성 모드: 기본 종료 시각 — 시간 그리드에서 구간을 끌어 열 때(WP-949). 없으면 시작 + 1시간 */
  defaultEnd?: Date
  /**
   * 저장 — 폼에서 고른 태그가 처음과 달라졌을 때만 body.tagIds 가 실린다(아니면 빠져 서버가 태그를 건드리지 않는다).
   * 태그는 일정 저장과 한 요청이라 반복 범위(「이후 모든 일정」의 새 시리즈 등)를 서버가 맞춘다(WP-801).
   */
  onSubmit: (body: CalendarEventRequest) => void
  /** 편집 모드에서만 제공 — 삭제 버튼 표시 */
  onDelete?: () => void
  /** API 요청 진행 중 여부 — true 이면 저장 버튼 비활성화 + 로딩 텍스트 표시 (이슈 #130) */
  isPending?: boolean
}

// ────────────────────────────────────────────────────────────
// 컴포넌트
// ────────────────────────────────────────────────────────────
export function EventDialog({
  open,
  onOpenChange,
  event,
  defaultStart,
  defaultEnd,
  onSubmit,
  onDelete,
  isPending = false,
}: EventDialogProps) {
  const isEdit = !!event
  const { user } = useAuth()

  // 개인 캘린더 목록 — 드롭다운에 표시. 로드 전은 빈 배열.
  const { data: calendars = [], isSuccess: calendarsLoaded } = useCalendars()

  // 기본 캘린더 id — isDefault=true 우선, 없으면 첫 번째.
  const defaultCalendarId = calendars.find((c) => c.isDefault)?.id ?? calendars[0]?.id

  // 생성 모드에서 선택된 참석자 목록 — id+이름+종류 저장으로 칩에 실명 표시 (이슈 #489)
  const [selectedAttendees, setSelectedAttendees] = useState<SelectedMember[]>([])

  // 폼에서 바꾼 태그 — 손대기 전엔 null 이고 화면은 상세 응답의 태그를 그대로 보인다(열 때마다 null 로).
  // 상세가 늦게 오거나 다시 조회돼도 effect 로 옮겨 담지 않아, 사용자가 바꾼 선택을 덮지 않는다.
  const [touchedTags, setTouchedTags] = useState<CalendarTagRef[] | null>(null)

  // 색 팝오버(캘린더 칸의 점) 열림
  const [colorOpen, setColorOpen] = useState(false)

  // 잠긴 반복 규칙(isFormEditableRRule=false)을 사용자가 풀었는지 — 열 때마다 다시 잠긴다(WP-708)
  const [recurrenceUnlocked, setRecurrenceUnlocked] = useState(false)

  // 다이얼로그 요소 — 상세 보기가 열릴 때 닫기 버튼 대신 다이얼로그 자체에 포커스를 둔다(WP-708)
  const contentRef = useRef<HTMLDivElement>(null)

  // 동기적 in-flight 가드 — ref 는 즉시(리렌더 없이) 반영되므로 저장 버튼을 같은
  // 이벤트 루프 틱 내에 두 번 클릭해도(isPending prop 이 아직 갱신되기 전) 두 번째
  // form submit 을 차단한다. isPending(state)만으로는 dblclick 을 막지 못함 (이슈 #584).
  const submittingRef = useRef(false)
  // 「종일」을 체크하기 직전의 시작·종료 — 체크가 시각을 자정으로 덮어쓰므로, 풀 때 되살릴 원래 시각을 여기 둔다(WP-711).
  const timedRangeRef = useRef<{ start: string; end: string } | null>(null)

  // 편집 모드에서 상세 데이터(attendees 포함) 로드 — 목록 이벤트에는 attendees 가 없음 (이슈 #489)
  const { data: detailEvent } = useCalendarEvent(isEdit && open ? event?.id : undefined)
  // detailEvent 가 있으면 그것을, 없으면 prop event 를 사용 (생성 모드 / 로딩 중).
  // 시각은 누른 회차(목록 이벤트)에서 — 반복 일정의 상세는 시리즈 마스터라, 그대로 쓰면 11/6 회차를 눌러도 첫 회차 날짜가 보였다(WP-708).
  const eventWithDetail =
    detailEvent && event
      ? { ...detailEvent, startsAt: event.startsAt, endsAt: event.endsAt, occurrenceDate: event.occurrenceDate }
      : (detailEvent ?? event)

  // 읽기전용(외부 읽기전용 캘린더 #501 / 주최자 아님 WP-200)·사유 라벨·참석자 관리 가능 여부.
  // 이벤트 API 응답을 건드리지 않고 내 캘린더 목록에서 derive 한다.
  const { isReadOnly, readOnlyLabel, canManageAttendees, isInvited } = eventEditability({
    isEdit,
    calendars,
    event,
    detailEvent,
  })

  // 편집 모드 참석자 invite/remove 뮤테이션 — eventId 0 은 dummy(생성 모드에서 훅 호출 유지) (이슈 #489)
  const inviteAttendees = useInviteAttendees(event?.id ?? 0)
  const removeAttendee = useRemoveAttendee(event?.id ?? 0)

  const dialogTitle = isEdit ? '일정 수정' : '새 일정'

  // 현재 사용자가 참석자이고 주최자·AGENT·외부 일정이 아닌 경우 RSVP 컨트롤 표시 (이슈 #489, #547)
  const showRsvp = shouldShowRsvp(isEdit, user?.id, eventWithDetail)

  // 읽기 전용이면 편집 폼 대신 상세 보기(WP-708) — 입력칸 없이 아이콘 행으로 보여 주고 본문만 스크롤한다.
  // isReadOnly 는 편집 모드에서만 참이라 eventWithDetail 은 늘 있다 — != null 은 아래 JSX 의 타입 좁히기용.
  const showDetail = isReadOnly && eventWithDetail != null

  // WP-54: AI 사이드 패널과 공존하는 다이얼로그 props(side 모드면 non-modal + 페이지 영역 dim).
  // 폼은 한 단계 넓은 폭(form) — 기본 폭으로 덮이면 사이드 패널을 연 데스크톱에서 시작·종료가 한 줄에 안 들어갔다(WP-801).
  const aiAware = useAiPanelAwareDialog({ open, size: showDetail ? 'default' : 'form' })
  const form = useForm<FormValues>({
    resolver: zodResolver(eventFormSchema),
    defaultValues: {
      title: '',
      allDay: false,
      start: '',
      end: '',
      location: '',
      description: '',
      reminderMinutes: 'none',
      recurrenceFreq: 'NONE',
      recurrenceInterval: 1,
      recurrenceEnd: 'none',
      recurrenceUntil: '',
      recurrenceCount: 1,
      calendarId: undefined,
      color: null,
    },
  })

  // 화면이 따라 그리는 칸만 구독한다 — form.watch 는 어느 칸이 바뀌어도(제목 한 글자마다) 다이얼로그 전체를 다시 그렸다(WP-801).
  const [watchedCalendarId, color, recurrenceFreq, recurrenceEnd, reminderMinutes, allDay] = useWatch({
    control: form.control,
    name: ['calendarId', 'color', 'recurrenceFreq', 'recurrenceEnd', 'reminderMinutes', 'allDay'],
  })
  // 색 점의 「상속」 색 — 고른 캘린더의 색(목록 로드 전·내 목록에 없으면 일정의 실제 색)
  const calendarColor = calendars.find((c) => c.id === watchedCalendarId)?.color ?? event?.effectiveColor ?? null

  // 다이얼로그가 열릴 때마다 폼 초기화 + 참석자 선택 초기화
  useEffect(() => {
    if (!open) return
    // 다이얼로그를 새로 열 때마다 in-flight 가드 초기화 — 재오픈 시 이전 제출 잔재 방지.
    submittingRef.current = false
    timedRangeRef.current = null
    // 생성 모드 진입 시 참석자 선택 초기화
    if (!event) setSelectedAttendees([])
    // 태그·색 팝오버도 열 때마다 처음부터 — 「취소」로 닫은 선택이 다음에 남지 않게
    setTouchedTags(null)
    setColorOpen(false)

    // 반복 규칙(RRULE) → 평탄한 폼 필드로 변환. 생성 모드(이벤트 없음)면 NONE 기본값.
    // 폼이 담을 수 없는 규칙이면 반복 칸이 잠겨 보이지 않으므로 NONE 으로 둔다 — 숨은 칸(종료일 등) 검증에 걸려 저장이 조용히 막히지 않게(WP-708).
    setRecurrenceUnlocked(false)
    const rule = event?.recurrenceRule ?? null
    const recFields = recurrenceToFormValues(parseRRule(isFormEditableRRule(rule) ? rule : null, event?.startsAt))

    if (event) {
      // 편집 모드: 기존 이벤트 데이터로 프리필
      form.reset({
        title: event.title,
        allDay: event.allDay,
        // 종일은 저장 규약(동기화 UTC 자정·로컬 자정)과 무관하게 의도한 날짜로 — 시각으로 풀면 UTC 자정 종일이 09:00 으로 보였다(WP-1072).
        ...(event.allDay ? allDayFormRange(event) : { start: toLocalInput(event.startsAt), end: toLocalInput(event.endsAt) }),
        location: event.location ?? '',
        description: event.description ?? '',
        reminderMinutes: (event.reminderMinutes?.toString() ??
          'none') as FormValues['reminderMinutes'],
        // 캘린더·색 복원 — color=null 이면 상속 칩 활성 상태로 복원
        calendarId: event.calendarId,
        color: event.color ?? null,
        ...recFields,
      })
    } else {
      // 생성 모드: defaultStart(또는 현재 시각) 기준으로 초기화. 종료 = defaultEnd(끈 구간), 없으면 시작 + 1시간
      const startDate = defaultStart ?? new Date()
      const endDate = defaultEnd ?? new Date(startDate.getTime() + 60 * 60 * 1000)
      form.reset({
        title: '',
        allDay: false,
        start: dateToLocalInput(startDate),
        end: dateToLocalInput(endDate),
        location: '',
        description: '',
        reminderMinutes: 'none',
        // 생성 모드: 기본 캘린더 프리필. calendars 로드 전이면 undefined 유지.
        calendarId: defaultCalendarId,
        color: null,
        ...recFields,
      })
    }
  }, [open, event, defaultStart, defaultEnd, form])

  // mutation 이 끝나면(성공 또는 실패) in-flight 가드 해제 — 실패 시 다이얼로그가
  // 그대로 유지되므로 재시도가 가능해야 한다.
  useEffect(() => {
    if (!isPending) submittingRef.current = false
  }, [isPending])

  // 생성 모드: 캘린더 목록이 늦게 로드되면 기본 캘린더만 채운다(전체 reset 금지 — 사용자 입력 보존).
  useEffect(() => {
    if (open && !isEdit && defaultCalendarId != null && form.getValues('calendarId') == null) {
      form.setValue('calendarId', defaultCalendarId)
    }
  }, [open, isEdit, defaultCalendarId, form])

  // 폼이 담을 수 없는 반복 규칙(여러 요일·매년 등, MCP 로 만든 일정) — 반복 칸을 잠그고 저장 때 원래 규칙을 그대로 보낸다(WP-708).
  // 예전엔 BYDAY 가 빠진 채 저장되거나 YEARLY 가 「반복 없음」으로 저장돼 반복이 사라졌다.
  // 「새 규칙으로 바꾸기」를 누르면 잠금을 풀고 폼으로 담을 수 있는 만큼 채워 새 규칙(또는 반복 없음)으로 저장하게 한다.
  // (isFormEditableRRule 은 반복 없음·생성 모드(undefined)에 true 라 잠기지 않는다)
  const lockedRecurrenceRule =
    !recurrenceUnlocked && !isFormEditableRRule(event?.recurrenceRule) ? (event?.recurrenceRule ?? null) : null

  /** 잠긴 반복 규칙을 풀고, 폼이 담을 수 있는 부분(빈도·간격·종료)으로 반복 칸을 채운다 — 여러 요일 등은 빠진다고 안내한 뒤. */
  function unlockRecurrence() {
    const fields = recurrenceToFormValues(parseRRule(event?.recurrenceRule ?? null, event?.startsAt))
    form.setValue('recurrenceFreq', fields.recurrenceFreq)
    form.setValue('recurrenceInterval', fields.recurrenceInterval)
    form.setValue('recurrenceEnd', fields.recurrenceEnd)
    form.setValue('recurrenceUntil', fields.recurrenceUntil)
    form.setValue('recurrenceCount', fields.recurrenceCount)
    setRecurrenceUnlocked(true)
  }

  // 태그 — 폼 상태다(체크해도 바로 저장하지 않고 「수정」·「저장」 때 보낸다). 새 일정도 고를 수 있다(만든 뒤 그 id 로 붙인다).
  // 기존 일정은 상세 응답(마스터 태그·tagsEditable)이 출발점 — 상세 전엔 저장 버튼이 막혀 있어 비교 기준이 늘 상세다.
  const initialTags = isEdit ? (detailEvent?.tags ?? []) : []
  const formTags = touchedTags ?? initialTags
  const tagsEditable = isEdit ? (detailEvent?.tagsEditable ?? false) : true
  // 편집 모드는 상세가 와야 태그 줄을 그린다(목록 이벤트엔 태그 수정 가능 여부가 없다)
  const showTags = !isEdit || detailEvent != null

  // 참석자 줄 — 기존 일정은 상세(주최자 여부·참석자)가 와야 판정된다. 그 전엔 자리표시(attendeesLoading),
  // 그 뒤엔 관리할 수 있거나(주최자) 참석자가 있을 때만 보인다(showAttendees)
  const attendeesLoading = isEdit && !detailEvent
  const showAttendees = !isEdit || canManageAttendees || (eventWithDetail?.attendees?.length ?? 0) > 0

  // 폼 제출 핸들러
  function handleSubmit(values: FormValues) {
    // 동기적 중복 제출 가드 — 이미 제출 중이면 no-op (dblclick 등으로 인한 중복 생성 방지, 이슈 #584)
    if (submittingRef.current) return
    submittingRef.current = true

    // 참석자 id 는 생성 모드에서만 담긴다 — 칩 표시용 이름은 제외하고 id 만 (이슈 #489)
    const body = keepStoredAllDayInstants(
      toEventRequest(values, {
        isEdit,
        defaultCalendarId,
        attendeeUserIds: selectedAttendees.map((m) => m.id),
        lockedRecurrenceRule,
      }),
      values,
      event,
    )
    // 태그는 바뀌었을 때만 싣는다(빈 목록 = 모두 떼기도 바뀐 것) — 안 바뀐 저장이 Outlook 범주를 다시 쓰지 않게.
    // 붙일 수 없는 일정(공유받은 읽기 전용 M365 달력)은 싣지 않는다 — 칩이 읽기 전용이라 바뀔 일도 없다
    const tagIds = tagsEditable
      ? changedTagIds(
          initialTags.map((t) => t.id),
          formTags.map((t) => t.id),
        )
      : null
    onSubmit(tagIds ? { ...body, tagIds } : body)
  }

  // 편집 모드에서 상세(주최자 여부)·캘린더 목록(초대 여부)이 오기 전엔 읽기 전용인지 아직 모른다 — 이때 폼 칸에 자동 포커스를 주면
  // 휴대폰 키보드가 떴다가 상세 보기로 바뀌며 내려가고, 포커스가 사라진 칸을 따라 body 로 떨어진다(WP-604).
  // 상세 보기·판정 전에는 다이얼로그 자체(폼↔상세가 바뀌어도 그대로 남는 요소)에 포커스를 둔다.
  const focusDialogOnOpen = showDetail || (isEdit && (!detailEvent || !calendarsLoaded))

  return (
    // WP-54: AI 사이드 패널이 열려 있으면 non-modal — 다이얼로그를 연 채 "이 회의…" 를 AI 에 물을 수 있다.
    <Dialog open={open} onOpenChange={onOpenChange} modal={aiAware.modal}>
      {aiAware.overlay}
      <DialogContent
        data-testid="calendar-event-dialog"
        // 상세 보기는 본문 스크롤·응답 줄 고정을 위해 세로 flex — 여백은 EventDetailView 안쪽이 맡는다.
        // 폼은 한 단계 넓게(sm:max-w-xl) — 아이콘 줄에서 시작·종료 datetime-local 두 칸이 한 줄에 들어가게(한국어 표기 「2026. 10. 19. 오전 10:00」 기준).
        // 높이는 화면 안(85vh·위아래 1rem)으로 — 휴대폰 하단 탭바가 보이면 index.css 「하단 탭바 위 대화상자」가 탭바 위 영역 가운데로 옮기고
        // 높이도 그 안으로 줄인다(WP-801→WP-806 공용화). 휴대폰 폼은 여백·줄 간격을 줄인다.
        className={cn(
          'max-h-[min(85vh,calc(100dvh-2rem))]',
          showDetail ? 'flex flex-col gap-0 p-0' : 'overflow-y-auto max-sm:gap-3 max-sm:p-4 sm:max-w-xl',
          aiAware.contentClassName,
        )}
        {...aiAware.contentProps}
        // 상세 보기는 입력칸이 없어 첫 포커스가 닫기(✕)로 가 열자마자 포커스 테두리가 보였다 — 다이얼로그 자체에 포커스를 둔다.
        // AI 패널 모드 전환으로 다시 마운트될 땐(aiAware 가 기본 동작을 막음) 패널 입력창 포커스를 지킨다.
        onOpenAutoFocus={(e) => {
          aiAware.contentProps.onOpenAutoFocus(e)
          if (!focusDialogOnOpen || e.defaultPrevented) return
          e.preventDefault()
          contentRef.current?.focus()
        }}
        ref={contentRef}
      >
        {showDetail ? (
          <EventDetailView
            event={eventWithDetail}
            // 캘린더 칩 — 초대받은 일정이면 「초대받은 일정」, 내 캘린더면 그 이름. 목록 로드 전엔 판정할 수 없어 숨긴다(WP-604)
            calendarLabel={!calendarsLoaded ? null : isInvited ? INVITED_CALENDAR_LABEL : eventWithDetail.calendarName}
            readOnlyLabel={readOnlyLabel}
            showRsvp={showRsvp}
            myUserId={user?.id}
          />
        ) : (
          <>
            {/* 머리 — 다이얼로그 이름은 작게(제목 칸이 주인공). 닫기(✕)가 오른쪽 위 절대 배치라 오른쪽 여백 */}
            <DialogHeader className="pr-8 text-left">
              <DialogTitle className="text-sm font-medium text-muted-foreground">{dialogTitle}</DialogTitle>
              <DialogDescription className="sr-only">{dialogTitle}</DialogDescription>
            </DialogHeader>

            {/* 줄 간격 — 터치에선 컨트롤이 44px 로 커져 같은 간격이면 듬성해 보여 줄 사이를 줄인다(누르는 영역은 컨트롤 높이가 지킨다) */}
            {/* 제출 핸들러는 제출 때 만든다 — 렌더 중에 handleSubmit(중복 제출 가드 ref 를 읽음)을 넘겨 묶지 않게 */}
            <form
              onSubmit={(e) => void form.handleSubmit(handleSubmit)(e)}
              className="space-y-3 pointer-coarse:space-y-1.5"
            >
              {/* 제목 — 테두리 없이 아래 줄만 있는 큰 칸. 이름표가 없어 aria-label 로 「제목」을 읽힌다 */}
              <div className="space-y-1.5">
                <Input
                  id="ev-title"
                  data-testid="calendar-form-title"
                  aria-label="제목"
                  aria-invalid={!!form.formState.errors.title}
                  placeholder="제목 추가"
                  autoComplete="off"
                  className="h-auto rounded-none border-0 border-b border-border bg-transparent px-0 pt-0.5 pb-2 text-lg font-semibold shadow-none focus-visible:border-ring focus-visible:ring-0 md:text-lg dark:bg-transparent"
                  {...form.register('title')}
                />
                {form.formState.errors.title && (
                  <p className="text-sm text-destructive">{form.formState.errors.title.message}</p>
                )}
              </div>

              {/* 회의 참가 — 주최자는 보기 화면 없이 편집 폼을 열므로 여기에도 둔다. 기존 일정(상세 로드 뒤)에만 — 새 일정엔 회의 정보가 없다(WP-710) */}
              {isEdit && eventWithDetail?.onlineMeeting && (
                <JoinMeetingButton onlineMeeting={eventWithDetail.onlineMeeting} testId="calendar-form-join" />
              )}

              {/* 시간 — 시작·종료 한 줄(휴대폰은 한 줄씩 전체 폭: 반 폭이면 datetime-local 값이 날짜에서 잘려 시각이 안 보였다 WP-635),
                  그 아래 종일·반복. 반복을 시간 옆에 두는 건 상세 보기(시간 아래 반복 문구)와 같은 자리다. */}
              <EventFormRow icon={Clock}>
                <EventRangeInputs form={form} allDay={allDay} />
                {(form.formState.errors.start || form.formState.errors.end) && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.start?.message ?? form.formState.errors.end?.message}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                  {/* 종일 여부 — Radix Checkbox는 Controller 로 연결. 이름표가 곧 체크박스 글자라 그대로 보인다 */}
                  {/* 체크박스와 글자를 label 로 감싸 둘 다 누를 수 있게 — 터치에선 줄 높이 44px(h-11)까지 눌린다 */}
                  <label className="flex h-8 cursor-pointer items-center gap-2 pr-1 text-sm select-none pointer-coarse:h-11">
                    <Controller
                      control={form.control}
                      name="allDay"
                      render={({ field }) => (
                        <Checkbox
                          id="ev-allday"
                          // 16px 체크박스 — 터치에서는 눌림 영역을 넓힌다(WP-734).
                          className={HIT_AREA_COARSE_TIGHT}
                          data-testid="calendar-form-allday"
                          checked={field.value}
                          onCheckedChange={(checked) => {
                            field.onChange(checked)
                            const current = { start: form.getValues('start'), end: form.getValues('end') }
                            // 체크하면 지금 시각을 기억해 두고 자정 경계로 정규화, 풀면 기억한 시각으로 되돌린다(WP-711).
                            // 처음부터 종일이던 일정은 되살릴 시각이 없어 자정 값을 그대로 둔다.
                            let next: { start: string; end: string } | null = null
                            if (checked) {
                              timedRangeRef.current = current
                              next = normalizeAllDayRange(current.start, current.end)
                            } else if (timedRangeRef.current) {
                              next = restoreTimedRange(current, timedRangeRef.current)
                              timedRangeRef.current = null
                            }
                            if (next) {
                              form.setValue('start', next.start, { shouldValidate: true })
                              form.setValue('end', next.end, { shouldValidate: true })
                            }
                          }}
                        />
                      )}
                    />
                    종일
                  </label>

                  {/* 반복 — 빈도 (이슈 #111). 폼이 담을 수 없는 규칙이면 아래 잠김 안내가 대신한다(WP-708) */}
                  {!lockedRecurrenceRule && (
                    <Select
                      value={recurrenceFreq}
                      onValueChange={(v) => form.setValue('recurrenceFreq', v as FormValues['recurrenceFreq'])}
                    >
                      <SelectTrigger
                        id="ev-recurrence-freq"
                        data-testid="calendar-form-recurrence-freq"
                        aria-label="반복"
                        size="sm"
                        className="pointer-coarse:min-h-11"
                      >
                        <Repeat aria-hidden="true" />
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NONE">반복 안 함</SelectItem>
                        <SelectItem value="DAILY">매일</SelectItem>
                        <SelectItem value="WEEKLY">매주</SelectItem>
                        <SelectItem value="MONTHLY">매월</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>

                {lockedRecurrenceRule && (
                  <div className="space-y-2" data-testid="calendar-form-recurrence-locked">
                    <p className="text-sm text-muted-foreground">
                      이 일정의 반복 규칙은 여기서 그대로 고칠 수 없어요. 저장해도 원래 규칙이 유지돼요.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={unlockRecurrence}
                      data-testid="calendar-form-recurrence-unlock"
                    >
                      새 규칙으로 바꾸기
                    </Button>
                  </div>
                )}

                {/* freq ≠ NONE 일 때만 간격/종료 조건 — 「[2] 주마다 · [횟수 ▾] [3] 회」 한 줄(좁으면 다음 줄). 잠긴 규칙은 제외 */}
                {!lockedRecurrenceRule && recurrenceFreq !== 'NONE' && (
                  <>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">
                      <Input
                        id="ev-recurrence-interval"
                        type="number"
                        min={1}
                        data-testid="calendar-form-recurrence-interval"
                        aria-label={`${recurrenceUnitLabel(recurrenceFreq)}마다`}
                        aria-invalid={!!form.formState.errors.recurrenceInterval}
                        className="h-8 w-16 px-2 pointer-coarse:h-11"
                        {...form.register('recurrenceInterval', { valueAsNumber: true })}
                      />
                      <span className="mr-2 text-muted-foreground">
                        {recurrenceUnitLabel(recurrenceFreq)}마다
                      </span>
                      <Select
                        value={recurrenceEnd}
                        onValueChange={(v) => form.setValue('recurrenceEnd', v as FormValues['recurrenceEnd'])}
                      >
                        <SelectTrigger
                          id="ev-recurrence-end"
                          data-testid="calendar-form-recurrence-end"
                          aria-label="반복 종료"
                          size="sm"
                          className="pointer-coarse:min-h-11"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">종료 없음</SelectItem>
                          <SelectItem value="until">날짜까지</SelectItem>
                          <SelectItem value="count">횟수</SelectItem>
                        </SelectContent>
                      </Select>
                      {/* 종료=날짜까지 → 날짜 입력 */}
                      {recurrenceEnd === 'until' && (
                        <Input
                          id="ev-recurrence-until"
                          type="date"
                          data-testid="calendar-form-recurrence-until"
                          aria-label="종료 날짜"
                          aria-invalid={!!form.formState.errors.recurrenceUntil}
                          className="h-8 w-auto px-2 pointer-coarse:h-11"
                          {...form.register('recurrenceUntil')}
                        />
                      )}
                      {/* 종료=횟수 → 횟수 입력 */}
                      {recurrenceEnd === 'count' && (
                        <span className="inline-flex items-center gap-2">
                          <Input
                            id="ev-recurrence-count"
                            type="number"
                            min={1}
                            data-testid="calendar-form-recurrence-count"
                            aria-label="반복 횟수"
                            aria-invalid={!!form.formState.errors.recurrenceCount}
                            className="h-8 w-16 px-2 pointer-coarse:h-11"
                            {...form.register('recurrenceCount', { valueAsNumber: true })}
                          />
                          <span className="text-muted-foreground">회</span>
                        </span>
                      )}
                    </div>
                    {(form.formState.errors.recurrenceInterval ||
                      form.formState.errors.recurrenceUntil ||
                      form.formState.errors.recurrenceCount) && (
                      <p className="text-sm text-destructive">
                        {form.formState.errors.recurrenceInterval?.message ??
                          form.formState.errors.recurrenceUntil?.message ??
                          form.formState.errors.recurrenceCount?.message}
                      </p>
                    )}
                  </>
                )}
              </EventFormRow>

              {/* 장소 */}
              <EventFormRow icon={MapPin}>
                <Input
                  id="ev-location"
                  data-testid="calendar-form-location"
                  aria-label="장소"
                  aria-invalid={!!form.formState.errors.location}
                  placeholder="장소 추가"
                  className="h-8 px-2.5 pointer-coarse:h-11"
                  {...form.register('location')}
                />
                {form.formState.errors.location && (
                  <p className="text-sm text-destructive">{form.formState.errors.location.message}</p>
                )}
              </EventFormRow>

              {/* 참석자 — 생성 모드: 로컬 선택, 편집 모드: 상세 attendees + 즉시 invite/remove (이슈 #489) */}
              {/* onInvite/onRemove 는 내가 ORGANIZER 이고 읽기전용이 아닐 때만 노출 (#547). 그 외 편집 모드는 추가 버튼도 숨김(WP-200) */}
              {/* 참석자를 관리할 수 없고(주최자 아님) 참석자도 없으면 줄째 숨긴다 — 아이콘만 덩그러니 남지 않게 */}
              {/* 기존 일정의 상세(주최자 여부·참석자)가 오기 전엔 같은 높이의 자리표시를 둔다 — 뒤늦게 줄이 끼어들어 아래 칸이 밀리지 않게(WP-801) */}
              {attendeesLoading ? (
                <EventFormRow icon={Users} testId="calendar-form-attendees-loading">
                  <div className={FORM_CHIP_LINE_CLASS} aria-hidden="true">
                    <span className="h-[22px] w-20 animate-pulse rounded-full bg-muted" />
                  </div>
                </EventFormRow>
              ) : showAttendees ? (
                <EventFormRow icon={Users}>
                  <AttendeeSection
                    selectedMembers={selectedAttendees}
                    onChange={setSelectedAttendees}
                    attendees={eventWithDetail?.attendees}
                    onInvite={canManageAttendees ? (userIds) => inviteAttendees.mutate(userIds) : undefined}
                    onRemove={canManageAttendees ? (userId) => removeAttendee.mutate(userId) : undefined}
                    hideAdd={isEdit && !canManageAttendees}
                  />
                </EventFormRow>
              ) : null}

              {/* 알림(리마인더) — 시작 N분 전 알림 */}
              <EventFormRow icon={Bell}>
                <Select
                  value={reminderMinutes}
                  onValueChange={(v) => form.setValue('reminderMinutes', v as FormValues['reminderMinutes'])}
                >
                  <SelectTrigger
                    id="ev-reminder"
                    data-testid="calendar-form-reminder"
                    aria-label="알림(리마인더)"
                    size="sm"
                    className="pointer-coarse:min-h-11"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">알림 없음</SelectItem>
                    <SelectItem value="10">{reminderLabel(10)}</SelectItem>
                    <SelectItem value="60">{reminderLabel(60)}</SelectItem>
                    <SelectItem value="1440">{reminderLabel(1440)}</SelectItem>
                  </SelectContent>
                </Select>
              </EventFormRow>

              {/* 캘린더 + 색 — 한 알약 안에 [색 점 | 캘린더 이름 ▾]. 점을 누르면 색 팝오버(상속 + 8색), 이름을 누르면 캘린더 목록.
                  색이 따로 한 줄을 차지하지 않는다. 점 색은 고른 색, 상속이면 고른 캘린더의 색.
                  초대받은 일정(내 목록에 없는 주최자 캘린더)은 읽기 전용이라 상세 보기에서 「초대받은 일정」 칩으로 보인다(WP-604·WP-708). */}
              <EventFormRow icon={CalendarIcon}>
                <div className="inline-flex h-8 max-w-full items-center rounded-md border border-input shadow-xs pointer-coarse:h-11 dark:bg-input/30">
                  <Popover open={colorOpen} onOpenChange={setColorOpen}>
                    <PopoverTrigger asChild>
                      {/* 터치에선 44px 칸이지만 점은 오른쪽 끝(이름 쪽)에 붙여 「● 기본」이 떨어져 보이지 않게 한다 */}
                      <button
                        type="button"
                        aria-label="색"
                        title="일정 색"
                        data-testid="calendar-form-color"
                        className="-my-px flex h-[calc(100%+2px)] shrink-0 items-center justify-center rounded-l-md pr-1 pl-2.5 outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:min-w-11 pointer-coarse:justify-end pointer-coarse:pr-1.5 pointer-coarse:pl-0"
                      >
                        <span
                          className={cn(
                            'size-3 rounded-full ring-offset-background',
                            resolvePalette(color ?? calendarColor).dotClass,
                          )}
                        />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      // 휴대폰에서 화면 가장자리에 붙지 않게 16px 띄우고, 좁으면 팔레트가 다음 줄로 꺾인다.
                      // 아래쪽 하단 탭바 높이는 앱 공용 PopoverContent(overlay/popover)가 더해 자리가 없으면 위로 뒤집힌다(WP-806)
                      collisionPadding={16}
                      className="w-auto max-w-[calc(100vw-2rem)] p-3"
                      data-testid="calendar-color-popover"
                    >
                      <p className="mb-2 text-xs text-muted-foreground">일정 색</p>
                      {/* 상속(점선) = color null, 캘린더 색을 따른다. 고르면 팝오버를 닫는다 */}
                      <PaletteSwatches
                        value={color}
                        onChange={(next) => {
                          form.setValue('color', next)
                          setColorOpen(false)
                        }}
                        testIdPrefix="calendar-color-"
                        inherit={{ label: '캘린더 색 따르기' }}
                        withTitle
                      />
                    </PopoverContent>
                  </Popover>
                  <Controller
                    control={form.control}
                    name="calendarId"
                    render={({ field }) => (
                      <Select value={field.value?.toString() ?? ''} onValueChange={(v) => field.onChange(Number(v))}>
                        <SelectTrigger
                          id="ev-calendar"
                          data-testid="calendar-form-calendar"
                          aria-label="캘린더"
                          size="sm"
                          // 바깥 알약이 테두리를 맡는다 — 트리거 자체 테두리·그림자·배경은 끈다
                          // 높이는 알약 테두리까지 덮게(-my-px) — 터치에서 알약 44px 전체가 눌리는 자리가 된다
                          className="-my-px h-[calc(100%+2px)] min-w-0 rounded-l-none border-0 bg-transparent pl-1.5 shadow-none pointer-coarse:pl-1 data-[size=sm]:h-[calc(100%+2px)] dark:bg-transparent dark:hover:bg-accent"
                        >
                          <SelectValue placeholder="캘린더 선택" />
                        </SelectTrigger>
                        <SelectContent>
                          {/* 읽기전용(외부 동기화) 컨테이너는 생성/이동 대상에서 제외 — 백엔드 resolveCalendarId 가드와 일치 */}
                          {calendars
                            .filter((c) => !c.isReadOnly)
                            .map((c) => (
                              <SelectItem key={c.id} value={c.id.toString()}>
                                {c.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
              </EventFormRow>

              {/* 태그 — 폼 상태라 「수정」·「저장」 때 함께 저장되고 「취소」면 버린다. 새 일정에도 보인다(WP-714) */}
              {showTags && (
                <EventTagsField
                  value={formTags}
                  onChange={setTouchedTags}
                  editable={tagsEditable}
                  hint={isEdit && detailEvent ? eventTagHint(detailEvent) : null}
                />
              )}

              {/* 설명 — 내용에 맞춰 늘어난다. 고정 줄 수면 다이얼로그 스크롤 안에서 설명 칸이 또 스크롤됐다(WP-708) */}
              <EventFormRow icon={AlignLeft}>
                <Textarea
                  id="ev-description"
                  data-testid="calendar-form-description"
                  aria-label="설명"
                  aria-invalid={!!form.formState.errors.description}
                  placeholder="설명 추가"
                  className="field-sizing-content min-h-16 resize-none px-2.5 py-1.5 pointer-coarse:py-2.5"
                  {...form.register('description')}
                />
                {form.formState.errors.description && (
                  <p className="text-sm text-destructive">{form.formState.errors.description.message}</p>
                )}
              </EventFormRow>

              {/* 휴대폰에서도 한 줄 — 삭제는 왼쪽, 취소·저장은 오른쪽(공용 DialogFooter 의 세로 쌓기·전체 폭 삭제 대신, 이 폼에만) */}
              <DialogFooter className="flex-row items-center pt-2">
                {/* 편집 모드에서 onDelete 제공 시 삭제 버튼 표시 — 읽기전용은 상세 보기라 여기 오지 않는다 (이슈 #501) */}
                {isEdit && onDelete && (
                  <Button
                    type="button"
                    variant="destructive"
                    data-testid="calendar-form-delete"
                    // 상세(주최자 여부) 로드 전엔 저장처럼 비활성 — 초대받은 일정이 판정 전 잠깐 폼으로 보일 때 지우지 못하게(WP-200)
                    disabled={!detailEvent}
                    onClick={onDelete}
                  >
                    삭제
                  </Button>
                )}
                <div className="ml-auto flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => onOpenChange(false)}
                  >
                    취소
                  </Button>
                  {/* 편집 모드는 상세(주최자 여부) 로드 전 비활성 — 판정 전 저장으로 403 방지(WP-200) */}
                  <Button
                    type="submit"
                    data-testid="calendar-form-submit"
                    disabled={isPending || (isEdit && !detailEvent)}
                  >
                    {isPending ? '저장 중…' : isEdit ? '수정' : '저장'}
                  </Button>
                </div>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
