// WP-386 공용 AI 메모리 계약 — 백엔드 SharedMemorySpaceItem·SharedAiMemoryItem·SharedAiMemoryPage·SharedAiMemoryChangeItem 과 1:1.

/** 공간 종류 — 조직 지침 · 프로젝트(TEAM·OPEN) · 노트 스페이스(TEAM). */
export type SharedSpaceType = 'ORG' | 'PROJECT' | 'WIKI_SPACE';
/** 출처 — 직접 추가 · AI 비서에 요청 · 대화에서 AI가 기억 · AI가 정리. */
export type SharedMemoryOrigin = 'USER_ADDED' | 'USER_REQUESTED' | 'AI_EXTRACTED' | 'AI_CLEANED';

/** GET /spaces 한 줄 — 내가 읽을 수 있는 공간(조직 → 프로젝트 → 노트 스페이스, 이름순). id·key 는 조직이면 null. */
export interface SharedMemorySpace {
  type: SharedSpaceType;
  id: number | null;
  key: string | null;
  name: string;
  /** 화면·블록 이름 — 「조직」, 「이름(키)」, 스페이스 이름. */
  label: string;
  count: number;
  limit: number;
  canAdd: boolean;
  canManage: boolean;
}

export interface SharedMemorySpaceList {
  items: SharedMemorySpace[];
}

/** 화면이 고른 공간(쿼리 ?space=PROJECT:12). */
export interface SharedSpaceRef {
  type: SharedSpaceType;
  id: number | null;
}

/** 공용 메모리 한 건 — author 는 직접 추가·요청한 사람만(대화에서 뽑힌 항목·AI 정리는 없음). */
export interface SharedAiMemoryItem {
  id: number;
  content: string;
  origin: SharedMemoryOrigin;
  author?: { name: string };
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
}

/** 목록 한 묶음 — nextCursor 가 없으면 끝(검색은 늘 한 묶음). count·limit 은 공간 전체. */
export interface SharedAiMemoryPage {
  items: SharedAiMemoryItem[];
  nextCursor?: string | null;
  count: number;
  limit: number;
}

interface SharedMemorySnapshot {
  id: number;
  content: string;
  origin: SharedMemoryOrigin;
  authorUserId?: number | null;
}

export type SharedMemoryChangeAction = 'ADDED' | 'UPDATED' | 'MERGED' | 'DELETED' | 'RESTORED';

/** 공간 기록 한 건 — 행위자 이름(사람) 또는 AI. undoable 은 서버가 요청자 권한·RESTORED 여부로 정한다. */
export interface SharedAiMemoryChange {
  id: number;
  action: SharedMemoryChangeAction;
  actor: { kind: 'USER' | 'AI'; name?: string };
  createdAt: string;
  memory: SharedMemorySnapshot | null;
  before: SharedMemorySnapshot[];
  undoneAt: string | null;
  undoable: boolean;
}

export interface SharedAiMemoryChangePage {
  items: SharedAiMemoryChange[];
  nextCursor?: string | null;
}

export interface UndoSharedAiMemoryChangeResponse {
  change: SharedAiMemoryChange;
}

/** 홈 채팅 요청의 화면 공간(서버가 권한을 다시 확인해 저장한다 — WP-386 6.1). */
export type ChatSpace = { type: 'PROJECT'; key: string } | { type: 'WIKI_SPACE'; id: number };
