// WP-55 AI 메모리 계약 — 백엔드 AiMemoryItem·AiMemoryListResponse·UndoAiMemoryRequest/Response 와 1:1.

/** 선호·교정(PREFERENCE) / 업무 맥락(CONTEXT). */
export type AiMemoryKind = 'PREFERENCE' | 'CONTEXT';
/** AI 가 저장(AI) / 설정에서 직접 추가(USER). */
export type AiMemorySource = 'AI' | 'USER';
/** WP-379 메모리 범위(앱) — 없으면(null) 공통. 서버 AiMemoryScope.APPS 와 같은 순서(설정 화면 묶음 순서). */
export type AiMemoryScope = 'ISSUE' | 'WIKI' | 'MAIL' | 'DRIVE' | 'MESSAGING' | 'CALENDAR';

/** 메모리 1건. previousContent·previousKind 는 고치기(PATCH) 응답에만 온다. */
export interface AiMemoryItem {
  id: number;
  kind: AiMemoryKind;
  content: string;
  source: AiMemorySource;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  previousContent?: string;
  previousKind?: AiMemoryKind;
  /** WP-379: 범위 — null 이면 공통. 구 API 응답엔 없다. */
  scope?: AiMemoryScope | null;
  /** WP-379: 고치기 전 범위(PATCH 응답, 앱이었을 때만). */
  previousScope?: AiMemoryScope;
  /** WP-380: 기한(YYYY-MM-DD, 그날까지 유효) — null·없음은 기한 없음. */
  expiresOn?: string | null;
  /** WP-380: 서버 오늘(KST) 기준 만료 여부 — 웹은 날짜를 다시 계산하지 않는다. */
  expired?: boolean;
  /** WP-380: 고치기 전 기한(PATCH 응답, 있었을 때만). */
  previousExpiresOn?: string;
  /** WP-383: 사용자가 고정했는가 — 고정 행은 묶음 맨 위·채팅에 먼저 실린다(토큰 예산 안에서). 구 API 응답엔 없다. */
  pinned?: boolean;
  /** WP-385: 대화가 끝난 뒤 AI 정리로 생기거나 바뀐 뒤 그대로면 그 정리 시각 — 행 메타가 「AI가 정리」. 사용자가 고치면 빠진다. */
  cleanedAt?: string;
}

/** GET /users/me/ai-memories — updatedAt 최신순 + 범위마다 상한(300) + 범위마다 고정 상한(10, WP-383 — 구 API 엔 없다). */
export interface AiMemoryList {
  items: AiMemoryItem[];
  limit: number;
  pinLimit?: number;
}

/** 채팅 결과 줄 되돌리기 — blockIndex 는 그 메시지의 memory 블록 순번(0부터). */
export interface UndoAiMemoryRequest {
  messageId: number;
  blockIndex: number;
}

/** 되돌리기 결과 — memory 는 복원·재생성된 항목(saved 되돌리기·멱등 재호출이면 없음). */
export interface UndoAiMemoryResponse {
  messageId: number;
  blockIndex: number;
  undone: boolean;
  memory?: AiMemoryItem;
}

/** WP-385 정리 기록 동작 — 새로 기억·합침·고침·대화와 맞지 않아 지움·90일 동안 안 써서 지움. */
export type AiMemoryChangeAction = 'ADDED' | 'MERGED' | 'UPDATED' | 'FORGOTTEN' | 'DECAYED';

/** 기록 안의 메모리 스냅숏(서버 MemorySnapshot). */
export interface AiMemorySnapshot {
  id: number;
  content: string;
  kind: AiMemoryKind;
  scope: AiMemoryScope | null;
  expiresOn: string | null;
  source: AiMemorySource;
  pinned: boolean;
  lastUsedAt: string | null;
}

/** 「AI가 정리한 기록」 1건 — memory 는 결과(지움이면 null), before 는 원본들(새로 기억이면 빈 배열). source 는 출처 대화(지워졌으면 없음). */
export interface AiMemoryChange {
  id: number;
  action: AiMemoryChangeAction;
  createdAt: string;
  memory: AiMemorySnapshot | null;
  before: AiMemorySnapshot[];
  source?: { id: string; title: string | null };
  reason?: string;
  undoneAt: string | null;
}

/** GET /users/me/ai-memories/changes — 최신순 묶음 + 지난 30일 횟수(0 이면 안내 줄을 숨긴다). */
export interface AiMemoryChangePage {
  items: AiMemoryChange[];
  nextCursor: string | null;
  count30d: number;
}

/** POST /users/me/ai-memories/changes/{id}/undo 결과 — 되돌림 표시가 붙은 기록. */
export interface UndoAiMemoryChangeResponse {
  change: AiMemoryChange;
}
