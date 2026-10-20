// 일정 생성/편집 다이얼로그(EventDialog)의 화면 독립 로직 — 폼 스키마·종일 정규화·요청 조립·편집 가능 판정.
// 컴포넌트에서 분리해 vitest 로 입력→출력을 직접 검증한다(WP-412). 화면 반영(비활성·숨김)은 E2E 가 담당.
import { addDays, format, parse } from 'date-fns'
import { z } from 'zod'

import { isNotEventOrganizer } from '@/lib/calendar'
import { buildRRule, type RecurrenceForm } from '@/lib/recurrence'
import type { Calendar, CalendarEvent, CalendarEventRequest } from '@/types/calendar'

// ────────────────────────────────────────────────────────────
// Zod 스키마
// ────────────────────────────────────────────────────────────
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

// ────────────────────────────────────────────────────────────
// 제출 요청 조립
// ────────────────────────────────────────────────────────────

/**
 * 검증된 폼 값 → 일정 생성/수정 요청 바디.
 *
 * - 평탄한 반복 필드를 RecurrenceForm 으로 조립해 RRULE 로 만든다(freq=NONE 이면 null, 이슈 #111).
 * - 참석자는 생성 모드에서만 담는다 — 편집은 별도 invite/remove API 를 쓴다(이슈 #489).
 */
export function toEventRequest(
  values: EventFormValues,
  opts: { isEdit: boolean; defaultCalendarId: number | undefined; attendeeUserIds: number[] },
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
    recurrenceRule: buildRRule(recForm),
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
