// 채팅 전송 실패 시 낙관(임시) 행 되돌리기 공용 함수(WP-1872).
// 스냅숏을 통째로 되돌리면 그동안 성공한 다른 전송·SSE 로 더해진 행까지 지워지므로, 그 전송의 임시 행만 걷는다.
import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query';

/**
 * 이 키의 낙관 전송 mutation 들이 공유하는 mutationKey. 같은 대화의 진행 중 전송 수를 `qc.isMutating` 으로 센다.
 */
export function optimisticSendKey(key: QueryKey): QueryKey {
  return ['optimistic-send', ...key];
}

// QueryClient 별 「목록 복구 필요」 표시 — 합성 캐시를 만들었거나 진행 중 조회를 취소한 키. 클라이언트 간 공유하지 않는다.
const recoveryMarks = new WeakMap<QueryClient, Set<string>>();

function markRecovery(qc: QueryClient, key: QueryKey): void {
  let marks = recoveryMarks.get(qc);
  if (!marks) recoveryMarks.set(qc, (marks = new Set()));
  marks.add(JSON.stringify(key));
}

/**
 * 낙관 전송 onMutate 의 앞머리. 진행 중 조회를 취소한다.
 *
 * 캐시가 없거나(낙관 행이 합성 1페이지 캐시를 만든다) 전체 조회가 진행·멈춤 중이면(복구 재조회·첫 로드가 취소된다)
 * 서버 목록이 가려지므로 그 키를 「복구 필요」로 표시한다 — 표시는 {@link finishOptimisticSend} 가 전송이 모두 끝난 뒤 한 번 푼다.
 * 이전 페이지 더 불러오기(fetchMore)만 취소된 경우는 표시하지 않는다 — 다시 스크롤하면 되고, 무효화는 불러온 페이지를 모두 다시 받는다.
 */
export async function beginOptimisticSend(qc: QueryClient, key: QueryKey): Promise<void> {
  const state = qc.getQueryState(key);
  // 오프라인이면 조회가 'paused' 로 멈춰 있어도 cancelQueries 가 취소하므로 'idle' 이 아니면 모두 본다.
  const fullFetchInFlight =
    state !== undefined && state.fetchStatus !== 'idle' && !(state.fetchMeta as { fetchMore?: unknown } | null)?.fetchMore;
  if (state?.data === undefined || fullFetchInFlight) markRecovery(qc, key);
  await qc.cancelQueries({ queryKey: key });
}

/**
 * 전송이 끝날 때(onSuccess/onError) 부른다. 이 키의 다른 전송이 남아 있으면 아무것도 하지 않는다 —
 * 재조회가 다른 전송의 임시 행을 지우기 때문. 마지막 전송이고 복구 표시가 있으면 표시를 풀고 목록을 다시 받는다.
 * TanStack v5 는 onSuccess/onError 콜백이 도는 동안 현재 mutation 을 pending 으로 두므로 「나 하나(<=1)」면 마지막이다.
 */
export function finishOptimisticSend(qc: QueryClient, key: QueryKey): void {
  if (qc.isMutating({ mutationKey: optimisticSendKey(key), exact: true }) > 1) return;
  const marks = recoveryMarks.get(qc);
  if (!marks?.delete(JSON.stringify(key))) return;
  void qc.invalidateQueries({ queryKey: key });
}

/**
 * 캐시의 모든 페이지에서 `id === tempId` 행만 걷는다. 다른 행은 건드리지 않는다.
 *
 * 목록 복구(재조회)는 여기서 하지 않고 {@link finishOptimisticSend} 가 전송이 모두 끝난 뒤 한 번 한다.
 */
export function removeOptimisticRow(
  qc: QueryClient,
  key: QueryKey,
  tempId: number,
): void {
  qc.setQueryData<InfiniteData<{ items: { id: number }[] }>>(key, (old) => {
    // 임시 행이 이미 없으면(무효화·재조회가 갈아엎음) 그대로 둔다 — 쓸데없는 다시 그리기를 막는다.
    if (!old || !old.pages.some((p) => p.items.some((m) => m.id === tempId))) return old;
    return { ...old, pages: old.pages.map((p) => ({ ...p, items: p.items.filter((m) => m.id !== tempId) })) };
  });
  finishOptimisticSend(qc, key);
}

/**
 * 전송 성공 시 임시 행을 서버 행으로 바꾼다. 임시 행이 사라졌다면(다른 전송 실패로 인한 무효화·재조회가
 * 캐시를 갈아엎은 경우) 저장된 행을 직접 넣는다 — position 'start'=첫 페이지 앞(최신순), 'end'=마지막 페이지 끝(ASC).
 * id 기준 dedup 으로 SSE self-echo 가 이미 넣은 행과 중복되지 않게 한다. 캐시가 없으면 건드리지 않는다.
 * 목록 복구가 필요하면(캐시 없이 보냈거나 복구 재조회를 취소했다면) 마지막 전송이 끝날 때 한 번 재조회한다.
 */
export function settleOptimisticRow<T extends { id: number }>(
  qc: QueryClient,
  key: QueryKey,
  tempId: number,
  saved: T,
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
  finishOptimisticSend(qc, key);
}
