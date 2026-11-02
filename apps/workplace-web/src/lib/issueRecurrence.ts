// 개인 작업 반복(WP-989) — 편집 폼 모델 ↔ RRULE, 요약·다음 실행·멈춤 문구를 만드는 순수 함수.
// 빈도 타입(RecurrenceFreq)과 RRULE 토큰화(tokenizeRRule)는 캘린더 반복 유틸(lib/recurrence)을 그대로 쓰고,
// 이 기능만 쓰는 BYDAY(매주 요일)·BYMONTHDAY(매월 날짜)를 덧붙여 읽고 쓴다. 가장 짧은 주기는 하루 1회(INTERVAL 없음).
// WP-1315: 「한 번만」(FREQ=ONCE;DATE=yyyy-MM-dd — 정한 날짜·시각에 한 번 실행하고 일정이 꺼진다)과 「평일」(매주 월~금의 줄임) 칩을 더했다.
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
 */
export type TaskRecurrenceFreq = RecurrenceFreq | 'ONCE' | 'WEEKDAYS';

/** 이슈 상세 편집기의 일정 칩 — 「안 함」으로 저장하면 일정을 끈다. */
export const EDITOR_FREQS: TaskRecurrenceFreq[] = ['NONE', 'ONCE', 'DAILY', 'WEEKDAYS', 'WEEKLY', 'MONTHLY'];

/** 만들기 창의 일정 칩(WP-1315) — 끄기는 「맡기지 않기」가 따로 한다. */
export const CREATE_FREQS: TaskRecurrenceFreq[] = ['ONCE', 'DAILY', 'WEEKDAYS', 'WEEKLY', 'MONTHLY'];

/**
 * 반복 편집 폼 — freq 'NONE' 은 「반복 안 함」. byDay 는 매주, monthDay·otherMonthDays 는 매월에서만 쓴다. time 은 한국 시간 'HH:mm'.
 * 편집기는 날짜 하나(monthDay)만 고치게 한다. API·AI 로 저장된 여러 날짜(1,15)의 나머지는 otherMonthDays 에 그대로 두어
 * 열고 저장해도 빠지지 않게 한다(WP-1117). onceDate 는 저장된 「한 번만」 예약의 날짜(yyyy-MM-dd) — 다른 칸만 고쳐 저장해도 날짜가 바뀌지 않게
 * 들고 있는다(WP-1315). 새 「한 번만」은 null 이고 그 시각의 다음 때(오늘, 지났으면 내일)로 정해진다.
 */
export interface TaskRecurrenceForm {
  freq: TaskRecurrenceFreq;
  byDay: WeekdayCode[];
  monthDay: number;
  otherMonthDays: number[];
  time: string;
  onceDate?: string | null;
}

/** 새 반복 기본값 — 반복 안 함, 고르면 매주 월요일·매월 1일·09:00 부터 시작한다. */
export const DEFAULT_TASK_RECURRENCE_FORM: TaskRecurrenceForm = { freq: 'NONE', byDay: ['MO'], monthDay: 1, otherMonthDays: [], time: '09:00', onceDate: null };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 한국 시간 날짜(yyyy-MM-dd)·시각(HH:mm)의 순간(ms). 형식이 틀리면 NaN. */
function kstInstant(date: string, time: string): number {
  if (!DATE_RE.test(date) || !TIME_RE.test(time)) return NaN;
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return Date.UTC(y, m - 1, d, hh - 9, mm);
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

/**
 * 폼 → PUT 본문용 RRULE. 반복 안 함이면 null.
 * 예: 매일 → FREQ=DAILY, 매주 월·수 → FREQ=WEEKLY;BYDAY=MO,WE, 매월 15일 → FREQ=MONTHLY;BYMONTHDAY=15
 */
/** 「한 번만」 폼에 저장된 날짜가 아직 오지 않았으면 그 날짜, 없거나 지났으면 null(그때는 그 시각의 다음 때로 정한다, WP-1315). */
function pendingOnceDate(form: TaskRecurrenceForm, now: Date): string | null {
  return form.onceDate && kstInstant(form.onceDate, form.time) > now.getTime() ? form.onceDate : null;
}

export function buildTaskRRule(form: TaskRecurrenceForm, now: Date = new Date()): string | null {
  // 가장 짧은 주기는 하루 1회 — INTERVAL·종료 조건은 두지 않는다.
  if (form.freq === 'NONE') return null;
  // 한 번만 — 저장된 날짜가 아직 오지 않았으면 그대로 두고, 없거나 지났으면 날짜를 빼 서버가 그 시각의 다음 때로 정하게 한다.
  if (form.freq === 'ONCE') {
    const keep = pendingOnceDate(form, now);
    return keep ? `FREQ=ONCE;DATE=${keep}` : 'FREQ=ONCE';
  }
  if (form.freq === 'WEEKDAYS') return `FREQ=WEEKLY;BYDAY=${WEEKDAYS_ONLY.join(',')}`;
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
  const form: TaskRecurrenceForm = { ...DEFAULT_TASK_RECURRENCE_FORM, byDay: [...DEFAULT_TASK_RECURRENCE_FORM.byDay], otherMonthDays: [] };
  if (time && TIME_RE.test(time)) form.time = time;
  if (!rrule) return form;
  // 토큰화는 캘린더 반복 유틸과 같은 방식으로 한 번만 — 지원하지 않는 FREQ(또는 누락)는 반복 안 함.
  const { map } = tokenizeRRule(rrule);
  const freq = map.get('FREQ');
  form.freq = freq === 'DAILY' || freq === 'WEEKLY' || freq === 'MONTHLY' || freq === 'ONCE' ? freq : 'NONE';
  if (freq === 'ONCE') {
    const date = map.get('DATE');
    form.onceDate = date && DATE_RE.test(date) ? date : null;
  }
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
  if (!TIME_RE.test(form.time)) return '시각을 HH:mm 으로 입력하세요';
  return null;
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
  const { map } = tokenizeRRule(rrule);
  const freq = map.get('FREQ');
  if (freq === 'ONCE') {
    // 날짜가 없으면(서버가 정하기 전) 시각만.
    const date = shortDate(map.get('DATE') ?? '');
    return date ? `한 번만 ${date} ${time}` : `한 번만 ${time}`;
  }
  if (freq === 'DAILY') return `매일 ${time}`;
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
  const days = form.freq === 'WEEKDAYS' ? WEEKDAYS_ONLY : form.byDay;
  const monthDayList = [form.monthDay, ...form.otherMonthDays];
  const t = kstParts(now);
  // 오늘부터 하루씩 — 매월 31일도 두 달 안에 오므로 400일이면 넉넉하다.
  for (let i = 0; i < 400; i++) {
    const day = new Date(Date.UTC(t.y, t.m - 1, t.d + i));
    const date = ymd(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate());
    const at = kstInstant(date, form.time);
    if (at <= now.getTime()) continue;
    const code = WEEKDAY_CODES[(day.getUTCDay() + 6) % 7];
    const hit =
      form.freq === 'DAILY' ||
      ((form.freq === 'WEEKLY' || form.freq === 'WEEKDAYS') && days.includes(code)) ||
      (form.freq === 'MONTHLY' && monthDayList.includes(day.getUTCDate()));
    if (hit) return new Date(at);
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
 * 꺼진 반복의 상태 문구 — 켜져 있으면 null, 한 번만 예약이 실행을 마쳤으면(WP-1315) 「실행함」, 연속 실패로 멈췄으면(3회 이상) 「멈춤 — 3회 연속 실패」,
 * 그 밖에는 「꺼짐」. 모바일 칩은 첫 낱말만 쓴다.
 */
export function recurrencePausedText(r: { enabled: boolean; consecutiveFailures?: number | null; rrule?: string | null }): string | null {
  if (r.enabled) return null;
  if (isOnceRule(r.rrule)) return '실행함';
  const n = r.consecutiveFailures ?? 0;
  return n >= 3 ? `멈춤 — ${n}회 연속 실패` : '꺼짐';
}

/**
 * 「AI 에게 맡기기」 요약(WP-1314) — 「내 AI 비서 · ↻ 평일 08:30」 모양. 한 번만(WP-1315)은 되풀이가 아니라 ↻ 를 붙이지 않는다
 * (「내 AI 비서 · 한 번만 11/3(화) 08:30」). 일정이 없으면 「안 함」.
 */
export function aiHandoffLabel(r: { rrule: string; time: string; agentName: string } | null | undefined): string {
  if (!r) return '안 함';
  return `${r.agentName} · ${isOnceRule(r.rrule) ? '' : '↻ '}${recurrenceLabel(r.rrule, r.time)}`;
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
  return aiHandoffLabel({ rrule, time: form.time, agentName });
}
