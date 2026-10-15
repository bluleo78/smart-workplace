// WP-55 AI 메모리 공용 규칙 — 서버 오류 코드(ErrorResponse.errors.code) 해석과 사용자 문구.
// handleApiError 는 errors 의 첫 값(코드 문자열)을 토스트로 띄우므로 메모리 오류는 이 코드로 문구를 고른다.
import { addDays, addMonths } from 'date-fns';

import { apiErrorResponse, extractApiError, extractApiErrorCode } from '@/lib/api-error';
import { formatDateKey, parseDateKey } from '@/lib/formatters';
import { HIT_AREA_Y_COARSE } from '@/lib/hitArea';
import { cn } from '@/lib/utils';
import type { AiMemoryItem, AiMemoryScope } from '@/types/aiMemory';

/** 되돌릴 대상이 이미 없을 때(GONE·NOT_FOUND). */
export const UNDO_GONE_MESSAGE = '이미 지워진 메모리예요';
/** 고침 되돌리기 — 그 고침 뒤에 메모리가 또 바뀌어 서버가 덮지 않고 거절했을 때(AI_MEMORY_CHANGED). */
export const UNDO_CHANGED_MESSAGE = '그 뒤에 바뀐 메모리라 되돌리지 않았어요';
/** 설정 지움 되돌리기 — 지운 뒤 자정(KST)이 지나 기한이 이미 지났을 때(지난 기한으로는 다시 만들 수 없다 — 서버 400). */
export const UNDO_EXPIRED_MESSAGE = '기한이 지나 되돌릴 수 없어요';
/** 지움 되돌리기가 범위 상한(300)에 걸렸을 때 — 토스트 action "설정 열기". */
export const UNDO_FULL_MESSAGE = '메모리가 가득 찼어요. 설정에서 정리해 주세요';
/** 가득 참 토스트의 이동 경로. */
export const MEMORY_SETTINGS_PATH = '/settings/assistant';

/** 범위마다 상한(서버 AiMemoryService.LIMIT 과 같다 — WP-383 에서 50 → 300). 구 API 응답의 limit 이 우선이다. */
export const MEMORY_LIMIT = 300;
/** 내용 상한(코드포인트, 서버 MAX_CHARS 와 같다). */
export const MEMORY_MAX_CHARS = 300;
/** 이 개수부터 목록 카운트를 주황으로(곧 가득 참). */
export const MEMORY_WARN_AT = 270;
/** 범위마다 고정 상한(서버 AiMemoryService.PIN_LIMIT, WP-383) — 응답에 pinLimit 이 없을 때(구 API) 쓴다. */
export const PIN_LIMIT = 10;
/** 전체가 이 개수를 넘으면 카드 위에 검색칸을 둔다(WP-383). */
export const SEARCH_OVER = 20;
/** 인피니트 스크롤 한 번에 그리는 행 수(WP-383) — 처음 30행, sentinel 이 보일 때마다 30행씩 더. */
export const ROWS_PAGE = 30;

/** 앞뒤 공백을 지운 코드포인트 수 — 서버 normalizeContent 와 같은 기준(이모지 1개 = 1자). */
export function memoryLength(s: string): number {
  return [...s.trim()].length;
}

/** 저장 가능한 내용인가(1~300자). 넘으면 자르지 않고 버튼만 막는다. */
export function canSubmitContent(s: string): boolean {
  const n = memoryLength(s);
  return n >= 1 && n <= MEMORY_MAX_CHARS;
}

/** 내용 카운트(n / 300) 색 — 초과면 빨강. */
export function contentCountTone(len: number): string {
  return len > MEMORY_MAX_CHARS ? 'text-destructive' : 'text-muted-foreground';
}

/** 목록 카운트(n / 300) 색 — 270개부터 주황. */
export function listCountTone(count: number): string {
  return count >= MEMORY_WARN_AT ? 'text-warning-text' : 'text-muted-foreground';
}

/** 저장 실패 문구 — 메모리 오류 코드가 있으면 서버 문구(errors 의 코드 문자열 대신), 아니면 공용 추출 규칙. */
export function memoryErrorMessage(error: unknown, fallback: string): string {
  const message = apiErrorResponse(error)?.message;
  if (message && extractApiErrorCode(error)) return message;
  return extractApiError(error, fallback);
}

/** 묶음·선택·한도 키 — 공통은 'COMMON'(서버 errors.scope 와 같은 표기). */
export type AiMemoryScopeKey = AiMemoryScope | 'COMMON';
/**
 * WP-379 범위 이름(ai-agent MEMORY_SCOPE_LABEL·서버 AiMemoryScope 와 같다) — 범위 목록·순서의 단일 원본. 선언 순서가 설정 묶음·선택 순서다
 * (공통 먼저, 그 아래 이슈 → 노트 → 메일 → 드라이브 → 메신저 → 캘린더).
 */
export const SCOPE_LABEL: Record<AiMemoryScopeKey, string> = {
  COMMON: '공통',
  ISSUE: '이슈',
  WIKI: '노트',
  MAIL: '메일',
  DRIVE: '드라이브',
  MESSAGING: '메신저',
  CALENDAR: '캘린더',
};
/** 설정 묶음 순서 — 공통을 맨 위에 두고 그 아래 앱 범위를 앱 목록 순서대로 둔다(SCOPE_LABEL 선언 순서). */
export const SCOPE_ORDER = Object.keys(SCOPE_LABEL) as readonly AiMemoryScopeKey[];
/** 앱 범위 — 묶음 순서에서 공통만 뺀다. */
const MEMORY_SCOPES: readonly AiMemoryScope[] = SCOPE_ORDER.filter((k): k is AiMemoryScope => k !== 'COMMON');

/** 항목의 범위 키 — null·없음(구 API)은 공통. */
export function scopeKeyOf(scope: AiMemoryScope | null | undefined): AiMemoryScopeKey {
  return scope ?? 'COMMON';
}

/** 결과 줄 명사 — 앱 범위면 "이슈 메모리", 공통이면 "메모리"(WP-55 문구 그대로). */
export function memoryNoun(scope: AiMemoryScope | null | undefined): string {
  return scope ? `${SCOPE_LABEL[scope]} 메모리` : '메모리';
}

/**
 * 채팅 메모리 결과 줄의 동작 문구(WP-55·WP-379) — 앱 범위면 "이슈 메모리에 저장함", 공통이면 "메모리에 저장함".
 * MemoryResultLine 이 쓰고, 화면 없이 문구 규칙을 단위 테스트로 고정하려고 여기 둔다(WP-412).
 */
export function memoryActionText(
  action: 'saved' | 'updated' | 'forgotten',
  scope: AiMemoryScope | null | undefined,
): string {
  const noun = memoryNoun(scope);
  if (action === 'saved') return `${noun}에 저장함`;
  if (action === 'updated') return `${noun}를 고침`;
  return `${noun}에서 지움`;
}

/** 앱 범위 키인가(서버가 준 문자열 검사용). */
function isAppScope(v: string | null | undefined): v is AiMemoryScope {
  return !!v && (MEMORY_SCOPES as readonly string[]).includes(v);
}

/** 되돌리기 가득 참 토스트 문구 — 서버 409 errors.scope 기준: 앱이면 그 범위 이름, 공통·모름이면 기존 문구. */
export function memoryFullMessage(scopeKey: string | null | undefined): string {
  return isAppScope(scopeKey) ? `${SCOPE_LABEL[scopeKey]} 메모리가 가득 찼어요. 설정에서 정리해 주세요` : UNDO_FULL_MESSAGE;
}

/** 409 AI_MEMORY_FULL 의 errors.scope(가득 찬 범위 — 공통은 'COMMON'). 없으면 null. */
export function extractApiErrorScope(error: unknown): string | null {
  const scope = apiErrorResponse(error)?.errors?.scope;
  return typeof scope === 'string' ? scope : null;
}

/**
 * 설정 지움 되돌리기를 누른 순간 그 메모리의 기한이 이미 지났는가 — todayKey 는 누른 시각의 KST 날짜(yyyy-MM-dd). 삭제 때는 유효였어도 그 사이
 * 자정이 지나면 지난 기한이 되어, 다시 만들면 400 으로 거절되고 메모리는 사라진다. yyyy-MM-dd 는 문자열 비교가 날짜 순서와 같다.
 */
export function wasExpiredAtUndo(expiresOn: string | null | undefined, todayKey: string): boolean {
  return expiresOn != null && expiresOn < todayKey;
}

/** 설정 카드의 범위 묶음 하나 — active 는 유효 행(최신순, 한도 계산 대상), expired 는 만료 행(WP-380, 묶음 끝에 흐리게). */
export interface MemoryGroup {
  key: AiMemoryScopeKey;
  label: string;
  active: AiMemoryItem[];
  expired: AiMemoryItem[];
}

/**
 * 목록(서버 최신순) → 범위 묶음. 만료 행(서버 expired)은 묶음 끝으로 — 유효 행만 한도에 든다. 유효·만료 모두 없는 범위는 뺀다.
 * 한 번 훑어 범위별로 나눈 뒤 묶음 순서대로 꺼낸다 — 모르는 범위 값(신 서버)은 순서에 없어 빠진다. 묶음 안 유효 행은 고정 먼저(WP-383).
 */
export function groupMemories(items: readonly AiMemoryItem[]): MemoryGroup[] {
  const byScope = new Map<AiMemoryScopeKey, MemoryGroup>();
  for (const m of items) {
    const key = scopeKeyOf(m.scope);
    let g = byScope.get(key);
    if (!g) byScope.set(key, (g = { key, label: SCOPE_LABEL[key], active: [], expired: [] }));
    (m.expired ? g.expired : g.active).push(m);
  }
  return SCOPE_ORDER.flatMap((key) => {
    const g = byScope.get(key);
    return g ? [{ ...g, active: pinnedFirst(g.active) }] : [];
  });
}

/** 고정 먼저(각자 받은 최신순 유지) — 고정 행은 묶음 맨 위(WP-383). */
function pinnedFirst(rows: AiMemoryItem[]): AiMemoryItem[] {
  return [...rows.filter((m) => m.pinned), ...rows.filter((m) => !m.pinned)];
}

/** 그 묶음의 고정 수 — 서버처럼 만료 행도 센다(만료 행 되살리기가 고정 상한을 넘기지 않게). */
export function pinnedCount(group: MemoryGroup): number {
  return [...group.active, ...group.expired].filter((m) => m.pinned).length;
}

/** 검색칸 필터 — 앞뒤 공백을 지운 질의가 내용에(대소문자 무시) 들어 있는가. 빈 질의는 모두 맞는다(클라이언트 필터, 스펙 3.7). */
export function matchesMemoryQuery(m: AiMemoryItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === '' || m.content.toLowerCase().includes(q);
}

/** 고정 막힘 안내 — 데스크톱 툴팁·터치 토스트 공용(범위는 묶음 소제목이 이미 말한다). */
export function pinFullHint(pinLimit: number): string {
  return `이 범위는 고정이 ${pinLimit}개까지예요`;
}

/** 화면에 그릴 묶음과 행 — 검색 질의로 거른 뒤 묶음 순서대로 앞에서부터 maxRows 행까지만 담는다(인피니트 스크롤). 행이 없는 묶음은 뺀다. */
export interface VisibleGroup {
  group: MemoryGroup;
  rows: AiMemoryItem[];
  /** 이 묶음에서 질의와 맞는 행 수(자르기 전) — 검색 중 머리글 "N개 일치". */
  matched: number;
}

/**
 * 인피니트 스크롤용 — 묶음(고정 먼저 → 유효 → 만료) 전체를 한 줄로 이어 앞에서 maxRows 행만 보인다. total 은 거른 뒤 전체 행 수(맞는 게 없음 안내),
 * hasMore 는 아직 그리지 않은 행이 있는지(sentinel). 묶음 카운트(n / 300)는 거르기 전 group 그대로 쓰므로 여기서 바꾸지 않는다.
 */
export function visibleGroups(
  groups: readonly MemoryGroup[],
  query: string,
  maxRows: number,
): { views: VisibleGroup[]; total: number; hasMore: boolean } {
  let left = maxRows;
  let total = 0;
  const views: VisibleGroup[] = [];
  for (const group of groups) {
    const rows = [...group.active, ...group.expired].filter((m) => matchesMemoryQuery(m, query));
    total += rows.length;
    if (rows.length === 0 || left <= 0) continue;
    const shown = rows.slice(0, left);
    left -= shown.length;
    views.push({ group, rows: shown, matched: rows.length });
  }
  return { views, total, hasMore: total > maxRows };
}

/** 만료 뒤 자동 삭제까지 — 서버 정리 배치(기한 < 오늘 - 30)와 같은 기준이라 기한 + 31일에 지워진다. */
const PURGE_AFTER_DAYS = 31;

/** 메모리 줄의 링크형 버튼(되돌리기·기한 연장·계속 기억) 공용 모양 — primary + 밑줄, 터치 영역은 위아래로 넓힌다. */
export const MEMORY_LINK = cn(HIT_AREA_Y_COARSE, 'rounded-sm font-medium text-primary underline underline-offset-2 hover:text-primary/80');

/** 자동 삭제일(YYYY-MM-DD) — 만료 행 안내 "11월 10일에 지워져요". */
export function purgeDateKey(expiresOn: string): string {
  return formatDateKey(addDays(parseDateKey(expiresOn), PURGE_AFTER_DAYS));
}

/** 기한 고르기 빠른 선택 — 오늘(KST 키) 기준. withNone 이면 "기한 없음"(편집·추가) 포함, 만료 행 "기한 연장"엔 없다. */
export function expiryQuickPicks(
  today: string,
  withNone: boolean,
): Array<{ key: 'none' | 'next-week' | 'next-month'; label: string; value: string | null }> {
  const base = parseDateKey(today);
  return [
    ...(withNone ? [{ key: 'none' as const, label: '기한 없음', value: null }] : []),
    { key: 'next-week' as const, label: '다음 주', value: formatDateKey(addDays(base, 7)) },
    { key: 'next-month' as const, label: '한 달 뒤', value: formatDateKey(addMonths(base, 1)) },
  ];
}

/** PATCH 의 기한 부분 — 같으면 {}, 지정이면 expiresOn, 없애면 clearExpiry(서버는 둘을 함께 받지 않는다). */
export function expiryPatch(before: string | null, after: string | null): { expiresOn?: string; clearExpiry?: true } {
  if (before === after) return {};
  return after ? { expiresOn: after } : { clearExpiry: true };
}

/** 한도에 닿은 범위들 — 직접 추가·범위 옮기기에서 고를 수 없다(서버도 409 로 막는다). */
export function fullScopeKeys(groups: readonly MemoryGroup[], limit: number): Set<AiMemoryScopeKey> {
  return new Set(groups.filter((g) => g.active.length >= limit).map((g) => g.key));
}

/** 직접 추가의 처음 범위 — 공통, 공통이 가득이면 첫 빈 앱 범위, 모두 가득이면 null(추가 버튼이 막힌다). */
export function defaultAddScope(full: ReadonlySet<AiMemoryScopeKey>): AiMemoryScopeKey | null {
  return SCOPE_ORDER.find((k) => !full.has(k)) ?? null;
}

/** 묶음 소제목 설명. */
export function scopeDescription(key: AiMemoryScopeKey): string {
  return key === 'COMMON' ? '모든 AI 대화에 반영돼요' : `${SCOPE_LABEL[key]} 화면의 AI 대화에만 반영돼요`;
}
