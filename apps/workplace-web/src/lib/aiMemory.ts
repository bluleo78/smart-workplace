// WP-55 AI 메모리 공용 규칙 — 서버 오류 코드(ErrorResponse.errors.code) 해석과 사용자 문구.
// handleApiError 는 errors 의 첫 값(코드 문자열)을 토스트로 띄우므로 메모리 오류는 이 코드로 문구를 고른다.
import { apiErrorResponse, extractApiError, extractApiErrorCode } from '@/lib/api-error';
import type { AiMemoryItem, AiMemoryScope } from '@/types/aiMemory';

/** 되돌릴 대상이 이미 없을 때(GONE·NOT_FOUND). */
export const UNDO_GONE_MESSAGE = '이미 지워진 메모리예요';
/** 고침 되돌리기 — 그 고침 뒤에 메모리가 또 바뀌어 서버가 덮지 않고 거절했을 때(AI_MEMORY_CHANGED). */
export const UNDO_CHANGED_MESSAGE = '그 뒤에 바뀐 메모리라 되돌리지 않았어요';
/** 지움 되돌리기가 상한(50)에 걸렸을 때 — 토스트 action "설정 열기". */
export const UNDO_FULL_MESSAGE = '메모리가 가득 찼어요. 설정에서 정리해 주세요';
/** 가득 참 토스트의 이동 경로. */
export const MEMORY_SETTINGS_PATH = '/settings/assistant';

/** 사용자당 상한(서버 AiMemoryService.LIMIT 과 같다). */
export const MEMORY_LIMIT = 50;
/** 내용 상한(코드포인트, 서버 MAX_CHARS 와 같다). */
export const MEMORY_MAX_CHARS = 300;
/** 이 개수부터 목록 카운트를 주황으로(곧 가득 참). */
export const MEMORY_WARN_AT = 45;

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

/** 목록 카운트(n / 50) 색 — 45개부터 주황. */
export function listCountTone(count: number): string {
  return count >= MEMORY_WARN_AT ? 'text-warning-text' : 'text-muted-foreground';
}

/** 저장 실패 문구 — 메모리 오류 코드가 있으면 서버 문구(errors 의 코드 문자열 대신), 아니면 공용 추출 규칙. */
export function memoryErrorMessage(error: unknown, fallback: string): string {
  const message = apiErrorResponse(error)?.message;
  if (message && extractApiErrorCode(error)) return message;
  return extractApiError(error, fallback);
}

/** WP-379 앱 범위 — 설정 화면 묶음·선택 순서(공통 다음). */
export const MEMORY_SCOPES: readonly AiMemoryScope[] = ['ISSUE', 'WIKI', 'MAIL', 'DRIVE', 'MESSAGING', 'CALENDAR'];
/** 묶음·선택·한도 키 — 공통은 'COMMON'(서버 errors.scope 와 같은 표기). */
export type AiMemoryScopeKey = AiMemoryScope | 'COMMON';
/** 범위 이름(ai-agent MEMORY_SCOPE_LABEL 과 같다). */
export const SCOPE_LABEL: Record<AiMemoryScopeKey, string> = {
  COMMON: '공통',
  ISSUE: '이슈',
  WIKI: '노트',
  MAIL: '메일',
  DRIVE: '드라이브',
  MESSAGING: '메신저',
  CALENDAR: '캘린더',
};

/** 항목의 범위 키 — null·없음(구 API)은 공통. */
export function scopeKeyOf(scope: AiMemoryScope | null | undefined): AiMemoryScopeKey {
  return scope ?? 'COMMON';
}

/** 결과 줄 명사 — 앱 범위면 "이슈 메모리", 공통이면 "메모리"(WP-55 문구 그대로). */
export function memoryNoun(scope: AiMemoryScope | null | undefined): string {
  return scope ? `${SCOPE_LABEL[scope]} 메모리` : '메모리';
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

/** 설정 묶음 순서 — 공통을 맨 위에 두고 그 아래 앱 범위를 앱 목록 순서대로 둔다. */
export const SCOPE_ORDER: readonly AiMemoryScopeKey[] = ['COMMON', ...MEMORY_SCOPES];

/** 설정 카드의 범위 묶음 하나 — active 는 유효 행(최신순, 한도 계산 대상), expired 는 만료 행(WP-380, 묶음 끝에 흐리게). */
export interface MemoryGroup {
  key: AiMemoryScopeKey;
  label: string;
  active: AiMemoryItem[];
  expired: AiMemoryItem[];
}

/** 목록(서버 최신순) → 범위 묶음. 빈 범위는 뺀다. 묶음 안은 받은 순서 그대로. */
export function groupMemories(items: readonly AiMemoryItem[]): MemoryGroup[] {
  return SCOPE_ORDER.flatMap((key) => {
    const rows = items.filter((m) => scopeKeyOf(m.scope) === key);
    return rows.length ? [{ key, label: SCOPE_LABEL[key], active: rows, expired: [] }] : [];
  });
}

/** 한도에 닿은 범위들 — 직접 추가·범위 옮기기에서 고를 수 없다(서버도 409 로 막는다). */
export function fullScopeKeys(groups: readonly MemoryGroup[], limit: number): Set<AiMemoryScopeKey> {
  return new Set(groups.filter((g) => g.active.length >= limit).map((g) => g.key));
}

/** 이 개수를 넘는 묶음은 접는다. */
export const COLLAPSE_OVER = 10;
/** 접힌 묶음에 보이는 행 수. */
export const COLLAPSED_SHOW = 5;

/** 묶음에 보일 행 — 10개 넘고 접혀 있으면 처음 5개. */
export function collapsedRows<T>(rows: readonly T[], expanded: boolean): readonly T[] {
  return rows.length > COLLAPSE_OVER && !expanded ? rows.slice(0, COLLAPSED_SHOW) : rows;
}

/** 직접 추가의 처음 범위 — 공통, 공통이 가득이면 첫 빈 앱 범위, 모두 가득이면 null(추가 버튼이 막힌다). */
export function defaultAddScope(full: ReadonlySet<AiMemoryScopeKey>): AiMemoryScopeKey | null {
  return SCOPE_ORDER.find((k) => !full.has(k)) ?? null;
}

/** 묶음 소제목 설명. */
export function scopeDescription(key: AiMemoryScopeKey): string {
  return key === 'COMMON' ? '모든 AI 대화에 반영돼요' : `${SCOPE_LABEL[key]} 화면의 AI 대화에만 반영돼요`;
}
