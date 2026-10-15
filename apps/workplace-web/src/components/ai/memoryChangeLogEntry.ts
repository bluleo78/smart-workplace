// 메모리 변경 기록 한 줄의 화면 모델 — 개인 「AI가 정리한 기록」(WP-385)과 공용 메모리 「변경 이력」(WP-386)이 같은 목록(MemoryChangeLog)을 쓴다.
// API 모양은 기능마다 다르므로 각 기능이 이 모델로 바꿔 넘긴다(lib/aiMemoryChange.ts 가 개인 기록의 매핑).

/** 아이콘 종류 — DELETED·RESTORED 는 공용 메모리 이력(WP-386)이 쓴다. */
export type MemoryChangeIcon = 'ADDED' | 'MERGED' | 'UPDATED' | 'FORGOTTEN' | 'DECAYED' | 'DELETED' | 'RESTORED';

export interface MemoryChangeLogEntry {
  id: number;
  /** 일어난 시각(ISO) — 날짜 묶음과 시각 표시의 근거. */
  at: string;
  icon: MemoryChangeIcon;
  /** 무슨 일이 있었는지(쉬운 말) — "새로 기억함", "2개를 합침". */
  label: string;
  /** 누가 했는지(공용 메모리 이력) — 개인 정리 기록은 없음. */
  actor?: string;
  /** 지금(또는 지운) 메모리 내용. */
  content: string;
  /** 지운 항목이면 내용에 취소선. */
  removed: boolean;
  /** 이전 내용들(취소선) — 고침은 1개, 합침은 원본 전부. */
  before: string[];
  /** before 앞 이름 — "이전" 또는 "합치기 전". */
  beforeLabel?: string;
  /** 보조 문구(지운 사유 등). */
  note?: string;
  /** 출처 대화 — 링크 /?aiChat=<id>. 제목이 없으면 "제목 없는 대화". */
  source?: { id: string; title: string | null };
  /** 되돌린 시각(ISO) — 있으면 흐리게 + "되돌림 · 시각", 버튼 없음. */
  undoneAt: string | null;
  /** 되돌리기 버튼을 둘 수 있는 기록인가. */
  undoable: boolean;
}

/** 되돌리기 거절(그 뒤에 메모리가 바뀜) 토스트 — 두 기능이 같은 문구를 쓴다. */
export const CHANGE_UNDO_REFUSED_MESSAGE = '그 뒤에 메모리가 바뀌어 되돌릴 수 없어요';
