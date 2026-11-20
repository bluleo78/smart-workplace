// 채팅 전송 실패 시 낙관(임시) 행 되돌리기 공용 함수(WP-1872).
// 스냅숏을 통째로 되돌리면 그동안 성공한 다른 전송·SSE 로 더해진 행까지 지워지므로, 그 전송의 임시 행만 걷는다.
import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query';

/**
 * 캐시의 모든 페이지에서 `id === tempId` 행만 걷는다. 다른 행은 건드리지 않는다.
 *
 * 전송 전에 캐시가 없었다면(hadCache=false) 낙관 행이 캐시를 만들어 냈으므로, 걷은 뒤
 * 서버 상태로 다시 받도록 무효화한다(빈 캐시가 「메시지 없음」으로 굳는 것을 막는다).
 */
export function removeOptimisticRow(
  qc: QueryClient,
  key: QueryKey,
  tempId: number,
  hadCache: boolean,
): void {
  qc.setQueryData<InfiniteData<{ items: { id: number }[] }>>(key, (old) => {
    // 임시 행이 이미 없으면(무효화·재조회가 갈아엎음) 그대로 둔다 — 쓸데없는 다시 그리기를 막는다.
    if (!old || !old.pages.some((p) => p.items.some((m) => m.id === tempId))) return old;
    return { ...old, pages: old.pages.map((p) => ({ ...p, items: p.items.filter((m) => m.id !== tempId) })) };
  });
  if (!hadCache) void qc.invalidateQueries({ queryKey: key });
}

/**
 * 전송 성공 시 임시 행을 서버 행으로 바꾼다. 임시 행이 사라졌다면(다른 전송 실패로 인한 무효화·재조회가
 * 캐시를 갈아엎은 경우) 저장된 행을 직접 넣는다 — position 'start'=첫 페이지 앞(최신순), 'end'=마지막 페이지 끝(ASC).
 * id 기준 dedup 으로 SSE self-echo 가 이미 넣은 행과 중복되지 않게 한다. 캐시가 없으면 건드리지 않는다.
 * 캐시 없이 보냈던(hadCache=false) 전송은 낙관 행이 첫 로드를 취소시켰으므로 끝에 무효화해 목록을 다시 받는다.
 */
export function settleOptimisticRow<T extends { id: number }>(
  qc: QueryClient,
  key: QueryKey,
  tempId: number,
  saved: T,
  hadCache: boolean,
  position: 'start' | 'end',
): void {
  qc.setQueryData<InfiniteData<{ items: T[] }>>(key, (old) => {
    if (!old) return old;
    const seen = new Set<number>();
    const pages = old.pages.map((p) => ({
      ...p,
      items: p.items
        .map((m) => (m.id === tempId ? saved : m))
        .filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true))),
    }));
    // 임시 행을 바꿨거나 SSE echo 가 이미 넣었으면 seen 에 saved.id 가 있다 — 넣을 것 없음.
    if (seen.has(saved.id) || pages.length === 0) return { ...old, pages };
    // 임시 행도 echo 도 없다 — 저장된 행을 넣는다.
    const idx = position === 'start' ? 0 : pages.length - 1;
    pages[idx] = {
      ...pages[idx],
      items: position === 'start' ? [saved, ...pages[idx].items] : [...pages[idx].items, saved],
    };
    return { ...old, pages };
  });
  if (!hadCache) void qc.invalidateQueries({ queryKey: key });
}
