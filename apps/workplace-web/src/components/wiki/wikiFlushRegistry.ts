// 위키 에디터 언마운트 flush 진행 표 — 모듈 레벨 Map<pageId, Promise>.
// 왜: 에디터가 리마운트(뷰포트 lg 경계 전환 등)되면 새 에디터는 캐시의 페이지(flush 전 본문·version)로 뜬다.
// 그대로 두면 방금 친 글자가 화면에서 사라지고 다음 편집이 옛 version 으로 PUT 돼 409 가 난다.
// flush PUT 이 끝날 때까지 WikiPageView 가 에디터 대신 skeleton 을 보이고, 끝나면(useSavePage 의 onSuccess 가
// 이미 새 페이지를 캐시에 써 둠) 최신 본문·version 으로 에디터를 다시 마운트한다. versionRef 를 props 로
// 동기화하지 않는 이유: 낙관적 동시성(다른 사용자의 저장 감지)을 깨뜨리지 않기 위해.
import { useCallback, useSyncExternalStore } from 'react'

const inflight = new Map<number, Promise<unknown>>()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

/** 페이지의 flush 저장 promise 를 등록한다. 성공·실패와 무관하게 끝나면 해제(같은 promise 일 때만). */
export function trackWikiFlush(pageId: number, p: Promise<unknown>): void {
  inflight.set(pageId, p)
  emit()
  p.catch(() => {}).finally(() => {
    if (inflight.get(pageId) !== p) return
    inflight.delete(pageId)
    emit()
  })
}

/** 페이지에 진행 중인 flush 저장이 있는지 구독한다. pageId 가 null 이면 항상 false. */
export function useWikiFlushPending(pageId: number | null): boolean {
  const subscribe = useCallback((l: () => void) => {
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  return useSyncExternalStore(subscribe, () => pageId != null && inflight.has(pageId))
}
