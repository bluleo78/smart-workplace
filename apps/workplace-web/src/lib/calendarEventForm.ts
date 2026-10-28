// 일정 생성/편집 다이얼로그(EventDialog)의 화면 독립 로직 — 폼 스키마·종일 정규화·요청 조립·편집 가능 판정.
// 컴포넌트에서 분리해 vitest 로 입력→출력을 직접 검증한다(WP-412). 화면 반영(비활성·숨김)은 E2E 가 담당.
import { addDays, addMilliseconds, format, parse } from 'date-fns'
import { z } from 'zod'

import { allDayLocalDate, isNotEventOrganizer } from '@/lib/calendar'
import { formatDateKey, parseValidDateKey } from '@/lib/formatters'
import { buildRRule, type RecurrenceForm } from '@/lib/recurrence'
import { isSupportedDateKey, SUPPORTED_DATE_RANGE_MESSAGE } from '@/lib/supportedDate'
import type { Calendar, CalendarEvent, CalendarEventRequest } from '@/types/calendar'

// ────────────────────────────────────────────────────────────
// Zod 스키마
// ────────────────────────────────────────────────────────────
/** 반복 간격 상한 — 서버(RecurrenceExpander.MAX_INTERVAL, WP-760)·Outlook 과 같다. */
export const MAX_RECURRENCE_INTERVAL = 999
/** 반복 횟수 상한 — 서버(RecurrenceExpander.MAX_COUNT, WP-905)·Outlook 과 같다. 없으면 21억 넘는 값이 서버에서 「1 이상」으로 잘못 거절됐다. */
export const MAX_RECURRENCE_COUNT = 999

export const eventFormSchema = z
  .object({
    title: z.string().min(1, '제목을 입력하세요').max(200, '제목은 200자 이하여야 합니다'),
    allDay: z.boolean(),
    start: z.string().min(1, '시작을 입력하세요'),
    end: z.string().min(1, '종료를 입력하세요'),
    location: z.string().max(200, '장소는 200자 이하여야 합니다').optional(),
    // 서버 CalendarEventRequest 상한과 같다(WP-543).
    description: z.string().max(10000, '설명은 10000자 이하여야 합니다').optional(),
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
  // 시작·종료 검증 — 연도를 5자리 이상으로 넣으면 datetime-local 값이 Date 로 해석되지 않아(Invalid Date)
  // 순서 비교가 항상 false 가 된다. 그대로 두면 순서가 맞는데도 「종료는 시작보다 뒤여야 합니다」로 오안내하므로
  // 해석 불가인 칸에 원인(연도 자릿수)을 먼저 알리고 순서 비교는 둘 다 유효할 때만 한다(WP-902).
  .superRefine((v, ctx) => {
    const startMs = new Date(v.start).getTime()
    const endMs = new Date(v.end).getTime()
    const invalid = { start: Number.isNaN(startMs), end: Number.isNaN(endMs) }
    for (const field of ['start', 'end'] as const) {
      // 빈 값은 필드 자체의 필수 메시지가 안내하므로 겹쳐 내지 않는다.
      if (invalid[field] && v[field]) {
        ctx.addIssue({
          code: 'custom',
          message: '날짜와 시각을 올바르게 입력하세요 (연도는 4자리)',
          path: [field],
        })
      }
    }
    if (!invalid.start && !invalid.end && endMs <= startMs) {
      // 종일 폼 값의 종료는 마지막 날 다음 자정(배타적 끝)이라 하루 일정도 end > start 다 — 여기 걸리면 화면의 종료일(마지막 날 포함)이 시작일보다 앞선 것이다(WP-1072).
      const message = v.allDay ? '종료일은 시작일보다 앞설 수 없습니다' : '종료는 시작보다 뒤여야 합니다'
      ctx.addIssue({ code: 'custom', message, path: ['end'] })
    }
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
    } else if ((v.recurrenceInterval ?? 0) > MAX_RECURRENCE_INTERVAL) {
      // 서버 상한(WP-760)과 같다 — 넘으면 서버가 400 으로 거절하므로 저장 전에 알린다.
      ctx.addIssue({
        code: 'custom',
        message: `간격은 ${MAX_RECURRENCE_INTERVAL} 이하여야 합니다`,
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
    // 범위 밖 종료 날짜(5자리 연도 등) — 날짜 칸이 그대로 내보내 RRULE 조립 때 깨져 「저장」이 아무 반응도 없었다(WP-904).
    // 서버와 같은 범위 문구로 막는다. 이 오류가 있으면 아래 순서 비교는 하지 않는다(문자열 비교가 뜻이 없다).
    if (v.recurrenceEnd === 'until' && v.recurrenceUntil && !isSupportedDateKey(v.recurrenceUntil)) {
      ctx.addIssue({ code: 'custom', message: SUPPORTED_DATE_RANGE_MESSAGE, path: ['recurrenceUntil'] })
    } else if (v.recurrenceEnd === 'until' && v.recurrenceUntil && v.recurrenceUntil < v.start.slice(0, 10)) {
      // 반복 종료 날짜가 시작일보다 이전이면 회차가 0개로 전개되어 조회·삭제 불가능한
      // orphan 일정이 된다(이슈 #114). 시작일(날짜 부분) 이상인지 검증한다.
      // start='YYYY-MM-DDTHH:mm', recurrenceUntil='YYYY-MM-DD' — 둘 다 로컬 ISO 라
      // 날짜 부분 문자열 비교로 안전하게 순서 판정(같은 날은 1회차 발생하므로 허용).
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
    } else if (v.recurrenceEnd === 'count' && (v.recurrenceCount ?? 0) > MAX_RECURRENCE_COUNT) {
      ctx.addIssue({
        code: 'custom',
        message: `횟수는 ${MAX_RECURRENCE_COUNT} 이하여야 합니다`,
        path: ['recurrenceCount'],
      })
    }
  })

export type EventFormValues = z.infer<typeof eventFormSchema>

// ────────────────────────────────────────────────────────────
// 종일 정규화
// ────────────────────────────────────────────────────────────

/** datetime-local 문자열에서 날짜 부분(YYYY-MM-DD)만 추출 */
function localDateOnly(local: string): string {
  return local.slice(0, 10)
}

/** YYYY-MM-DD 문자열에 일 단위를 더한 YYYY-MM-DD 반환 (타임존 독립·달력 날짜 연산만) */
function addDaysToDateOnly(dateOnly: string, days: number): string {
  return format(addDays(parse(dateOnly, 'yyyy-MM-dd', new Date()), days), 'yyyy-MM-dd')
}

/**
 * "종일" 체크 시 시작/종료를 자정 경계(half-open [start, end))로 정규화한다.
 *
 * calendar.ts eventsOnDay() 의 종일 비교가 `cellKey < dateKey(endsAt)` (배타적 end) 라서
 * 시작·종료가 같은 날짜이면 항상 false 가 되어 월/TimeGrid 뷰에서 사라진다 (이슈 #575).
 * - 시작 날짜는 그대로, 시각만 00:00 으로
 * - 종료가 시작과 같은 날(또는 그 이전)이면 다음날 00:00 으로 밀어 최소 하루 범위를 보장
 * - 이미 여러 날에 걸친 값이면 날짜는 유지하고 시각만 00:00 으로 정규화
 */
export function normalizeAllDayRange(start: string, end: string): { start: string; end: string } {
  const startDate = localDateOnly(start)
  const endDate = end ? localDateOnly(end) : startDate
  const normalizedEndDate = endDate <= startDate ? addDaysToDateOnly(startDate, 1) : endDate
  return { start: `${startDate}T00:00`, end: `${normalizedEndDate}T00:00` }
}

/**
 * 종일 일정의 폼 값(자정 경계 half-open [start, end)) → 화면에 보일 날짜 칸 값(WP-1072).
 * 종료는 마지막 날을 포함하는 날짜로 보인다 — 배타적 끝(다음 날 0시)을 그대로 보이면 10/28 하루 일정이 「10/28 – 10/29」로 보여,
 * 그 날짜를 고친 사람이 고른 종료일이 달력에서 하루 빠졌다. 종료가 시작 이하이면 시작과 같은 날로 본다.
 */
export function allDayDisplayDates(start: string, end: string): { startDate: string; endDate: string } {
  const startDate = localDateOnly(start)
  const exclusiveEnd = localDateOnly(end)
  // 비었거나 날짜로 읽을 수 없으면(연도 5자리 등) 그대로 보인다 — 날짜 연산이 던지지 않게, 오류는 스키마가 알린다(WP-902).
  if (!isDateOnly(startDate) || !isDateOnly(exclusiveEnd)) return { startDate, endDate: exclusiveEnd }
  const endDate = exclusiveEnd > startDate ? addDaysToDateOnly(exclusiveEnd, -1) : startDate
  return { startDate, endDate }
}

/**
 * 종일 날짜 칸 값(종료는 마지막 날 포함) → 폼 값(자정 경계 half-open [start, end)) — {@link allDayDisplayDates} 의 반대 방향.
 * 종료일이 시작일보다 앞이면 그대로 하루 앞의 배타적 끝을 만들어 스키마가 「종료일은 시작일보다 앞설 수 없습니다」로 막게 둔다.
 * 빈 칸은 빈 값, 날짜로 읽을 수 없는 칸은 그 글자 그대로 넘겨 스키마가 필수·연도 오류로 알리게 한다(칸을 지우고 다시 입력할 수 있게).
 */
export function allDayRangeFromDates(startDate: string, endDate: string): { start: string; end: string } {
  const toMidnight = (date: string) => date && `${date}T00:00`
  return { start: toMidnight(startDate), end: toMidnight(isDateOnly(endDate) ? addDaysToDateOnly(endDate, 1) : endDate) }
}

/** YYYY-MM-DD 이고 실제 달력 날짜인가 — 날짜 연산(addDaysToDateOnly) 전에 거른다 */
function isDateOnly(value: string): boolean {
  return parseValidDateKey(value) !== undefined
}

/** 종일 일정의 ISO → 그 캘린더 날짜의 자정 폼 값 — allDayLocalDate 로 저장 규약(동기화 UTC 자정·로컬 자정) 차이를 흡수한다(WP-1072). */
export function allDayFormValue(iso: string): string {
  return `${formatDateKey(allDayLocalDate(iso))}T00:00`
}

/**
 * 종일 날짜를 고치지 않은 저장이면 저장된 시각을 그대로 보낸다(WP-1072) — 동기화 일정(UTC 자정)을 로컬 자정으로 바꿔 보내면
 * 제목만 고쳐도 서버가 일정 변경으로 보고 참석자 알림·리마인더·외부 동기화를 다시 돈다.
 */
export function keepStoredAllDayInstants<T extends { startsAt: string; endsAt: string }>(
  request: T,
  values: Pick<EventFormValues, 'allDay' | 'start' | 'end'>,
  event: Pick<CalendarEvent, 'allDay' | 'startsAt' | 'endsAt'> | null | undefined,
): T {
  const unchanged =
    event?.allDay &&
    values.allDay &&
    values.start === allDayFormValue(event.startsAt) &&
    values.end === allDayFormValue(event.endsAt)
  return unchanged ? { ...request, startsAt: event.startsAt, endsAt: event.endsAt } : request
}

const LOCAL_INPUT_FORMAT = "yyyy-MM-dd'T'HH:mm"

/**
 * "종일" 을 풀 때 체크하기 전 시각을 되살린다(WP-711). 체크할 때 시작·종료를 자정으로 덮어써 두었기 때문에, 그때의 시각(remembered)을
 * 지금 시작 날짜에 다시 얹는다 — 종일인 동안 날짜를 옮겼으면 옮긴 날짜에 원래 시각·길이(예: 10:00~11:00)로 돌아온다.
 */
export function restoreTimedRange(
  current: { start: string; end: string },
  remembered: { start: string; end: string },
): { start: string; end: string } {
  const durationMs =
    parse(remembered.end, LOCAL_INPUT_FORMAT, new Date()).getTime() -
    parse(remembered.start, LOCAL_INPUT_FORMAT, new Date()).getTime()
  const start = `${localDateOnly(current.start)}T${remembered.start.slice(11, 16)}`
  const end = format(addMilliseconds(parse(start, LOCAL_INPUT_FORMAT, new Date()), durationMs), LOCAL_INPUT_FORMAT)
  return { start, end }
}

// ────────────────────────────────────────────────────────────
// 제출 요청 조립
// ────────────────────────────────────────────────────────────

/** 반복 폼 모델 → 평탄한 폼 필드 — 다이얼로그를 열 때 프리필과 잠긴 규칙 풀기(WP-708)가 같이 쓴다. toEventRequest 의 반대 방향. */
export function recurrenceToFormValues(
  rec: RecurrenceForm,
): Pick<EventFormValues, 'recurrenceFreq' | 'recurrenceInterval' | 'recurrenceEnd' | 'recurrenceUntil' | 'recurrenceCount'> {
  return {
    recurrenceFreq: rec.freq,
    recurrenceInterval: rec.interval,
    recurrenceEnd: rec.end.type,
    recurrenceUntil: rec.end.type === 'until' ? rec.end.date : '',
    recurrenceCount: rec.end.type === 'count' ? rec.end.count : 1,
  }
}

/**
 * 검증된 폼 값 → 일정 생성/수정 요청 바디.
 *
 * - 평탄한 반복 필드를 RecurrenceForm 으로 조립해 RRULE 로 만든다(freq=NONE 이면 null, 이슈 #111).
 * - 참석자는 생성 모드에서만 담는다 — 편집은 별도 invite/remove API 를 쓴다(이슈 #489).
 */
export function toEventRequest(
  values: EventFormValues,
  opts: {
    isEdit: boolean
    defaultCalendarId: number | undefined
    attendeeUserIds: number[]
    /** 폼이 담을 수 없는 반복 규칙(isFormEditableRRule=false)이면 그 원래 규칙 — 폼 값 대신 그대로 보낸다(WP-708) */
    lockedRecurrenceRule?: string | null
  },
): CalendarEventRequest {
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

  return {
    title: values.title,
    allDay: values.allDay,
    // datetime-local(로컬) → ISO(UTC)
    startsAt: new Date(values.start).toISOString(),
    endsAt: new Date(values.end).toISOString(),
    location: values.location?.trim() || null,
    description: values.description?.trim() || null,
    // 색 override — null 이면 캘린더 색 상속
    color: values.color,
    // 캘린더 컨테이너 — 미선택 시 기본 캘린더로 폴백
    calendarId: values.calendarId ?? opts.defaultCalendarId,
    // 'none'(없음) → null, 그 외 분 단위 숫자로 변환
    reminderMinutes: values.reminderMinutes === 'none' ? null : Number(values.reminderMinutes),
    recurrenceRule: opts.lockedRecurrenceRule ?? buildRRule(recForm),
    attendeeUserIds: opts.isEdit ? undefined : opts.attendeeUserIds,
  }
}

// ────────────────────────────────────────────────────────────
// 편집 가능 판정
// ────────────────────────────────────────────────────────────

/** 읽기전용 사유 안내 라벨 — testId 는 E2E 가 사유별로 구분할 때 쓴다. */
export interface ReadOnlyLabel {
  testId: 'event-organizer-only-label' | 'event-synced-label'
  text: string
}

export interface EventEditability {
  /** 읽기전용 — 저장·삭제 숨김 + 입력 비활성 */
  isReadOnly: boolean
  /** 읽기전용 사유 라벨 (편집 가능하면 null) */
  readOnlyLabel: ReadOnlyLabel | null
  /** 편집 모드 참석자 즉시 초대·제거 가능 여부 */
  canManageAttendees: boolean
  /** 내 캘린더가 아닌 일정(초대받아 보이는 다른 사람 캘린더 일정) — 캘린더 칸을 「초대받은 일정」으로 보인다(WP-604) */
  isInvited: boolean
}

/**
 * 일정 다이얼로그의 편집 가능 여부와 읽기전용 사유를 판정한다.
 *
 * - 주최자만 수정 가능(WP-200): 내 캘린더에 없는 일정(초대받은 다른 사람 일정)이거나, 내 동기화 사본이어도
 *   주최자가 아니면 수정 불가. 캘린더 목록 로드 전엔 "내 캘린더 아님"을 판단하지 않는다(로딩 중 잠깐 잠기는 깜빡임 방지).
 *   백엔드 requireOwner+requireOrganizer 와 같은 술어.
 * - 읽기전용 = 외부 읽기전용 캘린더(#501) 또는 주최자 아님. 사유는 주최자 아님을 우선 안내한다
 *   ("동기화됨"만으로는 왜 못 고치는지 알 수 없다).
 * - 참석자 관리는 주최자 + 읽기전용 아님일 때만(생성 모드는 myRole 이 없어 false).
 */
export function eventEditability(args: {
  isEdit: boolean
  calendars: Pick<Calendar, 'id' | 'isReadOnly'>[]
  /** 다이얼로그에 넘어온 목록 이벤트(편집 모드) */
  event: Pick<CalendarEvent, 'calendarId' | 'myRole'> | null | undefined
  /** 상세 조회 결과 — 로드 전이면 undefined */
  detailEvent: Pick<CalendarEvent, 'myRole' | 'attendees'> | null | undefined
}): EventEditability {
  const { isEdit, calendars, event, detailEvent } = args
  const eventCalendar = calendars.find((c) => c.id === event?.calendarId)
  const isInvited = isEdit && calendars.length > 0 && !eventCalendar
  const notOrganizer = isInvited || (isEdit && isNotEventOrganizer(detailEvent))
  const isReadOnly = isEdit && ((eventCalendar?.isReadOnly ?? false) || notOrganizer)
  const readOnlyLabel: ReadOnlyLabel | null = notOrganizer
    ? { testId: 'event-organizer-only-label', text: '주최자만 수정할 수 있어요' }
    : isReadOnly
      ? { testId: 'event-synced-label', text: 'M365에서 동기화됨' }
      : null
  const myRole = (detailEvent ?? event)?.myRole
  return { isReadOnly, readOnlyLabel, canManageAttendees: !isReadOnly && myRole === 'ORGANIZER', isInvited }
}

/**
 * RSVP 컨트롤 노출 여부 — 본인이 참석자이고 주최자·AGENT 가 아니며, 응답 상태가 있고 외부(M365) 일정이 아닐 때만.
 * 외부 일정의 응답은 공급자 쪽에서 관리하므로 여기서 바꾸지 않는다(#489, #547).
 */
export function shouldShowRsvp(
  isEdit: boolean,
  userId: number | null | undefined,
  event: Pick<CalendarEvent, 'attendees' | 'myRsvpStatus' | 'external'> | null | undefined,
): boolean {
  if (!isEdit || userId == null || !event || event.external) return false
  const myAttendee = event.attendees?.find((a) => a.userId === userId)
  return (
    myAttendee != null &&
    myAttendee.role !== 'ORGANIZER' &&
    myAttendee.kind !== 'AGENT' &&
    event.myRsvpStatus != null
  )
}
