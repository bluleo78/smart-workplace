import { useQueries, type UseQueryResult } from '@tanstack/react-query'
import type { Editor } from '@tiptap/react'
import { useEffect, useState } from 'react'

import { type AppLinkCard, appLinkCardQuery, isAppLinkDenied } from '@/api/appLinks'
import type { AppLink } from '@/lib/appLinks'

import { appLinkChipTargets, refreshAppLinkChips } from './wikiAppLinkChips'

/** 보일 카드 — 다시 받다가 볼 수 없게 됐으면(404·403) 예전 카드가 남아 있어도 칩을 거둔다(권한을 잃은 제목이 남지 않게). */
const shownCards = (results: UseQueryResult<AppLinkCard>[]) =>
  results.map((r) => (r.data && !isAppLinkDenied(r.error) ? r.data : undefined))

/**
 * 노트 본문 앱 링크 칩의 카드 받기(WP-1147) — 본문이 바뀔 때 플러그인이 모은 대상을 읽고, 대상마다 채팅 카드와 같은 캐시로 카드를 받아
 * 플러그인에 넘긴다. 볼 수 없거나(404) 받지 못한 대상은 넘기지 않아 원래 링크로 남는다.
 */
export function useWikiAppLinkChips(editor: Editor | null) {
  const [targets, setTargets] = useState<AppLink[]>([])

  useEffect(() => {
    if (!editor) return
    // 플러그인은 대상이 같으면 같은 배열을 돌려주므로 같은 값이면 다시 그리지 않는다.
    const read = () => setTargets(appLinkChipTargets(editor.state))
    read()
    editor.on('update', read)
    return () => {
      editor.off('update', read)
    }
  }, [editor])

  // combine 결과는 결과가 바뀔 때만 새로 만들어진다 — 아래 효과의 의존성으로 바로 쓴다.
  const cards = useQueries({ queries: targets.map(appLinkCardQuery), combine: shownCards })

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const map = new Map<string, AppLinkCard>()
    cards.forEach((card, i) => {
      if (card && targets[i]) map.set(targets[i].to, card)
    })
    refreshAppLinkChips(editor.view, map)
  }, [editor, targets, cards])
}
