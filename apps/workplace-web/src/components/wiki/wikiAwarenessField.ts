import type { HocuspocusProvider } from '@hocuspocus/provider'

/** 알리기에 쓰는 provider 의 최소 모양 — awareness 와 synced 구독만. */
export type AnnounceProvider = Pick<HocuspocusProvider, 'awareness' | 'on' | 'off'>

/**
 * 내 awareness 의 한 필드를 올리고 유지한다 — 접속자(user)·AI 표식(aiMarkers)이 같은 규칙을 쓰도록 한곳에 둔다. 반환 함수로 내린다(여러 번 불러도 안전).
 *
 * - 재동기화(synced)마다 다시 올린다: provider 는 pagehide·소켓 종료 때 내 awareness 를 지우고(상대 화면에서 사라짐),
 *   다시 붙을 때 로컬 상태가 null 이면 아무것도 보내지 않는다. 다시 동기화되면 'synced' 를 내므로(4.7 `onClose` 가 synced=false 로
 *   되돌림 → 재동기화 때 false→true 로 재발행) 그때 다시 올린다(스펙 §7.3 "재접속마다 user 를 다시 설정", WP-283 스파이크).
 * - setLocalStateField 는 로컬 상태가 null 이면 아무것도 하지 않으므로 setLocalState 로 다른 필드와 합쳐 넣는다(서로의 필드 보존).
 * - 내릴 때 로컬 상태가 이미 null(provider 파기·pagehide)이면 쓰지 않는다 — null 을 `{field:null}` 로 되살려 다시 알리지 않게.
 */
export function announceAwarenessField<T>(provider: AnnounceProvider, field: string, value: T): () => void {
  const awareness = provider.awareness
  if (!awareness) return () => {}
  const put = (v: T | null) => awareness.setLocalState({ ...(awareness.getLocalState() ?? {}), [field]: v })
  put(value)
  const onSynced = () => put(value)
  provider.on('synced', onSynced)
  let done = false
  return () => {
    if (done) return
    done = true
    provider.off('synced', onSynced)
    if (awareness.getLocalState() != null) put(null)
  }
}
