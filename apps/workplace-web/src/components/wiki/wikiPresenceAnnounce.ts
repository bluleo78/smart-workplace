import { COLLAB_USER_FIELD, type CollabPresenceUser } from '@smart-workplace/wiki-editor-schema/collab-protocol'

import { announceAwarenessField,type AnnounceProvider } from './wikiAwarenessField'

/**
 * 이 노트를 보고 있다고 다른 접속자에게 알린다(WP-173) — awareness user 필드에 {id, name}. 반환 함수로 내린다.
 * 재동기화마다 다시 올리고 내릴 때 다른 필드(aiMarkers·cursor)를 건드리지 않는 규칙은 announceAwarenessField 가 맡는다.
 * VIEWER 도 알린다(목록에 "보는 중"). 커서 공개 여부는 WikiPresenceCursors 가 따로 판단한다.
 */
export function announcePresence(provider: AnnounceProvider, user: CollabPresenceUser): () => void {
  return announceAwarenessField<CollabPresenceUser>(provider, COLLAB_USER_FIELD, user)
}
