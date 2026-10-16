// WP-385 「AI가 정리한 기록」 API 항목 → 공용 기록 목록의 화면 모델. 화면 문구는 동작(action)으로 만들고, 모델이 준 사유는 지움에만 보조로 싣는다.
import type { MemoryChangeLogEntry } from '@/components/ai/memoryChangeLogEntry';
import type { AiMemoryChange, AiMemoryChangeAction } from '@/types/aiMemory';

/** 동작별 이름 — 합침은 원본 개수를 넣는다. */
const LABEL: Record<AiMemoryChangeAction, (merged: number) => string> = {
  ADDED: () => '새로 기억함',
  MERGED: (n) => `${n}개를 합침`,
  UPDATED: () => '고침',
  FORGOTTEN: () => '대화와 맞지 않아 지움',
  DECAYED: () => '90일 동안 쓰지 않아 지움',
};

/** API 기록 → 화면 모델. 지움(FORGOTTEN·DECAYED)은 원본 내용을 취소선으로 보이고, 고침·합침은 이전 내용을 보조 줄에 싣는다. */
export function toChangeLogEntry(c: AiMemoryChange): MemoryChangeLogEntry {
  const removed = c.action === 'FORGOTTEN' || c.action === 'DECAYED';
  const showBefore = c.action === 'UPDATED' || c.action === 'MERGED';
  return {
    id: c.id,
    at: c.createdAt,
    icon: c.action,
    label: LABEL[c.action](c.before.length),
    content: c.memory?.content ?? c.before[0]?.content ?? '',
    removed,
    before: showBefore ? c.before.map((b) => b.content) : [],
    ...(showBefore ? { beforeLabel: c.action === 'MERGED' ? '합치기 전' : '이전' } : {}),
    ...(c.action === 'FORGOTTEN' && c.reason ? { note: c.reason } : {}),
    ...(c.source ? { source: c.source } : {}),
    undoneAt: c.undoneAt,
    undoable: true,
  };
}
