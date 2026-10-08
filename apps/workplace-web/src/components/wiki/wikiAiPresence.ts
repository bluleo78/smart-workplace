import type { HocuspocusProvider } from '@hocuspocus/provider'
import { COLLAB_AI_MARKERS_FIELD, type CollabAiMarker } from '@smart-workplace/wiki-editor-schema/collab-protocol'

// 표식 id 를 같은 밀리초 안에서도 겹치지 않게 하는 순번.
let seq = 0

/**
 * 내 `/ai` 생성 동안 다른 접속자에게 "✦ 내 이름" 표식을 삽입 위치에 고정해 보인다(스펙 §5.2·Q7). 반환 함수로 내린다(여러 번 불러도 안전).
 *
 * - anchor 는 Y.relativePositionToJSON 결과 — 받는 쪽이 자기 문서에서 풀어, 생성 중 누가 위쪽을 고쳐도 삽입 위치를 따라간다.
 * - 재접속(synced)마다 다시 올린다: provider 는 pagehide·소켓 종료 때 내 awareness 를 지우고(상대 화면에서 표식이 사라짐),
 *   다시 동기화되면 'synced' 를 낸다(4.7 `onClose` 가 synced=false 로 되돌림 → 재동기화 때 false→true 로 재발행). WP-283 스파이크.
 * - setLocalStateField 는 로컬 상태가 null 이면 아무것도 하지 않으므로 setLocalState 로 다른 필드와 합쳐 넣는다(WP-173 의 user 필드 보존).
 * - 내릴 때 로컬 상태가 이미 null(provider 파기·pagehide)이면 쓰지 않는다 — null 을 `{aiMarkers:null}` 로 되살려 다시 알리지 않게.
 */
export function announceAiWriting(
  provider: Pick<HocuspocusProvider, 'awareness' | 'on' | 'off'>,
  who: { userId: number; name: string },
  anchor: unknown,
): () => void {
  const awareness = provider.awareness
  if (!awareness) return () => {}
  const marker: CollabAiMarker = { id: `ai-${Date.now().toString(36)}-${++seq}`, userId: who.userId, name: who.name, anchor }
  const put = (value: CollabAiMarker[] | null) =>
    awareness.setLocalState({ ...(awareness.getLocalState() ?? {}), [COLLAB_AI_MARKERS_FIELD]: value })
  put([marker])
  const onSynced = () => put([marker])
  provider.on('synced', onSynced)
  let done = false
  return () => {
    if (done) return
    done = true
    provider.off('synced', onSynced)
    if (awareness.getLocalState() != null) put(null)
  }
}
