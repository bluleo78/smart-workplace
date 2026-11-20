// 메일 예약 보내기(WP-1787) — 프리셋(내일·월요일 오전 9시)과 예약 시각 라벨. 순수 함수라 now 를 받는다(시계에 의존하지 않게).
// 「오전 9:00」·「11월 20일 (금)」 표기는 공용 formatters 의 로컬 시각·요일 도우미를 쓴다(Intl 의 ko-KR 오전/오후는 ICU 에 따라 AM/PM 이 된다).
import { formatLocalDateWithWeekday, localClockParts, WEEKDAY_KO } from './formatters';

/** 예약 프리셋 한 개 — label 은 메뉴 본문, dateLabel 은 보조 날짜, at 은 보낼 시각. */
export interface SchedulePreset {
  key: 'tomorrow' | 'monday';
  label: string;
  dateLabel: string;
  at: Date;
}

/** 「오전 9:00」·「오후 12:00」 — 12시간제, 분 두 자리. */
function timeLabel(d: Date): string {
  const { meridiem, clock } = localClockParts(d);
  return `${meridiem} ${clock}`;
}

/** 「11월 20일 (금)」 — 프리셋 보조 날짜(연도 없이). */
function monthDayLabel(d: Date): string {
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAY_KO[d.getDay()]})`;
}

/** 해당 날짜의 자정(날짜 비교·더하기용). 일 단위 이동은 setDate 로 해 DST 에도 날짜가 어긋나지 않는다. */
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  const r = startOfDay(d);
  r.setDate(r.getDate() + n);
  return r;
}

/**
 * 예약 프리셋 — [내일 오전 9:00, 다음 월요일 오전 9:00]. 내일이 월요일이면 월요일 프리셋은 +7일(다음 주)이라 겹치지 않고, 문구에 「다음 주」를 붙인다.
 */
export function schedulePresets(now: Date): SchedulePreset[] {
  const tomorrow = addDays(now, 1);
  tomorrow.setHours(9, 0, 0, 0);
  // 내일부터 센 다음 월요일 — 내일이 월요일이면 7일 뒤.
  const untilMonday = (8 - tomorrow.getDay()) % 7 || 7;
  const nextWeek = tomorrow.getDay() === 1;
  // 내일이 월요일이면 내일 다음의 월요일(+7), 아니면 내일 이후 첫 월요일.
  const monday = addDays(tomorrow, untilMonday);
  monday.setHours(9, 0, 0, 0);
  return [
    { key: 'tomorrow', label: `내일 ${timeLabel(tomorrow)}`, dateLabel: monthDayLabel(tomorrow), at: tomorrow },
    {
      key: 'monday',
      label: `${nextWeek ? '다음 주 ' : ''}월요일 ${timeLabel(monday)}`,
      dateLabel: monthDayLabel(monday),
      at: monday,
    },
  ];
}

/** 예약 시각 라벨 — 오늘·내일은 말로, 같은 해는 월일(요일), 다른 해는 연도까지. */
export function formatScheduleLabel(at: Date, now: Date): string {
  const days = Math.round((startOfDay(at).getTime() - startOfDay(now).getTime()) / 86_400_000);
  if (days === 0) return `오늘 ${timeLabel(at)}`;
  if (days === 1) return `내일 ${timeLabel(at)}`;
  return `${formatLocalDateWithWeekday(at, now)} ${timeLabel(at)}`;
}

/**
 * 고를 수 있는 가장 이른 예약 시각 — 초를 버린 분 + 2분. 서버는 지금 + 1분 뒤 이후만 받는데(DB 시계 기준),
 * 분 단위로 올림한 +1분은 몇 초만 앞설 수 있어 거절당한다. +2분이면 늘 61초 이상 앞선다.
 */
export function minScheduleDate(now: Date): Date {
  const d = new Date(now);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 2);
  return d;
}

/** 서버가 받는 가장 먼 예약 — 지금(DB 시계)부터 365일(WP-1787 코드 리뷰). */
const MAX_SCHEDULE_AHEAD_MS = 365 * 86_400_000;

/**
 * 고를 수 있는 가장 늦은 예약 시각 — 초를 버린 분 + 365일. 서버는 지금 + 365일보다 먼 시각을 거절한다.
 * 분을 내려 잡아 늘 서버 한도 안쪽이 되게 하고, 일 단위가 아니라 밀리초로 더해 일광 절약 시간 전환에도 365일 그대로다.
 */
export function maxScheduleDate(now: Date): Date {
  const d = new Date(now);
  d.setSeconds(0, 0);
  return new Date(d.getTime() + MAX_SCHEDULE_AHEAD_MS);
}

/** 가장 이른 예약이 이만큼 안으로 다가오면(또는 지났으면) 짧게 다시 받는다 — 나가서 사라지는 것을 곧 보이게. */
const SCHEDULED_NEAR_WINDOW_MS = 2 * 60_000;
/** 다가온 동안 다시 받는 간격. */
const SCHEDULED_NEAR_POLL_MS = 30_000;
/** 멀리 있을 때 한 번 깨는 최대 간격 — 브라우저 타이머 상한(약 24.8일)을 넘지 않고, 그 사이 다른 곳에서 바뀐 예약도 가끔 맞춘다. */
const SCHEDULED_FAR_MAX_MS = 30 * 60_000;

/**
 * 예약 목록·개수를 다시 받을 간격(WP-1787 코드 리뷰) — react-query refetchInterval 값. 예약이 하나라도 있다고 늘 30초마다 받지 않는다.
 * - 예약이 없으면 받지 않는다(false).
 * - 가장 이른 예약 시각이 2분 안이거나 지났으면 30초마다(나가서 사라질 때까지).
 * - 그보다 멀면 2분 전이 되는 때(최대 30분 뒤)에 한 번 깨어 다시 받는다 — 받은 뒤 이 함수가 다시 간격을 정한다.
 */
export function scheduledRefetchInterval(nextSendAt: string | null | undefined, now: number): number | false {
  if (!nextSendAt) return false;
  const at = new Date(nextSendAt).getTime();
  if (Number.isNaN(at)) return false;
  const untilNear = at - now - SCHEDULED_NEAR_WINDOW_MS;
  if (untilNear <= 0) return SCHEDULED_NEAR_POLL_MS;
  return Math.min(untilNear, SCHEDULED_FAR_MAX_MS);
}
