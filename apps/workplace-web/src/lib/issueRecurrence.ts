// 개인 작업 반복(WP-989) — 편집 폼 모델 ↔ RRULE, 요약·다음 실행·멈춤 문구를 만드는 순수 함수.
// 빈도 타입(RecurrenceFreq)과 RRULE 토큰화(tokenizeRRule)는 캘린더 반복 유틸(lib/recurrence)을 그대로 쓰고,
// 이 기능만 쓰는 BYDAY(매주 요일)·BYMONTHDAY(매월 날짜)를 덧붙여 읽고 쓴다. 가장 짧은 주기는 하루 1회(INTERVAL 없음).
import { kstParts, kstWeekday, parseUtcDate } from './formatters';
import { type RecurrenceFreq, tokenizeRRule } from './recurrence';

/** RRULE 요일 코드 — 월요일부터(화면의 요일 버튼 순서). */
export const WEEKDAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
export type WeekdayCode = (typeof WEEKDAY_CODES)[number];

/** 요일 코드 → 한 글자(월~일). */
export const WEEKDAY_SHORT: Record<WeekdayCode, string> = { MO: '월', TU: '화', WE: '수', TH: '목', FR: '금', SA: '토', SU: '일' };

/** 반복 편집 폼 — freq 'NONE' 은 「반복 안 함」. byDay 는 매주, monthDay 는 매월에서만 쓴다. time 은 한국 시간 'HH:mm'. */
export interface TaskRecurrenceForm {
  freq: RecurrenceFreq;
  byDay: WeekdayCode[];
  monthDay: number;
  time: string;
}

/** 새 반복 기본값 — 반복 안 함, 고르면 매주 월요일·매월 1일·09:00 부터 시작한다. */
export const DEFAULT_TASK_RECURRENCE_FORM: TaskRecurrenceForm = { freq: 'NONE', byDay: ['MO'], monthDay: 1, time: '09:00' };

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** BYMONTHDAY 값(「15」 또는 「1,15」) → 1~31 정수 목록(오름차순·중복 제거). 범위 밖·숫자 아님이 섞이면 빈 목록. */
function monthDays(raw: string | undefined): number[] {
  if (!raw) return [];
  const nums = raw.split(',').map((v) => Number(v));
  if (nums.some((n) => !Number.isInteger(n) || n < 1 || n > 31)) return [];
  return [...new Set(nums)].sort((a, b) => a - b);
}

/** 이 날짜가 없는 달이 있는가(29~31일) — 서버는 RFC 5545 대로 그 달을 건너뛴다. 편집기 안내용. */
export function monthDayMaySkip(day: number): boolean {
  return Number.isInteger(day) && day >= 29 && day <= 31;
}

/** 요일 코드를 월~일 순으로 정렬·중복 제거 — 같은 규칙이 늘 같은 문자열·문구가 되게. */
function sortDays(days: readonly string[]): WeekdayCode[] {
  return WEEKDAY_CODES.filter((c) => days.includes(c));
}

/**
 * 폼 → PUT 본문용 RRULE. 반복 안 함이면 null.
 * 예: 매일 → FREQ=DAILY, 매주 월·수 → FREQ=WEEKLY;BYDAY=MO,WE, 매월 15일 → FREQ=MONTHLY;BYMONTHDAY=15
 */
export function buildTaskRRule(form: TaskRecurrenceForm): string | null {
  // 가장 짧은 주기는 하루 1회 — INTERVAL·종료 조건은 두지 않는다.
  if (form.freq === 'NONE') return null;
  const base = `FREQ=${form.freq}`;
  if (form.freq === 'WEEKLY') return `${base};BYDAY=${sortDays(form.byDay).join(',')}`;
  if (form.freq === 'MONTHLY') return `${base};BYMONTHDAY=${form.monthDay}`;
  return base;
}

/**
 * 서버의 RRULE·시각 → 폼. 반복이 없거나(null) 읽을 수 없는 규칙이면 기본값(반복 안 함)에 시각만 옮긴다.
 * 매주인데 BYDAY 가 없으면 월요일, 매월인데 날짜가 없거나 범위 밖이면 1일로 채운다(서버가 거절하는 모양이라 드묾).
 */
export function parseTaskRRule(rrule: string | null | undefined, time?: string | null): TaskRecurrenceForm {
  const form: TaskRecurrenceForm = { ...DEFAULT_TASK_RECURRENCE_FORM, byDay: [...DEFAULT_TASK_RECURRENCE_FORM.byDay] };
  if (time && TIME_RE.test(time)) form.time = time;
  if (!rrule) return form;
  // 토큰화는 캘린더 반복 유틸과 같은 방식으로 한 번만 — 지원하지 않는 FREQ(또는 누락)는 반복 안 함.
  const { map } = tokenizeRRule(rrule);
  const freq = map.get('FREQ');
  form.freq = freq === 'DAILY' || freq === 'WEEKLY' || freq === 'MONTHLY' ? freq : 'NONE';
  const days = sortDays((map.get('BYDAY') ?? '').split(','));
  if (days.length > 0) form.byDay = days;
  // 편집기는 날짜 하나만 다룬다 — 여러 날짜(1,15)면 첫 날짜로 시작한다(요약 문구는 전부 보인다).
  const mds = monthDays(map.get('BYMONTHDAY'));
  if (mds.length > 0) form.monthDay = mds[0];
  return form;
}

/** 저장 전 검사 — 문제가 있으면 화면에 보일 문구, 없으면 null. 반복 안 함은 늘 통과. */
export function validateTaskRecurrence(form: TaskRecurrenceForm): string | null {
  if (form.freq === 'NONE') return null;
  if (form.freq === 'WEEKLY' && form.byDay.length === 0) return '요일을 하나 이상 고르세요';
  if (form.freq === 'MONTHLY' && !(Number.isInteger(form.monthDay) && form.monthDay >= 1 && form.monthDay <= 31)) {
    return '날짜는 1일부터 31일 사이로 고르세요';
  }
  if (!TIME_RE.test(form.time)) return '시각을 HH:mm 으로 입력하세요';
  return null;
}

/**
 * 반복 요약 문구 — 「매일 08:30」, 「매주 월·수 08:30」, 「매월 15일 08:30」, 「매월 1·15일 08:30」.
 * 이 화면이 다루지 못하는 규칙(다른 FREQ·빠진 요일 등)은 원문 RRULE 을 그대로 보인다(뜻을 지어내지 않는다).
 */
export function recurrenceLabel(rrule: string, time: string): string {
  const { map } = tokenizeRRule(rrule);
  const freq = map.get('FREQ');
  if (freq === 'DAILY') return `매일 ${time}`;
  if (freq === 'WEEKLY') {
    const days = sortDays((map.get('BYDAY') ?? '').split(','));
    if (days.length > 0) return `매주 ${days.map((d) => WEEKDAY_SHORT[d]).join('·')} ${time}`;
  }
  if (freq === 'MONTHLY') {
    // 여러 날짜면 「매월 1·15일」.
    const mds = monthDays(map.get('BYMONTHDAY'));
    if (mds.length > 0) return `매월 ${mds.join('·')}일 ${time}`;
  }
  return `${rrule} ${time}`;
}

/** 다음 실행 문구 — 「다음 실행 10/29(목) 08:30」(한국 시간). 시각이 없거나 읽을 수 없으면 null. */
export function nextRunText(nextRunAt: string | null | undefined): string | null {
  if (!nextRunAt) return null;
  const d = parseUtcDate(nextRunAt);
  if (Number.isNaN(d.getTime())) return null;
  const t = kstParts(d);
  const hh = String(t.h).padStart(2, '0');
  const mm = String(t.min).padStart(2, '0');
  return `다음 실행 ${t.m}/${t.d}(${kstWeekday(t)}) ${hh}:${mm}`;
}

/**
 * 꺼진 반복의 상태 문구 — 켜져 있으면 null, 연속 실패로 멈췄으면(3회 이상) 「멈춤 — 3회 연속 실패」, 그 밖에는 「꺼짐」.
 */
export function recurrencePausedText(r: { enabled: boolean; consecutiveFailures?: number | null }): string | null {
  if (r.enabled) return null;
  const n = r.consecutiveFailures ?? 0;
  return n >= 3 ? `멈춤 — ${n}회 연속 실패` : '꺼짐';
}
