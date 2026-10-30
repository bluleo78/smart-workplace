// 지금 보는 대상 등록 훅(WP-1234) — 상세 화면이 마운트된 동안 ⇧⌘,·⌘. 단축키가 이 대상을 쓰게 한다.
import { useEffect, useState } from 'react'

import { type ShareTarget, type ShareTargetLayer, shareTargetStore } from '@/lib/shareTarget'

/**
 * target 을 지금 보는 대상으로 등록한다(null 이면 대상으로 쓰지 않음 — 로딩 중·링크를 딸 수 없는 화면. 자리는 지킨다).
 * layer — 상세 화면은 'page'(기본), 그 위에 뜨는 뷰어·대화상자는 'overlay'. 열린 overlay 가 page 보다 늘 이긴다
 * (자식 effect 가 부모보다 먼저 돌아 등록 순서로는 위아래를 알 수 없다). 같은 층에선 나중에 마운트한 쪽이 이긴다. 언마운트 때 자기 자리만 뺀다.
 */
export function useRegisterShareTarget(target: ShareTarget | null, layer: ShareTargetLayer = 'page'): void {
  // 등록자 토큰 — 렌더마다 바뀌지 않게 한 번만 만든다.
  const [token] = useState(() => Symbol('share-target'))
  useEffect(() => {
    shareTargetStore.set(token, target, layer)
  }, [token, target, layer])
  useEffect(() => () => shareTargetStore.release(token), [token])
}
