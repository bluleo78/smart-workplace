// WP-873 「완료일」 기간 필터 — 프리셋 토큰·직접 지정 토큰의 해석과 표시.
// URL 키 closedIn 의 값은 토큰 하나: 프리셋('last-week' 등) 또는 'YYYY-MM-DD~YYYY-MM-DD'(직접 지정).
// 프리셋은 저장하지 않고 조회 시점에 풀어 서버(closedFrom/closedTo — KST 날짜 양끝 포함)로 보낸다 →
// 저장 뷰·링크에 「지난 주」를 담아도 열 때마다 그 시점의 지난 주가 된다.

import { kstDateKey, parseValidDateKey } from './formatters';

export type ClosedPreset = 'today' | 'this-week' | 'last-week' | 'this-month' | 'last-month' | 'last-30d';

/** 프리셋 목록 — 화면 노출 순서·문구가 고정이다(facet 메뉴·모바일 시트 공용). */
export const CLOSED_PRESETS: { value: ClosedPreset; label: string }[] = [
  { value: 'today', label: '오늘' },
  { value: 'this-week', label: '이번 주' },
  { value: 'last-week', label: '지난 주' },
  { value: 'this-month', label: '이번 달' },
  { value: 'last-month', label: '지난 달' },
  { value: 'last-30d', label: '최근 30일' },
];

const PRESET_VALUES: readonly string[] = CLOSED_PRESETS.map((p) => p.value);

/** 직접 지정 토큰 'YYYY-MM-DD~YYYY-MM-DD' 를 (형식 검사 후) 나눈다. 없는 날짜·from>to 면 null. 문자열 비교는 같은 형식이라 날짜 순서와 같다. */
function parseCustom(token: string): { from: string; to: string } | null {
  const m = /^(\d{4}-\d{2}-\d{2})~(\d{4}-\d{2}-\d{2})$/.exec(token);
  if (!m) return null;
  const [, from, to] = m;
  if (!parseValidDateKey(from) || !parseValidDateKey(to)) return null;
  return from <= to ? { from, to } : null;
}

/**
 * URL 의 closedIn 원값 → 유효한 토큰 또는 null. 모르는 토큰·없는 날짜·from>to 는 버려 「필터 없음」과 같게 한다
 * (서버가 400 으로 거절해 불러오기 실패로 보이는 것을 막는다 — 다른 날짜 토큰(isoDate)과 같은 방침).
 */
export function parseClosedIn(raw: string | null): string | null {
  if (!raw) return null;
  if (PRESET_VALUES.includes(raw)) return raw;
  return parseCustom(raw) ? raw : null;
}

// 날짜 키 산술 — 시간대 영향이 없게 UTC 자정으로 계산한다(로컬 Date 의 DST·시각 변환 회피).
function toUtc(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
const DAY = 24 * 60 * 60 * 1000;
function addDays(key: string, n: number): string {
  return fromUtc(toUtc(key) + n * DAY);
}

/**
 * 토큰 → KST 날짜 범위(양끝 포함). now 의 KST 날짜가 「오늘」이다. 알 수 없는 토큰은 null.
 * - 이번 주: 이번 주 월요일 ~ 오늘 / 지난 주: 지난 주 월 ~ 일(주 시작은 월요일)
 * - 이번 달: 1일 ~ 오늘 / 지난 달: 전월 1일 ~ 말일(1월이면 전년 12월)
 * - 최근 30일: 오늘 포함 30일(오늘 - 29일 ~ 오늘)
 */
export function resolveClosedRange(token: string, now: Date = new Date()): { from: string; to: string } | null {
  const today = kstDateKey(now);
  // 월요일 기준 요일 인덱스(월 0 … 일 6) — getUTCDay 는 일 0 … 토 6.
  const sinceMonday = (new Date(toUtc(today)).getUTCDay() + 6) % 7;
  switch (token) {
    case 'today':
      return { from: today, to: today };
    case 'this-week':
      return { from: addDays(today, -sinceMonday), to: today };
    case 'last-week': {
      const thisMonday = addDays(today, -sinceMonday);
      return { from: addDays(thisMonday, -7), to: addDays(thisMonday, -1) };
    }
    case 'this-month':
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case 'last-month': {
      const firstOfThisMonth = `${today.slice(0, 7)}-01`;
      const lastDay = addDays(firstOfThisMonth, -1); // 전월 말일
      return { from: `${lastDay.slice(0, 7)}-01`, to: lastDay };
    }
    case 'last-30d':
      return { from: addDays(today, -29), to: today };
    default:
      return parseCustom(token);
  }
}

/**
 * 날짜 구간 표기 — 「10/12–10/18」(en dash). 연도는 올해(now 의 KST 연도)가 아닌 쪽에만 붙인다: 「2025/12/29–1/4」.
 * 양쪽 다 올해가 아니면 양쪽에 붙는다. 하루짜리(from === to)는 날짜를 한 번만 보인다: 「10/5」.
 * 칩·시트 라벨과 「기간 직접 지정」 달력 패널의 요약이 같은 함수를 써서 표기가 어긋나지 않는다.
 */
export function formatClosedSpan(from: string, to: string, now: Date = new Date()): string {
  const thisYear = kstDateKey(now).slice(0, 4);
  const fmt = (key: string) => {
    const [y, m, d] = key.split('-');
    return `${y === thisYear ? '' : `${y}/`}${Number(m)}/${Number(d)}`;
  };
  return from === to ? fmt(from) : `${fmt(from)}–${fmt(to)}`;
}

/**
 * 칩·시트에 보일 라벨 — 프리셋은 「지난 주 (10/12–10/18)」, 직접 지정은 「10/12–10/18」(구간 표기는 {@link formatClosedSpan}).
 * 알 수 없는 토큰은 빈 문자열.
 */
export function closedRangeLabel(token: string, now: Date = new Date()): string {
  const range = resolveClosedRange(token, now);
  if (!range) return '';
  const span = formatClosedSpan(range.from, range.to, now);
  const preset = CLOSED_PRESETS.find((p) => p.value === token);
  return preset ? `${preset.label} (${span})` : span;
}
