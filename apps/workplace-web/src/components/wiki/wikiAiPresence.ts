import type { HocuspocusProvider } from '@hocuspocus/provider'
import { COLLAB_AI_MARKERS_FIELD, type CollabAiMarker } from '@smart-workplace/wiki-editor-schema/collab-protocol'

import { announceAwarenessField } from './wikiAwarenessField'

// 표식 id 를 같은 밀리초 안에서도 겹치지 않게 하는 순번.
let seq = 0

/**
 * 내 `/ai` 생성 동안 다른 접속자에게 "✦ 내 이름" 표식을 삽입 위치에 고정해 보인다(스펙 §5.2·Q7). 반환 함수로 내린다(여러 번 불러도 안전).
 *
 * - anchor 는 Y.relativePositionToJSON 결과 — 받는 쪽이 자기 문서에서 풀어, 생성 중 누가 위쪽을 고쳐도 삽입 위치를 따라간다.
 * - 재접속(synced)마다 다시 올리고, 다른 필드(WP-173 의 user)와 합쳐 넣고, 이미 지워진 상태를 되살리지 않는 규칙은
 *   announceAwarenessField 가 맡는다(접속자 알리기와 같은 규칙).
 */
export function announceAiWriting(
  provider: Pick<HocuspocusProvider, 'awareness' | 'on' | 'off'>,
  who: { userId: number; name: string },
  anchor: unknown,
): () => void {
  const marker: CollabAiMarker = { id: `ai-${Date.now().toString(36)}-${++seq}`, userId: who.userId, name: who.name, anchor }
  return announceAwarenessField<CollabAiMarker[]>(provider, COLLAB_AI_MARKERS_FIELD, [marker])
}
