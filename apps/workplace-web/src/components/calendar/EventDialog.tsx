// 일정 생성/편집 다이얼로그.
// event prop 이 있으면 편집 모드, 없으면 생성 모드.
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useRef, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { z } from 'zod'

import { AttendeeSection, type SelectedMember } from '@/components/calendar/AttendeeSection'
import { RsvpControls } from '@/components/calendar/RsvpControls'
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
import { PALETTE_KEYS, resolvePalette } from '@/lib/calendarPalette'
import { buildRRule, parseRRule, type RecurrenceForm } from '@/lib/recurrence'
import type { CalendarEvent, CalendarEventRequest } from '@/types/calendar'

// ────────────────────────────────────────────────────────────
// Zod 스키마
// ────────────────────────────────────────────────────────────
const schema = z
  .object({
    title: z.string().min(1, '제목을 입력하세요').max(200, '제목은 200자 이하여야 합니다'),
    allDay: z.boolean(),
    start: z.string().min(1, '시작을 입력하세요'),
    end: z.string().min(1, '종료를 입력하세요'),
    location: z.string().max(200, '장소는 200자 이하여야 합니다').optional(),
    description: z.string().optional(),
    // 캘린더 컨테이너 — undefined 이면 기본 캘린더로 폴백
    calendarId: z.number().optional(),
    // 색 override — null 이면 캘린더 색 상속
    color: z.string().nullable(),
    // 리마인더 — select 값은 문자열('none' = 없음, 그 외 분 단위). 제출 시 number|null 로 변환.
    // (Radix Select 는 빈 문자열 value 를 허용하지 않아 'none' 센티넬 사용)
    reminderMinutes: z.enum(['none', '10', '60', '1440']),
    // 반복 설정 — 폼에서는 평탄한 필드로 다루고 제출 시 RecurrenceForm 으로 조립한다. (이슈 #111)
    recurrenceFreq: z.enum(['NONE', 'DAILY', 'WEEKLY', 'MONTHLY']),
    // interval/until/count 는 조건부 필드 — base 에서는 검증하지 않고 superRefine 에서 노출 조건일 때만 검증.
    // (숨겨진 필드의 잔존 값이 제출을 조용히 막는 것을 방지)
    recurrenceInterval: z.number().optional(),
    recurrenceEnd: z.enum(['none', 'until', 'count']),
    recurrenceUntil: z.string().optional(),
    recurrenceCount: z.number().optional(),
  })
  .refine((v) => new Date(v.end) > new Date(v.start), {
    message: '종료는 시작보다 뒤여야 합니다',
    path: ['end'],
  })
  // 반복 관련 필드는 해당 입력이 실제로 노출될 때(freq≠NONE)만 검증한다.
  .superRefine((v, ctx) => {
    if (v.recurrenceFreq === 'NONE') return
    // 간격 — 1 이상의 정수 필수 (freq≠NONE 일 때만 노출)
    if (!(Number.isInteger(v.recurrenceInterval) && (v.recurrenceInterval ?? 0) >= 1)) {
      ctx.addIssue({
        code: 'custom',
        message: '간격은 1 이상이어야 합니다',
        path: ['recurrenceInterval'],
      })
    }
    // 종료=날짜까지 → 종료 날짜 필수
    if (v.recurrenceEnd === 'until' && !v.recurrenceUntil) {
      ctx.addIssue({
        code: 'custom',
        message: '종료 날짜를 입력하세요',
        path: ['recurrenceUntil'],
      })
    }
    // 반복 종료 날짜가 시작일보다 이전이면 회차가 0개로 전개되어 조회·삭제 불가능한
    // orphan 일정이 된다(이슈 #114). 시작일(날짜 부분) 이상인지 검증한다.
    // start='YYYY-MM-DDTHH:mm', recurrenceUntil='YYYY-MM-DD' — 둘 다 로컬 ISO 라
    // 날짜 부분 문자열 비교로 안전하게 순서 판정(같은 날은 1회차 발생하므로 허용).
    if (v.recurrenceEnd === 'until' && v.recurrenceUntil && v.recurrenceUntil < v.start.slice(0, 10)) {
      ctx.addIssue({
        code: 'custom',
        message: '반복 종료 날짜는 시작일 이후여야 합니다',
        path: ['recurrenceUntil'],
      })
    }
    // 종료=횟수 → 1 이상의 정수 필수
    if (
      v.recurrenceEnd === 'count' &&
      !(Number.isInteger(v.recurrenceCount) && (v.recurrenceCount ?? 0) >= 1)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: '횟수는 1 이상이어야 합니다',
        path: ['recurrenceCount'],
      })
    }
  })

type FormValues = z.infer<typeof schema>

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

/** datetime-local 문자열 → ISO(UTC) 문자열 */
function toIso(local: string): string {
  return new Date(local).toISOString()
}

/** Date → datetime-local 문자열 */
function dateToLocalInput(d: Date): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16)
}

/** datetime-local 문자열에서 날짜 부분(YYYY-MM-DD)만 추출 */
function localDateOnly(local: string): string {
  return local.slice(0, 10)
}

/** YYYY-MM-DD 문자열에 일 단위를 더한 YYYY-MM-DD 반환 (타임존 독립·달력 날짜 연산만) */
function addDaysToDateOnly(dateOnly: string, days: number): string {
  const [y, m, d] = dateOnly.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() + days)
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

// "종일" 체크 시 시작/종료를 자정 경계(half-open [start, end))로 정규화한다.
// calendar.ts eventsOnDay() 의 종일 비교가 `cellKey < dateKey(endsAt)` (배타적 end) 라서
// 시작·종료가 같은 날짜이면 항상 false 가 되어 월/TimeGrid 뷰에서 사라진다 (이슈 #575).
// - 시작 날짜는 그대로, 시각만 00:00 으로
// - 종료가 시작과 같은 날(또는 그 이전)이면 다음날 00:00 으로 밀어 최소 하루 범위를 보장
// - 이미 여러 날에 걸친 값이면 날짜는 유지하고 시각만 00:00 으로 정규화
function normalizeAllDayRange(start: string, end: string): { start: string; end: string } {
  const startDate = localDateOnly(start)
  const endDate = end ? localDateOnly(end) : startDate
  const normalizedEndDate = endDate <= startDate ? addDaysToDateOnly(startDate, 1) : endDate
  return { start: `${startDate}T00:00`, end: `${normalizedEndDate}T00:00` }
}

/** 반복 빈도별 간격 단위 라벨 (예: '주' → "주마다") */
function recurrenceUnitLabel(freq: FormValues['recurrenceFreq']): string {
  switch (freq) {
    case 'DAILY':
      return '일'
    case 'WEEKLY':
      return '주'
    case 'MONTHLY':
      return '개월'
    default:
      return ''
  }
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
  const { data: calendars = [] } = useCalendars()

  // 이벤트가 속한 캘린더가 읽기전용(외부 동기화)인지 여부 — calendarId 로 파생.
  // 이벤트 API 응답을 건드리지 않고 캘린더 목록에서 derive. (이슈 #501)
  const isReadOnly = isEdit
    ? (calendars.find((c) => c.id === event?.calendarId)?.isReadOnly ?? false)
    : false
  // 기본 캘린더 id — isDefault=true 우선, 없으면 첫 번째.
  const defaultCalendarId = calendars.find((c) => c.isDefault)?.id ?? calendars[0]?.id

  // 생성 모드에서 선택된 참석자 목록 — id+이름+종류 저장으로 칩에 실명 표시 (이슈 #489)
  const [selectedAttendees, setSelectedAttendees] = useState<SelectedMember[]>([])

  // 동기적 in-flight 가드 — ref 는 즉시(리렌더 없이) 반영되므로 저장 버튼을 같은
  // 이벤트 루프 틱 내에 두 번 클릭해도(isPending prop 이 아직 갱신되기 전) 두 번째
  // form submit 을 차단한다. isPending(state)만으로는 dblclick 을 막지 못함 (이슈 #584).
  const submittingRef = useRef(false)

  // 편집 모드에서 상세 데이터(attendees 포함) 로드 — 목록 이벤트에는 attendees 가 없음 (이슈 #489)
  const { data: detailEvent } = useCalendarEvent(isEdit && open ? event?.id : undefined)
  // detailEvent 가 있으면 그것을, 없으면 prop event 를 사용 (생성 모드 / 로딩 중)
  const eventWithDetail = detailEvent ?? event

  // 편집 모드 참석자 invite/remove 뮤테이션 — eventId 0 은 dummy(생성 모드에서 훅 호출 유지) (이슈 #489)
  const inviteAttendees = useInviteAttendees(event?.id ?? 0)
  const removeAttendee = useRemoveAttendee(event?.id ?? 0)

  // 현재 사용자가 참석자이고 주최자가 아니며 AGENT 가 아닌 경우 RSVP 컨트롤 표시 (이슈 #489)
  const myAttendee = user && eventWithDetail?.attendees?.find((a) => a.userId === user.id)
  const showRsvp =
    isEdit &&
    myAttendee != null &&
    myAttendee.role !== 'ORGANIZER' &&
    myAttendee.kind !== 'AGENT' &&
    eventWithDetail?.myRsvpStatus != null

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
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
    // 생성 모드 진입 시 참석자 선택 초기화
    if (!event) setSelectedAttendees([])

    // 반복 규칙(RRULE) → 평탄한 폼 필드로 변환. 생성 모드(이벤트 없음)면 NONE 기본값.
    const rec = parseRRule(event?.recurrenceRule ?? null)
    const recFields = {
      recurrenceFreq: rec.freq,
      recurrenceInterval: rec.interval,
      recurrenceEnd: rec.end.type,
      recurrenceUntil: rec.end.type === 'until' ? rec.end.date : '',
      recurrenceCount: rec.end.type === 'count' ? rec.end.count : 1,
    }

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

  // 폼 제출 핸들러
  function handleSubmit(values: FormValues) {
    // 동기적 중복 제출 가드 — 이미 제출 중이면 no-op (dblclick 등으로 인한 중복 생성 방지, 이슈 #584)
    if (submittingRef.current) return
    submittingRef.current = true

    // 평탄한 폼 필드 → RecurrenceForm 조립 후 RRULE 문자열 생성. freq=NONE 이면 null(단일 일정).
    const recForm: RecurrenceForm = {
      freq: values.recurrenceFreq,
      interval: values.recurrenceInterval ?? 1,
      end:
        values.recurrenceEnd === 'until'
          ? { type: 'until', date: values.recurrenceUntil ?? '' }
          : values.recurrenceEnd === 'count'
            ? { type: 'count', count: values.recurrenceCount ?? 1 }
            : { type: 'none' },
    }

    const body: CalendarEventRequest = {
      title: values.title,
      allDay: values.allDay,
      startsAt: toIso(values.start),
      endsAt: toIso(values.end),
      location: values.location?.trim() || null,
      description: values.description?.trim() || null,
      // 색 override — null 이면 캘린더 색 상속
      color: values.color,
      // 캘린더 컨테이너 — 미선택 시 기본 캘린더로 폴백
      calendarId: values.calendarId ?? defaultCalendarId,
      // 'none'(없음) → null, 그 외 분 단위 숫자로 변환
      reminderMinutes: values.reminderMinutes === 'none' ? null : Number(values.reminderMinutes),
      // 반복 규칙 — freq=NONE 이면 buildRRule 이 null 반환 (이슈 #111)
      recurrenceRule: buildRRule(recForm),
      // 참석자 초대 — 생성 모드에서만 의미있음. 편집은 별도 invite/remove API (이슈 #489)
      // selectedAttendees 에서 id 만 추출해 요청 바디에 담음
      attendeeUserIds: isEdit ? undefined : selectedAttendees.map((m) => m.id),
    }
    onSubmit(body)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="calendar-event-dialog" className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? '일정 수정' : '새 일정'}</DialogTitle>
          <DialogDescription className="sr-only">{isEdit ? '일정 수정' : '새 일정'}</DialogDescription>
          {/* 외부 동기화 캘린더 이벤트는 읽기전용임을 사용자에게 안내. (이슈 #501) */}
          {isReadOnly && (
            <span
              data-testid="event-synced-label"
              className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground"
            >
              M365에서 동기화됨
            </span>
          )}
        </DialogHeader>

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
              disabled={isReadOnly}
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
                    // 체크 시에만 자정 경계로 정규화 — 체크 해제는 사용자가 입력한 시각 보존
                    if (checked) {
                      const { start, end } = normalizeAllDayRange(
                        form.getValues('start'),
                        form.getValues('end'),
                      )
                      form.setValue('start', start, { shouldValidate: true })
                      form.setValue('end', end, { shouldValidate: true })
                    }
                  }}
                  disabled={isReadOnly}
                />
              )}
            />
            <label htmlFor="ev-allday" className="text-sm cursor-pointer select-none">
              종일
            </label>
          </div>

          {/* 시작 / 종료 */}
          <div className="grid grid-cols-2 gap-2">
            <FormField
              label="시작"
              htmlFor="ev-start"
              error={form.formState.errors.start?.message}
            >
              <Input
                id="ev-start"
                type="datetime-local"
                data-testid="calendar-form-start"
                disabled={isReadOnly}
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
                disabled={isReadOnly}
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
              disabled={isReadOnly}
              {...form.register('location')}
            />
          </FormField>

          {/* 캘린더 — 드롭다운으로 컨테이너 선택. 기본값=isDefault 캘린더 */}
          <FormField label="캘린더" htmlFor="ev-calendar">
            <Controller
              control={form.control}
              name="calendarId"
              render={({ field }) => (
                <Select
                  value={field.value?.toString() ?? ''}
                  onValueChange={(v) => field.onChange(Number(v))}
                  disabled={isReadOnly}
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
                disabled={isReadOnly}
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
                  disabled={isReadOnly}
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
              disabled={isReadOnly}
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
                <SelectItem value="10">10분 전</SelectItem>
                <SelectItem value="60">1시간 전</SelectItem>
                <SelectItem value="1440">1일 전</SelectItem>
              </SelectContent>
            </Select>
          </FormField>

          {/* 반복 설정 — 빈도/간격/종료 (이슈 #111) */}
          <FormField label="반복" htmlFor="ev-recurrence-freq">
            <Select
              value={form.watch('recurrenceFreq')}
              onValueChange={(v) =>
                form.setValue('recurrenceFreq', v as FormValues['recurrenceFreq'])
              }
              disabled={isReadOnly}
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
          </FormField>

          {/* freq ≠ NONE 일 때만 간격/종료 조건 표시 */}
          {form.watch('recurrenceFreq') !== 'NONE' && (
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
          {/* onInvite/onRemove 는 내가 ORGANIZER 일 때만 노출 — 외부 일정은 읽기 전용 (#547) */}
          <AttendeeSection
            selectedMembers={selectedAttendees}
            onChange={setSelectedAttendees}
            attendees={eventWithDetail?.attendees}
            onInvite={
              isEdit && eventWithDetail?.myRole === 'ORGANIZER'
                ? (userId) => inviteAttendees.mutate([userId])
                : undefined
            }
            onRemove={
              isEdit && eventWithDetail?.myRole === 'ORGANIZER'
                ? (userId) => removeAttendee.mutate(userId)
                : undefined
            }
          />

          {/* 설명 */}
          <FormField label="설명" htmlFor="ev-description">
            <Textarea
              id="ev-description"
              data-testid="calendar-form-description"
              placeholder="설명 (선택)"
              rows={3}
              disabled={isReadOnly}
              {...form.register('description')}
            />
          </FormField>

          {/* RSVP 응답 — 본인이 참석자이고 주최자·AGENT·외부 일정이 아닌 경우에만 표시 (이슈 #489, #547) */}
          {showRsvp && !eventWithDetail?.external && eventWithDetail && (
            <RsvpControls
              eventId={eventWithDetail.id}
              current={eventWithDetail.myRsvpStatus!}
            />
          )}

          <DialogFooter className="pt-2">
            {/* 편집 모드에서 onDelete 제공 시 삭제 버튼 표시 — 읽기전용이면 숨김 (이슈 #501) */}
            {isEdit && onDelete && !isReadOnly && (
              <Button
                type="button"
                variant="destructive"
                data-testid="calendar-form-delete"
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
                {isReadOnly ? '닫기' : '취소'}
              </Button>
              {/* 읽기전용 캘린더 이벤트는 저장 버튼 숨김 (이슈 #501) */}
              {!isReadOnly && (
                <Button type="submit" data-testid="calendar-form-submit" disabled={isPending}>
                  {isPending ? '저장 중…' : isEdit ? '수정' : '저장'}
                </Button>
              )}
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
