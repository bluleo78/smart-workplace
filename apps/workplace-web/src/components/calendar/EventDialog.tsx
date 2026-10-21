// 일정 생성/편집 다이얼로그.
// event prop 이 있으면 편집 모드, 없으면 생성 모드.
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useRef, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'

import { useAiPanelAwareDialog } from '@/components/ai/useAiPanelAwareDialog'
import { AttendeeSection, type SelectedMember } from '@/components/calendar/AttendeeSection'
import { EventDetailView } from '@/components/calendar/EventDetailView'
import { JoinMeetingButton } from '@/components/calendar/JoinMeetingButton'
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
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
  eventEditability,
  eventFormSchema,
  type EventFormValues as FormValues,
  normalizeAllDayRange,
  recurrenceToFormValues,
  restoreTimedRange,
  shouldShowRsvp,
  toEventRequest,
} from '@/lib/calendarEventForm'
import { reminderLabel } from '@/lib/calendarEventView'
import { PALETTE_KEYS, resolvePalette } from '@/lib/calendarPalette'
import { isFormEditableRRule, parseRRule, recurrenceUnitLabel } from '@/lib/recurrence'
import { cn } from '@/lib/utils'
import type { CalendarEvent, CalendarEventRequest } from '@/types/calendar'

// ────────────────────────────────────────────────────────────
// ISO(UTC) ↔ datetime-local 변환 헬퍼
// ────────────────────────────────────────────────────────────

/** ISO(UTC) → datetime-local 문자열 (YYYY-MM-DDTHH:mm) */
function toLocalInput(iso: string): string {
  const d = new Date(iso)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16)
}

/** Date → datetime-local 문자열 */
function dateToLocalInput(d: Date): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16)
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

  // WP-54: AI 사이드 패널과 공존하는 다이얼로그 props(side 모드면 non-modal + 페이지 영역 dim).
  const aiAware = useAiPanelAwareDialog({ open })
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

  // 다이얼로그가 열릴 때마다 폼 초기화 + 참석자 선택 초기화
  useEffect(() => {
    if (!open) return
    // 다이얼로그를 새로 열 때마다 in-flight 가드 초기화 — 재오픈 시 이전 제출 잔재 방지.
    submittingRef.current = false
    timedRangeRef.current = null
    // 생성 모드 진입 시 참석자 선택 초기화
    if (!event) setSelectedAttendees([])

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
        start: toLocalInput(event.startsAt),
        end: toLocalInput(event.endsAt),
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
      // 생성 모드: defaultStart(또는 현재 시각) 기준으로 초기화. 종료 = 시작 + 1시간
      const startDate = defaultStart ?? new Date()
      const endDate = new Date(startDate.getTime() + 60 * 60 * 1000)
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
  }, [open, event, defaultStart, form])

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

  // 폼 제출 핸들러
  function handleSubmit(values: FormValues) {
    // 동기적 중복 제출 가드 — 이미 제출 중이면 no-op (dblclick 등으로 인한 중복 생성 방지, 이슈 #584)
    if (submittingRef.current) return
    submittingRef.current = true

    // 참석자 id 는 생성 모드에서만 담긴다 — 칩 표시용 이름은 제외하고 id 만 (이슈 #489)
    const body = toEventRequest(values, {
      isEdit,
      defaultCalendarId,
      attendeeUserIds: selectedAttendees.map((m) => m.id),
      lockedRecurrenceRule,
    })
    onSubmit(body)
  }

  // 읽기 전용이면 편집 폼 대신 상세 보기(WP-708) — 입력칸 없이 아이콘 행으로 보여 주고 본문만 스크롤한다.
  // isReadOnly 는 편집 모드에서만 참이라 eventWithDetail 은 늘 있다 — != null 은 아래 JSX 의 타입 좁히기용.
  const showDetail = isReadOnly && eventWithDetail != null
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
        className={cn(
          showDetail ? 'flex max-h-[85vh] flex-col gap-0 p-0' : 'max-h-[85vh] overflow-y-auto',
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
            <DialogHeader>
              <DialogTitle>{dialogTitle}</DialogTitle>
              <DialogDescription className="sr-only">{dialogTitle}</DialogDescription>
            </DialogHeader>

            {/* 회의 참가 — 주최자는 보기 화면 없이 편집 폼을 열므로 여기에도 둔다. 기존 일정(상세 로드 뒤)에만 — 새 일정엔 회의 정보가 없다(WP-710) */}
            {isEdit && eventWithDetail?.onlineMeeting && (
              <JoinMeetingButton onlineMeeting={eventWithDetail.onlineMeeting} testId="calendar-form-join" />
            )}

            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-3">
              {/* 제목 */}
              <FormField
                label="제목"
                htmlFor="ev-title"
                required
                error={form.formState.errors.title?.message}
              >
                <Input
                  id="ev-title"
                  data-testid="calendar-form-title"
                  placeholder="일정 제목"
                  {...form.register('title')}
                />
              </FormField>

              {/* 종일 여부 — Radix Checkbox는 Controller 로 연결 */}
              <div className="flex items-center gap-2">
                <Controller
                  control={form.control}
                  name="allDay"
                  render={({ field }) => (
                    <Checkbox
                      id="ev-allday"
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
                <label htmlFor="ev-allday" className="text-sm cursor-pointer select-none">
                  종일
                </label>
              </div>

              {/* 시작 / 종료 — 좁은 화면(<640px)에선 한 줄씩 전체 폭. 반 폭(150px)이면 datetime-local 값이 날짜에서 잘려
                  시각이 안 보였다(WP-635, 일정 제안 카드 WP-593 과 같은 처리). */}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <FormField
                  label="시작"
                  htmlFor="ev-start"
                  error={form.formState.errors.start?.message}
                >
                  <Input
                    id="ev-start"
                    type="datetime-local"
                    data-testid="calendar-form-start"
                    {...form.register('start')}
                  />
                </FormField>
                <FormField
                  label="종료"
                  htmlFor="ev-end"
                  error={form.formState.errors.end?.message}
                >
                  <Input
                    id="ev-end"
                    type="datetime-local"
                    data-testid="calendar-form-end"
                    {...form.register('end')}
                  />
                </FormField>
              </div>

              {/* 장소 */}
              <FormField
                label="장소"
                htmlFor="ev-location"
                error={form.formState.errors.location?.message}
              >
                <Input
                  id="ev-location"
                  data-testid="calendar-form-location"
                  placeholder="장소 (선택)"
                  {...form.register('location')}
                />
              </FormField>

              {/* 캘린더 — 드롭다운으로 컨테이너 선택. 기본값=isDefault 캘린더.
                  초대받은 일정(내 목록에 없는 주최자 캘린더)은 읽기 전용이라 상세 보기에서 「초대받은 일정」 칩으로 보인다(WP-604·WP-708). */}
              <FormField label="캘린더" htmlFor="ev-calendar">
                <Controller
                  control={form.control}
                  name="calendarId"
                  render={({ field }) => (
                    <Select
                      value={field.value?.toString() ?? ''}
                      onValueChange={(v) => field.onChange(Number(v))}
                    >
                      <SelectTrigger
                        id="ev-calendar"
                        data-testid="calendar-form-calendar"
                        className="w-full"
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
              </FormField>

              {/* 색 — '상속' 칩(점선, color=null) + 8색 override 칩 */}
              <FormField label="색" htmlFor="ev-color">
                <div className="flex flex-wrap items-center gap-2" data-testid="calendar-form-color">
                  <button
                    type="button"
                    data-testid="calendar-color-inherit"
                    onClick={() => form.setValue('color', null)}
                    className={`flex size-7 items-center justify-center rounded-full border-2 border-dashed text-[10px] ${
                      form.watch('color') === null ? 'border-foreground' : 'border-muted-foreground/40'
                    }`}
                  >
                    상속
                  </button>
                  {PALETTE_KEYS.map((k) => (
                    <button
                      key={k}
                      type="button"
                      data-testid={`calendar-color-${k}`}
                      onClick={() => form.setValue('color', k)}
                      className={`size-7 rounded-full border-2 ${resolvePalette(k).dotClass} ${
                        form.watch('color') === k ? 'border-foreground' : 'border-transparent'
                      }`}
                      aria-label={resolvePalette(k).label}
                    />
                  ))}
                </div>
              </FormField>

              {/* 알림(리마인더) — 시작 N분 전 알림 */}
              <FormField label="알림(리마인더)" htmlFor="ev-reminder">
                <Select
                  value={form.watch('reminderMinutes')}
                  onValueChange={(v) =>
                    form.setValue('reminderMinutes', v as FormValues['reminderMinutes'])
                  }
                >
                  <SelectTrigger
                    id="ev-reminder"
                    data-testid="calendar-form-reminder"
                    className="w-full"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">없음</SelectItem>
                    <SelectItem value="10">{reminderLabel(10)}</SelectItem>
                    <SelectItem value="60">{reminderLabel(60)}</SelectItem>
                    <SelectItem value="1440">{reminderLabel(1440)}</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>

              {/* 반복 설정 — 빈도/간격/종료 (이슈 #111). 폼이 담을 수 없는 규칙이면 잠그고 안내만 */}
              <FormField label="반복" htmlFor={lockedRecurrenceRule ? undefined : 'ev-recurrence-freq'}>
                {lockedRecurrenceRule ? (
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
                ) : (
                  <Select
                    value={form.watch('recurrenceFreq')}
                    onValueChange={(v) =>
                      form.setValue('recurrenceFreq', v as FormValues['recurrenceFreq'])
                    }
                  >
                    <SelectTrigger
                      id="ev-recurrence-freq"
                      data-testid="calendar-form-recurrence-freq"
                      className="w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NONE">없음</SelectItem>
                      <SelectItem value="DAILY">매일</SelectItem>
                      <SelectItem value="WEEKLY">매주</SelectItem>
                      <SelectItem value="MONTHLY">매월</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </FormField>

              {/* freq ≠ NONE 일 때만 간격/종료 조건 표시(잠긴 규칙은 제외) */}
              {!lockedRecurrenceRule && form.watch('recurrenceFreq') !== 'NONE' && (
                <>
                  <FormField
                    label={`${recurrenceUnitLabel(form.watch('recurrenceFreq'))}마다`}
                    htmlFor="ev-recurrence-interval"
                    error={form.formState.errors.recurrenceInterval?.message}
                  >
                    <Input
                      id="ev-recurrence-interval"
                      type="number"
                      min={1}
                      data-testid="calendar-form-recurrence-interval"
                      {...form.register('recurrenceInterval', { valueAsNumber: true })}
                    />
                  </FormField>

                  <FormField label="종료" htmlFor="ev-recurrence-end">
                    <Select
                      value={form.watch('recurrenceEnd')}
                      onValueChange={(v) =>
                        form.setValue('recurrenceEnd', v as FormValues['recurrenceEnd'])
                      }
                    >
                      <SelectTrigger
                        id="ev-recurrence-end"
                        data-testid="calendar-form-recurrence-end"
                        className="w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">없음</SelectItem>
                        <SelectItem value="until">날짜까지</SelectItem>
                        <SelectItem value="count">횟수</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormField>

                  {/* 종료=날짜까지 → 날짜 입력 */}
                  {form.watch('recurrenceEnd') === 'until' && (
                    <FormField
                      label="종료 날짜"
                      htmlFor="ev-recurrence-until"
                      error={form.formState.errors.recurrenceUntil?.message}
                    >
                      <Input
                        id="ev-recurrence-until"
                        type="date"
                        data-testid="calendar-form-recurrence-until"
                        {...form.register('recurrenceUntil')}
                      />
                    </FormField>
                  )}

                  {/* 종료=횟수 → 횟수 입력 */}
                  {form.watch('recurrenceEnd') === 'count' && (
                    <FormField
                      label="반복 횟수"
                      htmlFor="ev-recurrence-count"
                      error={form.formState.errors.recurrenceCount?.message}
                    >
                      <Input
                        id="ev-recurrence-count"
                        type="number"
                        min={1}
                        data-testid="calendar-form-recurrence-count"
                        {...form.register('recurrenceCount', { valueAsNumber: true })}
                      />
                    </FormField>
                  )}
                </>
              )}

              {/* 참석자 섹션 — 생성 모드: 로컬 선택, 편집 모드: 상세 attendees + 즉시 invite/remove (이슈 #489) */}
              {/* onInvite/onRemove 는 내가 ORGANIZER 이고 읽기전용이 아닐 때만 노출 (#547). 그 외 편집 모드는 추가 버튼도 숨김(WP-200) */}
              <AttendeeSection
                selectedMembers={selectedAttendees}
                onChange={setSelectedAttendees}
                attendees={eventWithDetail?.attendees}
                onInvite={canManageAttendees ? (userId) => inviteAttendees.mutate([userId]) : undefined}
                onRemove={canManageAttendees ? (userId) => removeAttendee.mutate(userId) : undefined}
                hideAdd={isEdit && !canManageAttendees}
              />

              {/* 설명 */}
              <FormField
                label="설명"
                htmlFor="ev-description"
                error={form.formState.errors.description?.message}
              >
                <Textarea
                  id="ev-description"
                  data-testid="calendar-form-description"
                  placeholder="설명 (선택)"
                  rows={3}
                  // 내용에 맞춰 늘어난다 — 고정 3줄이면 다이얼로그 스크롤 안에서 설명 칸이 또 스크롤됐다(WP-708)
                  className="field-sizing-content"
                  {...form.register('description')}
                />
              </FormField>

              <DialogFooter className="pt-2">
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
                <div className="flex gap-2 sm:ml-auto">
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
