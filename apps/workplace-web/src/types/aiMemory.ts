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
}

/** GET /users/me/ai-memories — updatedAt 최신순 + 상한(50). */
export interface AiMemoryList {
  items: AiMemoryItem[];
  limit: number;
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
