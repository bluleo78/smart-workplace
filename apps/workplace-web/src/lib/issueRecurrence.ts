// 개인 작업 반복(WP-989) — 편집 폼 모델 ↔ RRULE, 요약·다음 실행·멈춤 문구를 만드는 순수 함수.
// 빈도 타입(RecurrenceFreq)과 RRULE 토큰화(tokenizeRRule)는 캘린더 반복 유틸(lib/recurrence)을 그대로 쓰고,
// 이 기능만 쓰는 BYDAY(매주 요일)·BYMONTHDAY(매월 날짜)를 덧붙여 읽고 쓴다. 매일·매주·매월은 하루 1회(INTERVAL 없음).
// WP-1315: 「한 번만」(FREQ=ONCE;DATE=yyyy-MM-dd — 정한 날짜·시각에 한 번 실행하고 일정이 꺼진다)과 「평일」(매주 월~금의 줄임) 칩을 더했다.
// WP-1373: 「몇 시간마다」(FREQ=HOURLY;INTERVAL=n;BYDAY=..;UNTILTIME=HH:mm — 고른 요일마다 시작 시각(time)부터 n 시간 간격으로, 끝 시각 이하인
// 회차만 실행) 칩을 더했다. 서버(IssueRecurrenceRules)와 같은 규칙이다.
// WP-1413: 「몇 시간마다」에 「시간대 정하기」 스위치(기본 꺼짐 = 하루 종일)를 더했다. 서버는 그대로 — 꺼짐은 시작 00:00 + UNTILTIME=23:59 로 저장하고,
// 읽을 때 이 조합이면 꺼짐으로 그린다(사용자가 직접 00:00~23:59 를 고른 것과 실행이 같으므로 같게 보여도 된다).
import type { IssueRecurrence } from '../types/issueRecurrence';
import { kstParts, kstWeekday, parseUtcDate } from './formatters';
import { type RecurrenceFreq, tokenizeRRule } from './recurrence';

/** RRULE 요일 코드 — 월요일부터(화면의 요일 버튼 순서). */
export const WEEKDAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
export type WeekdayCode = (typeof WEEKDAY_CODES)[number];

/** 요일 코드 → 한 글자(월~일). */
export const WEEKDAY_SHORT: Record<WeekdayCode, string> = { MO: '월', TU: '화', WE: '수', TH: '목', FR: '금', SA: '토', SU: '일' };

/** 「평일」 — 매주 월~금(WP-1315). 저장 모양은 FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR 이다(서버에 따로 있는 값이 아니다). */
export const WEEKDAYS_ONLY: readonly WeekdayCode[] = ['MO', 'TU', 'WE', 'TH', 'FR'];

/**
 * 실행 일정 칩 값 — 캘린더 반복의 안 함·매일·매주·매월에 「한 번만」(ONCE)과 「평일」(WEEKDAYS, 매주 월~금의 줄임)을 더한다(WP-1315).
 * WP-1373: 「몇 시간마다」(HOURLY).
 */
export type TaskRecurrenceFreq = RecurrenceFreq | 'ONCE' | 'WEEKDAYS' | 'HOURLY';

/** 이슈 상세 편집기의 일정 칩 — 「안 함」으로 저장하면 일정을 끈다. 「몇 시간마다」(WP-1373)는 기존 칩 뒤에 둔다. */
export const EDITOR_FREQS: TaskRecurrenceFreq[] = ['NONE', 'ONCE', 'DAILY', 'WEEKDAYS', 'WEEKLY', 'MONTHLY', 'HOURLY'];

/** 만들기 창의 일정 칩(WP-1315) — 끄기는 「맡기지 않기」가 따로 한다. */
export const CREATE_FREQS: TaskRecurrenceFreq[] = ['ONCE', 'DAILY', 'WEEKDAYS', 'WEEKLY', 'MONTHLY', 'HOURLY'];

/** 「몇 시간마다」에 고를 수 있는 간격(시간, WP-1373) — 서버 IssueRecurrenceRules.HOURLY_INTERVALS 와 같다. 최소 1시간. */
export const HOURLY_INTERVALS = [1, 2, 3, 4, 6, 12] as const;

/** 고를 수 있는 「몇 시간마다」 간격인가(WP-1373) — 규칙 읽기·검사가 같이 쓴다. */
function isHourlyInterval(n: number): boolean {
  return (HOURLY_INTERVALS as readonly number[]).includes(n);
}

/**
 * 반복 편집 폼 — freq 'NONE' 은 「반복 안 함」. byDay 는 매주, monthDay·otherMonthDays 는 매월에서만 쓴다. time 은 한국 시간 'HH:mm'.
 * 편집기는 날짜 하나(monthDay)만 고치게 한다. API·AI 로 저장된 여러 날짜(1,15)의 나머지는 otherMonthDays 에 그대로 두어
 * 열고 저장해도 빠지지 않게 한다(WP-1117). onceDate 는 저장된 「한 번만」 예약의 날짜(yyyy-MM-dd) — 다른 칸만 고쳐 저장해도 날짜가 바뀌지 않게
 * 들고 있는다(WP-1315). 새 「한 번만」은 null 이고 그 시각의 다음 때(오늘, 지났으면 내일)로 정해진다.
 * 「몇 시간마다」(WP-1373)는 time 을 시작 시각으로 쓰고, interval(시간)·untilTime(끝 시각 'HH:mm', 이 시각 이하 회차까지)·hourlyDays(요일)를
 * 따로 든다 — 매주의 byDay 와 나눠 두어, 칩을 오가도 서로의 요일이 바뀌지 않게 한다.
 * hourlyWindow(WP-1413)는 「시간대 정하기」 스위치 — 꺼지면 하루 종일(00:00~23:59)로 저장하되 time·untilTime 은 그대로 들고 있어,
 * 창이 열려 있는 동안 다시 켜면 입력했던 시각이 되살아난다.
 */
export interface TaskRecurrenceForm {
  freq: TaskRecurrenceFreq;
  byDay: WeekdayCode[];
  monthDay: number;
  otherMonthDays: number[];
  time: string;
  onceDate?: string | null;
  interval: number;
  untilTime: string;
  hourlyDays: WeekdayCode[];
  hourlyWindow: boolean;
}

/**
 * 새 반복 기본값 — 반복 안 함, 고르면 매주 월요일·매월 1일·09:00 부터 시작한다.
 * 「몇 시간마다」는 평일 2시간마다, 시간대 꺼짐(하루 종일, WP-1413) — 스위치를 켜면 09:00~18:00 부터 고친다(WP-1373 시안).
 */
export const DEFAULT_TASK_RECURRENCE_FORM: TaskRecurrenceForm = {
  freq: 'NONE',
  byDay: ['MO'],
  monthDay: 1,
  otherMonthDays: [],
  time: '09:00',
  onceDate: null,
  interval: 2,
  untilTime: '18:00',
  hourlyDays: ['MO', 'TU', 'WE', 'TH', 'FR'],
  hourlyWindow: false,
};

/** 「하루 종일」(시간대 꺼짐, WP-1413)의 저장 모양 — 시작 00:00, 끝 23:59. 서버를 바꾸지 않고 이 조합을 꺼짐으로 읽는다. */
const ALL_DAY_START = '00:00';
const ALL_DAY_UNTIL = '23:59';

/** 이 시작·끝 시각이 「하루 종일」(시간대 꺼짐) 저장 모양인가(WP-1413) — 규칙 읽기와 요약이 같이 쓴다. */
function isAllDayWindow(start: string, until: string): boolean {
  return start === ALL_DAY_START && until === ALL_DAY_UNTIL;
}

/** 시간대를 정하지 않은 「몇 시간마다」인가(WP-1413) — 그러면 입력해 둔 시각 대신 하루 종일로 저장·계산한다. */
function isAllDayHourly(form: TaskRecurrenceForm): boolean {
  return form.freq === 'HOURLY' && !form.hourlyWindow;
}

/**
 * 서버에 보낼 실행(시작) 시각(WP-1413) — 시간대를 정하지 않은 몇 시간마다는 00:00, 그 밖에는 입력한 시각.
 * 편집기 저장·만들기 창 저장·만들기 창 요약이 같이 쓴다(폼의 time 은 다시 켤 때 되살리려고 그대로 둔다).
 */
export function taskRunTime(form: TaskRecurrenceForm): string {
  return isAllDayHourly(form) ? ALL_DAY_START : form.time;
}

/** 실제로 쓸 몇 시간마다 끝 시각(WP-1413) — 시간대를 정하지 않았으면 23:59. */
function hourlyUntil(form: TaskRecurrenceForm): string {
  return isAllDayHourly(form) ? ALL_DAY_UNTIL : form.untilTime;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 'HH:mm' → 자정부터 분. 시각 읽기는 이 함수 하나로 한다(한국 시간 순간·몇 시간마다 회차 목록이 같이 쓴다). */
function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/** 한국 시간 날짜(yyyy-MM-dd)·시각(HH:mm)의 순간(ms). 형식이 틀리면 NaN. */
function kstInstant(date: string, time: string): number {
  if (!DATE_RE.test(date) || !TIME_RE.test(time)) return NaN;
  const [y, m, d] = date.split('-').map(Number);
  // 한국 시간은 UTC+9 — 분은 Date.UTC 가 시·분으로 넘겨 받는다.
  return Date.UTC(y, m - 1, d, -9, toMinutes(time));
}

/** 한국 시간 연·월·일 → 'yyyy-MM-dd'. */
function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * 「한 번만」 예약 날짜(WP-1315) — 서버(IssueRecurrenceRules.resolveOnce)와 같은 규칙: 오늘 그 시각이 아직 안 지났으면 오늘, 지났으면(같은 분 포함)
 * 내일(한국 시간). 시각이 틀리면 null.
 */
export function onceDateFor(time: string, now: Date = new Date()): string | null {
  if (!TIME_RE.test(time)) return null;
  const t = kstParts(now);
  const today = ymd(t.y, t.m, t.d);
  if (kstInstant(today, time) > now.getTime()) return today;
  const tm = new Date(Date.UTC(t.y, t.m - 1, t.d + 1));
  return ymd(tm.getUTCFullYear(), tm.getUTCMonth() + 1, tm.getUTCDate());
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** BYMONTHDAY 값(「15」 또는 「1,15」) → 1~31 정수 목록(오름차순·중복 제거). 범위 밖·숫자 아님이 섞이면 빈 목록. */
function monthDays(raw: string | undefined): number[] {
  if (!raw) return [];
  const nums = raw.split(',').map((v) => Number(v));
  if (nums.some((n) => !Number.isInteger(n) || n < 1 || n > 31)) return [];
  return [...new Set(nums)].sort((a, b) => a - b);
}

/** 편집하는 날짜 밖에 함께 반복하는 날짜 — 편집 날짜와 같은 값은 뺀다(오름차순). 편집기 안내·저장에 쓴다. */
export function otherMonthDaysOf(form: Pick<TaskRecurrenceForm, 'monthDay' | 'otherMonthDays'>): number[] {
  return form.otherMonthDays.filter((d) => d !== form.monthDay);
}

/** 이 날짜가 없는 달이 있는가(29~31일) — 서버는 RFC 5545 대로 그 달을 건너뛴다. 편집기 안내용. */
export function monthDayMaySkip(day: number): boolean {
  return Number.isInteger(day) && day >= 29 && day <= 31;
}

/** 요일 코드를 월~일 순으로 정렬·중복 제거 — 같은 규칙이 늘 같은 문자열·문구가 되게. */
function sortDays(days: readonly string[]): WeekdayCode[] {
  return WEEKDAY_CODES.filter((c) => days.includes(c));
}

/** 「몇 시간마다」 규칙에 올 수 있는 항목(WP-1373) — 서버 IssueRecurrenceRules.normalizeHourly 가 만드는 모양. */
const HOURLY_KEYS = new Set(['FREQ', 'INTERVAL', 'BYDAY', 'UNTILTIME']);

/**
 * 「몇 시간마다」 규칙의 간격·요일·끝 시각을 읽는다(WP-1373). 하나라도 읽을 수 없으면(요일이 비었거나 모르는 요일·겹친 요일, 고를 수 없는 간격,
 * 끝 시각 형식 틀림, 모르는 항목·깨진 토큰) null — 기본값(월~금 등)으로 채워 다른 일정처럼 보이거나 저장 때 고쳐 쓰지 않게, 부르는 쪽은 다른
 * 모르는 규칙과 똑같이 다룬다(요약은 원문, 편집 폼은 「안 함」). 간격이 빠졌으면 1시간(서버 정규화와 같다).
 */
function readHourlyRule({
  map,
  clean,
}: ReturnType<typeof tokenizeRRule>): { interval: number; untilTime: string; days: WeekdayCode[] } | null {
  if (!clean || map.get('FREQ') !== 'HOURLY' || [...map.keys()].some((k) => !HOURLY_KEYS.has(k))) return null;
  const interval = Number(map.get('INTERVAL') ?? '1');
  if (!isHourlyInterval(interval)) return null;
  const untilTime = map.get('UNTILTIME') ?? '';
  if (!TIME_RE.test(untilTime)) return null;
  const raw = (map.get('BYDAY') ?? '').split(',');
  const days = sortDays(raw);
  // 빈 요일·모르는 요일(XX)·겹친 요일(MO,MO)은 걸러 낸 개수가 원래 개수와 달라진다.
  if (days.length === 0 || days.length !== raw.length) return null;
  return { interval, untilTime, days };
}

/**
 * 폼 → PUT 본문용 RRULE. 반복 안 함이면 null.
 * 예: 매일 → FREQ=DAILY, 매주 월·수 → FREQ=WEEKLY;BYDAY=MO,WE, 매월 15일 → FREQ=MONTHLY;BYMONTHDAY=15
 */
/** 「한 번만」 폼에 저장된 날짜가 아직 오지 않았으면 그 날짜, 없거나 지났으면 null(그때는 그 시각의 다음 때로 정한다, WP-1315). */
function pendingOnceDate(form: TaskRecurrenceForm, now: Date): string | null {
  return form.onceDate && kstInstant(form.onceDate, form.time) > now.getTime() ? form.onceDate : null;
}

export function buildTaskRRule(form: TaskRecurrenceForm, now: Date = new Date()): string | null {
  // 매일·매주·매월은 하루 1회 — INTERVAL·종료 조건은 두지 않는다(몇 시간마다만 간격·끝 시각을 쓴다, WP-1373).
  if (form.freq === 'NONE') return null;
  // 한 번만 — 저장된 날짜가 아직 오지 않았으면 그대로 두고, 없거나 지났으면 날짜를 빼 서버가 그 시각의 다음 때로 정하게 한다.
  if (form.freq === 'ONCE') {
    const keep = pendingOnceDate(form, now);
    return keep ? `FREQ=ONCE;DATE=${keep}` : 'FREQ=ONCE';
  }
  if (form.freq === 'WEEKDAYS') return `FREQ=WEEKLY;BYDAY=${WEEKDAYS_ONLY.join(',')}`;
  // 몇 시간마다(WP-1373) — 서버가 정규화하는 모양과 같은 순서로 쓴다(시작 시각은 time 으로 따로 보낸다).
  if (form.freq === 'HOURLY') {
    // 시간대를 정하지 않았으면(WP-1413) 끝 시각은 23:59 — 시작 시각은 taskRunTime 이 00:00 으로 보낸다.
    return `FREQ=HOURLY;INTERVAL=${form.interval};BYDAY=${sortDays(form.hourlyDays).join(',')};UNTILTIME=${hourlyUntil(form)}`;
  }
  const base = `FREQ=${form.freq}`;
  if (form.freq === 'WEEKLY') return `${base};BYDAY=${sortDays(form.byDay).join(',')}`;
  if (form.freq === 'MONTHLY') {
    // 편집한 날짜와 함께 읽어 둔 나머지 날짜도 넣는다 — 「1,15」를 열고 저장해도 15일이 남는다(WP-1117).
    const days = [...new Set([form.monthDay, ...form.otherMonthDays])].sort((a, b) => a - b);
    return `${base};BYMONTHDAY=${days.join(',')}`;
  }
  return base;
}

/**
 * 서버의 RRULE·시각 → 폼. 반복이 없거나(null) 읽을 수 없는 규칙이면 기본값(반복 안 함)에 시각만 옮긴다.
 * 매월 여러 날짜(1,15)는 첫 날짜를 편집 날짜로, 나머지를 otherMonthDays 로 읽는다.
 * 매주인데 BYDAY 가 없으면 월요일, 매월인데 날짜가 없거나 범위 밖이면 1일로 채운다(서버가 거절하는 모양이라 드묾).
 */
export function parseTaskRRule(rrule: string | null | undefined, time?: string | null): TaskRecurrenceForm {
  const form: TaskRecurrenceForm = {
    ...DEFAULT_TASK_RECURRENCE_FORM,
    byDay: [...DEFAULT_TASK_RECURRENCE_FORM.byDay],
    otherMonthDays: [],
    hourlyDays: [...DEFAULT_TASK_RECURRENCE_FORM.hourlyDays],
  };
  if (time && TIME_RE.test(time)) form.time = time;
  if (!rrule) return form;
  // 토큰화는 캘린더 반복 유틸과 같은 방식으로 한 번만 — 지원하지 않는 FREQ(또는 누락)는 반복 안 함.
  const tokens = tokenizeRRule(rrule);
  const { map } = tokens;
  const freq = map.get('FREQ');
  form.freq = freq === 'DAILY' || freq === 'WEEKLY' || freq === 'MONTHLY' || freq === 'ONCE' || freq === 'HOURLY' ? freq : 'NONE';
  if (freq === 'ONCE') {
    const date = map.get('DATE');
    form.onceDate = date && DATE_RE.test(date) ? date : null;
  }
  // 몇 시간마다(WP-1373) — 요일은 hourlyDays 로, 간격·끝 시각을 읽는다. 한 부분이라도 읽을 수 없으면 기본값(월~금 등)으로 채우지 않고
  // 모르는 FREQ 처럼 「안 함」으로 둔다 — 다른 일정으로 바꿔 보이거나 저장 때 그 기본값으로 고쳐 쓰지 않게.
  if (freq === 'HOURLY') {
    const hourly = readHourlyRule(tokens);
    if (!hourly) {
      form.freq = 'NONE';
      return form;
    }
    form.interval = hourly.interval;
    form.hourlyDays = hourly.days;
    // 00:00 + 23:59 는 시간대 꺼짐(하루 종일, WP-1413) — 시각 칸에는 기본 09:00~18:00 을 둔다. 00:00~23:59 를 두면 스위치를 켠 채
    // 그대로 저장해도 다시 「꺼짐」으로 읽혀, 켠 것이 보이지 않게 된다.
    if (isAllDayWindow(form.time, hourly.untilTime)) {
      form.hourlyWindow = false;
      form.time = DEFAULT_TASK_RECURRENCE_FORM.time;
      form.untilTime = DEFAULT_TASK_RECURRENCE_FORM.untilTime;
    } else {
      form.hourlyWindow = true;
      form.untilTime = hourly.untilTime;
    }
    return form;
  }
  // 매주의 요일 — 몇 시간마다는 위에서 따로 읽었으므로 여기서만 나눈다.
  const days = sortDays((map.get('BYDAY') ?? '').split(','));
  if (days.length > 0) form.byDay = days;
  // 매주 월~금이면 「평일」 칩으로 보인다.
  if (form.freq === 'WEEKLY' && isWeekdaysOnly(days)) form.freq = 'WEEKDAYS';
  // 편집기는 날짜 하나만 고치게 한다 — 여러 날짜(1,15)면 첫 날짜를 편집하고 나머지는 저장 때 그대로 넣는다.
  const [first, ...rest] = monthDays(map.get('BYMONTHDAY'));
  if (first !== undefined) {
    form.monthDay = first;
    form.otherMonthDays = rest;
  }
  return form;
}

/** 요일 목록이 정확히 월~금인가 — 「평일」로 보인다. */
function isWeekdaysOnly(days: readonly WeekdayCode[]): boolean {
  return days.length === WEEKDAYS_ONLY.length && WEEKDAYS_ONLY.every((d) => days.includes(d));
}

/** 저장 전 검사 — 문제가 있으면 화면에 보일 문구, 없으면 null. 반복 안 함은 늘 통과. */
export function validateTaskRecurrence(form: TaskRecurrenceForm): string | null {
  if (form.freq === 'NONE') return null;
  if (form.freq === 'WEEKLY' && form.byDay.length === 0) return '요일을 하나 이상 고르세요';
  if (form.freq === 'MONTHLY' && !(Number.isInteger(form.monthDay) && form.monthDay >= 1 && form.monthDay <= 31)) {
    return '날짜는 1일부터 31일 사이로 고르세요';
  }
  if (form.freq === 'HOURLY') {
    if (!isHourlyInterval(form.interval)) return '간격을 고르세요';
    if (form.hourlyDays.length === 0) return '요일을 하나 이상 고르세요';
    // 시간대를 정하지 않았으면(WP-1413) 시각 칸이 숨어 있다 — 숨은 칸 값이 저장을 막지 않게 시각은 보지 않는다.
    if (!form.hourlyWindow) return null;
  }
  if (!TIME_RE.test(form.time)) return '시각을 HH:mm 으로 입력하세요';
  if (form.freq === 'HOURLY') {
    if (!TIME_RE.test(form.untilTime)) return '끝 시각을 HH:mm 으로 입력하세요';
    // 자정을 넘는 시간대는 받지 않는다(서버도 400) — HH:mm 은 글자 비교가 곧 시각 비교다.
    if (form.untilTime <= form.time) return '끝 시각은 시작 시각보다 뒤로 고르세요 (자정을 넘길 수 없어요)';
  }
  return null;
}

/** 자정부터 분 → 'HH:mm'. */
function fromMinutes(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/**
 * 「몇 시간마다」 하루의 실행 시각 목록(WP-1373) — 시작 시각부터 간격마다, 끝 시각 이하인 것만(끝 시각 정각 포함). 서버의 다음 회차 계산과 같은 규칙.
 * 몇 시간마다가 아니거나 저장 전 검사({@link validateTaskRecurrence} — 시각·간격·요일, 끝 ≤ 시작 포함)에 걸리면 빈 목록.
 * 검사를 따로 되풀이하지 않고 같은 검사를 쓴다(검사는 이 함수를 부르지 않으므로 서로 돌지 않는다).
 */
export function hourlyRunTimes(form: TaskRecurrenceForm): string[] {
  if (form.freq !== 'HOURLY' || validateTaskRecurrence(form)) return [];
  const out: string[] = [];
  // 시간대를 정하지 않았으면(WP-1413) 00:00~23:59 — 저장하는 규칙과 같은 회차다.
  for (let m = toMinutes(taskRunTime(form)); m <= toMinutes(hourlyUntil(form)); m += form.interval * 60) out.push(fromMinutes(m));
  return out;
}

/** 미리보기에 시각을 다 적는 최대 개수 — 넘으면 앞 3개 · … · 마지막으로 줄인다(한 줄을 넘지 않게). */
const PREVIEW_MAX_TIMES = 6;

/**
 * 「몇 시간마다」 실행 시각 미리보기(WP-1373) — 「09:00 · 11:00 · 13:00 · 15:00 · 17:00 에 실행 (하루 5회)」.
 * 시각이 많으면 「09:00 · 10:00 · 11:00 · … · 18:00 에 실행 (하루 10회)」. 회차를 정할 수 없으면 null.
 * 시간대를 정하지 않았으면(WP-1413) 같은 목록 앞에 「하루 종일 — 」만 붙인다 — 「하루 종일 — 00:00 · 02:00 · 04:00 · … · 22:00 에 실행 (하루 12회)」.
 */
export function hourlyPreviewText(form: TaskRecurrenceForm): string | null {
  const times = hourlyRunTimes(form);
  if (times.length === 0) return null;
  const shown = times.length > PREVIEW_MAX_TIMES ? [...times.slice(0, 3), '…', times[times.length - 1]] : times;
  return `${isAllDayHourly(form) ? '하루 종일 — ' : ''}${shown.join(' · ')} 에 실행 (하루 ${times.length}회)`;
}

/** 요일 묶음 이름 — 모든 요일이면 「매일」, 월~금이면 「평일」, 그 밖에는 「월·수」. 몇 시간마다 요약(WP-1373)에 쓴다. */
function daysLabel(days: readonly WeekdayCode[]): string {
  if (days.length === WEEKDAY_CODES.length) return '매일';
  if (isWeekdaysOnly(days)) return '평일';
  return days.map((d) => WEEKDAY_SHORT[d]).join('·');
}

/** 시간대 문구 — 둘 다 정각이면 「09~18시」, 아니면 「09:30~18:00」. */
function windowLabel(start: string, until: string): string {
  if (start.endsWith(':00') && until.endsWith(':00')) return `${start.slice(0, 2)}~${until.slice(0, 2)}시`;
  return `${start}~${until}`;
}

/** 한국 시간 날짜(yyyy-MM-dd) → 「11/3(화)」. 형식이 틀리면 null. */
function shortDate(date: string): string | null {
  if (!DATE_RE.test(date)) return null;
  const [y, m, d] = date.split('-').map(Number);
  return `${m}/${d}(${kstWeekday({ y, m, d })})`;
}

/**
 * 반복 요약 문구 — 「매일 08:30」, 「평일 08:30」, 「매주 월·수 08:30」, 「매월 15일 08:30」, 「매월 1·15일 08:30」, 「한 번만 11/3(화) 08:30」.
 * 이 화면이 다루지 못하는 규칙(다른 FREQ·빠진 요일 등)은 원문 RRULE 을 그대로 보인다(뜻을 지어내지 않는다).
 */
export function recurrenceLabel(rrule: string, time: string): string {
  const tokens = tokenizeRRule(rrule);
  const { map } = tokens;
  const freq = map.get('FREQ');
  if (freq === 'ONCE') {
    // 날짜가 없으면(서버가 정하기 전) 시각만.
    const date = shortDate(map.get('DATE') ?? '');
    return date ? `한 번만 ${date} ${time}` : `한 번만 ${time}`;
  }
  if (freq === 'DAILY') return `매일 ${time}`;
  // 몇 시간마다(WP-1373) — 「평일 09~18시 · 2시간마다」, 시간대를 정하지 않았으면(00:00~23:59, WP-1413) 「평일 · 2시간마다」.
  // 요일·간격·끝 시각 중 하나라도 읽을 수 없으면 아래에서 원문을 보인다.
  if (freq === 'HOURLY') {
    const hourly = readHourlyRule(tokens);
    if (hourly && TIME_RE.test(time)) {
      const windowText = isAllDayWindow(time, hourly.untilTime) ? '' : ` ${windowLabel(time, hourly.untilTime)}`;
      return `${daysLabel(hourly.days)}${windowText} · ${hourly.interval}시간마다`;
    }
  }
  if (freq === 'WEEKLY') {
    const days = sortDays((map.get('BYDAY') ?? '').split(','));
    if (isWeekdaysOnly(days)) return `평일 ${time}`;
    if (days.length > 0) return `매주 ${days.map((d) => WEEKDAY_SHORT[d]).join('·')} ${time}`;
  }
  if (freq === 'MONTHLY') {
    // 여러 날짜면 「매월 1·15일」.
    const mds = monthDays(map.get('BYMONTHDAY'));
    if (mds.length > 0) return `매월 ${mds.join('·')}일 ${time}`;
  }
  return `${rrule} ${time}`;
}

/** 「한 번만」 규칙인가(WP-1315). */
export function isOnceRule(rrule: string | null | undefined): boolean {
  return !!rrule && tokenizeRRule(rrule).map.get('FREQ') === 'ONCE';
}

/**
 * 편집 중인 폼의 다음 실행 시각(WP-1315, 만들기 창의 「다음 실행 …」 미리보기) — 서버의 다음 회차 계산과 같은 규칙(한국 시간, now 뒤의 첫 회차).
 * 한 번만은 저장된 날짜가 아직 오지 않았으면 그날, 아니면 그 시각의 다음 때. 매월 29~31일은 그 날짜가 없는 달을 건너뛴다. 안 함·검사 실패면 null.
 */
export function previewNextRun(form: TaskRecurrenceForm, now: Date = new Date()): Date | null {
  if (form.freq === 'NONE' || validateTaskRecurrence(form)) return null;
  if (form.freq === 'ONCE') {
    const date = pendingOnceDate(form, now) ?? onceDateFor(form.time, now);
    return date ? new Date(kstInstant(date, form.time)) : null;
  }
  const days = form.freq === 'WEEKDAYS' ? WEEKDAYS_ONLY : form.freq === 'HOURLY' ? form.hourlyDays : form.byDay;
  // 몇 시간마다(WP-1373)는 하루에 여러 회차 — 그날의 실행 시각 목록을 차례로 본다. 다른 빈도는 하루 한 번(time).
  const dayTimes = form.freq === 'HOURLY' ? hourlyRunTimes(form) : [form.time];
  const monthDayList = [form.monthDay, ...form.otherMonthDays];
  const t = kstParts(now);
  // 오늘부터 하루씩 — 매월 31일도 두 달 안에 오므로 400일이면 넉넉하다.
  for (let i = 0; i < 400; i++) {
    const day = new Date(Date.UTC(t.y, t.m - 1, t.d + i));
    const date = ymd(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate());
    const code = WEEKDAY_CODES[(day.getUTCDay() + 6) % 7];
    const hit =
      form.freq === 'DAILY' ||
      ((form.freq === 'WEEKLY' || form.freq === 'WEEKDAYS' || form.freq === 'HOURLY') && days.includes(code)) ||
      (form.freq === 'MONTHLY' && monthDayList.includes(day.getUTCDate()));
    if (!hit) continue;
    // 그날 회차 중 now 뒤의 첫 것 — 찾으면 바로 끝낸다.
    for (const hhmm of dayTimes) {
      const at = kstInstant(date, hhmm);
      if (at > now.getTime()) return new Date(at);
    }
  }
  return null;
}

/** 다음 실행 문구 — 「다음 실행 10/29(목) 08:30」(한국 시간). 시각이 없거나 읽을 수 없으면 null. */
export function nextRunText(nextRunAt: string | null | undefined): string | null {
  if (!nextRunAt) return null;
  const d = parseUtcDate(nextRunAt);
  if (Number.isNaN(d.getTime())) return null;
  return `다음 실행 ${kstShortDateTime(d)}`;
}

/** 한국 시간 「11/3(화) 08:30」 — 다음 실행 문구와 한 번만 요약(WP-1315)이 같이 쓴다. */
export function kstShortDateTime(d: Date): string {
  const t = kstParts(d);
  const hh = String(t.h).padStart(2, '0');
  const mm = String(t.min).padStart(2, '0');
  return `${t.m}/${t.d}(${kstWeekday(t)}) ${hh}:${mm}`;
}

/**
 * 꺼진 반복의 상태 문구 — 켜져 있으면 null, 한 번만 예약(WP-1315)이 실행을 마쳤으면 결과로 가른다: 서버는 회차가 실패하거나 결과가 오지
 * 않으면(LOST_RUN) consecutiveFailures 를 1 로 두고 끄므로, 실패가 있으면 「실패함 — …」, 없으면 「실행함」(실패를 성공으로 읽지 않게).
 * 연속 실패로 멈췄으면(3회 이상) 「멈춤 — 3회 연속 실패」, 그 밖에는 「꺼짐」. 모바일 칩·작업 행 표식은 첫 낱말만 쓴다.
 */
export function recurrencePausedText(r: { enabled: boolean; consecutiveFailures?: number | null; rrule?: string | null }): string | null {
  if (r.enabled) return null;
  const n = r.consecutiveFailures ?? 0;
  if (isOnceRule(r.rrule)) return n > 0 ? '실패함 — 실행이 실패했거나 결과가 오지 않았습니다' : '실행함';
  return n >= 3 ? `멈춤 — ${n}회 연속 실패` : '꺼짐';
}

/**
 * 「AI 에게 맡기기」 요약(WP-1314) — 「내 AI 비서 · ↻ 평일 08:30」 모양. 한 번만(WP-1315)은 되풀이가 아니라 ↻ 를 붙이지 않는다
 * (「내 AI 비서 · 한 번만 11/3(화) 08:30」). 일정이 없으면 「안 함」.
 */
export function aiHandoffLabel(r: { rrule: string; time: string; agentName: string } | null | undefined): string {
  const parts = aiHandoffParts(r);
  if (!parts) return '안 함';
  return `${parts.agent} · ${parts.repeating ? '↻ ' : ''}${parts.schedule}`;
}

/** 「AI 에게 맡기기」 요약의 부분(WP-1413) — AI 이름, 일정 문구, 되풀이하는가(한 번만이 아니면 true — 반복 아이콘을 붙인다). */
export interface AiHandoffParts {
  agent: string;
  schedule: string;
  repeating: boolean;
}

/**
 * 「AI 에게 맡기기」 요약을 AI 이름·일정으로 나눈다(WP-1413) — 데스크톱 이슈 속성 칸이 두 줄(1줄 AI 이름, 2줄 반복 아이콘 + 일정)로 그린다.
 * 한 줄 문구(aiHandoffLabel)도 이 부분으로 만든다. 일정이 없으면 null.
 */
export function aiHandoffParts(r: { rrule: string; time: string; agentName: string } | null | undefined): AiHandoffParts | null {
  if (!r) return null;
  return { agent: r.agentName, schedule: recurrenceLabel(r.rrule, r.time), repeating: !isOnceRule(r.rrule) };
}

/** 담당 AI 후보 이름(WP-1314) — 내 개인 비서는 「(내 AI 비서)」를 붙인다. 이름이 비면 username. */
export function agentOptionLabel(o: { name: string | null; username: string; personalAssistant: boolean }): string {
  const name = o.name?.trim() || o.username;
  return o.personalAssistant ? `${name} (내 AI 비서)` : name;
}

/** 「지금 실행」 버튼 상태(WP-1313) — 누를 수 없으면 그 이유(툴팁). */
export interface RunNowState {
  /** 반복이 없으면 버튼을 그리지 않는다. */
  visible: boolean;
  disabled: boolean;
  /** 막힌 이유 — 툴팁·보조 문구로 보인다. 누를 수 있으면 null. */
  reason: string | null;
  /** 결과를 기다리는 중 — 버튼 글자를 「실행 중…」으로. */
  running: boolean;
}

/**
 * 「지금 실행」 버튼을 누를 수 있는지(WP-1313). 서버 규칙과 같다 — 남의 개인 비서 일정은 주인만(editable=false), 이슈를 고칠 수 없는 사람은 못 누르고,
 * 결과를 기다리는 테스트 실행이 있으면 하나씩만. 정기 회차가 도는 중인 것은 화면이 모르므로 서버 409 문구로 알린다.
 *
 * @param locked 이슈를 고칠 수 없는 사람(팀 이슈 읽기 전용)
 * @param pending 지금 요청을 보내는 중
 */
export function runNowState(
  r: Pick<IssueRecurrence, 'editable' | 'testRunning'> | null | undefined,
  locked: boolean,
  pending: boolean,
): RunNowState {
  if (!r) return { visible: false, disabled: true, reason: null, running: false };
  const running = r.testRunning === true || pending;
  if (r.editable === false) {
    return { visible: true, disabled: true, reason: '다른 사람의 개인 비서 일정이라 그 주인만 실행할 수 있어요', running };
  }
  if (locked) return { visible: true, disabled: true, reason: '이 이슈를 고칠 수 있는 사람만 실행할 수 있어요', running };
  if (running) return { visible: true, disabled: true, reason: '실행 중이에요 — 결과가 채팅에 남은 뒤 다시 실행할 수 있어요', running };
  return { visible: true, disabled: false, reason: null, running: false };
}

/**
 * 만들기 창 「AI 에게 맡기기」 줄의 요약(WP-1315) — 「내 AI 비서 · ↻ 평일 08:30」, 한 번만은 ↻ 없이 미리보기 날짜로 「내 AI 비서 · 한 번만 11/3(화) 08:30」
 * (날짜는 서버가 저장 때 정하므로 같은 규칙의 미리보기를 쓴다). 담당 AI 가 없으면 「안 함」. 내 개인 비서는 이름 대신 「내 AI 비서」.
 */
export function createHandoffSummary(
  agent: { name: string | null; username: string; personalAssistant: boolean } | null,
  form: TaskRecurrenceForm,
  now: Date = new Date(),
): string {
  if (!agent) return '안 함';
  let rrule = buildTaskRRule(form, now);
  if (!rrule) return '안 함';
  if (form.freq === 'ONCE') {
    // 날짜는 서버가 저장 때 정하므로 같은 규칙(미리보기)의 날짜를 채워, 이슈 화면의 요약(aiHandoffLabel)과 같은 모양으로 그린다.
    const date = pendingOnceDate(form, now) ?? onceDateFor(form.time, now);
    if (date) rrule = `FREQ=ONCE;DATE=${date}`;
  }
  const agentName = agent.personalAssistant ? '내 AI 비서' : agent.name?.trim() || agent.username;
  // 시간대를 정하지 않은 몇 시간마다는 00:00 으로 보내므로(WP-1413) 요약도 같은 시각으로 — 「평일 · 2시간마다」.
  return aiHandoffLabel({ rrule, time: taskRunTime(form), agentName });
}
