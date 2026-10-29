import { useQueries, type UseQueryResult } from '@tanstack/react-query'
import type { Editor } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'

import { type AppLinkCard, appLinkCardQuery, isAppLinkDenied } from '@/api/appLinks'
import { useAppHosts } from '@/hooks/queries/useAppLinks'
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
  // 공개 웹 주소 호스트가 늦게 오면(앱 셸의 설정 응답) 바뀐다 — 그때 플러그인이 자리를 다시 모으게 한다(WP-1165).
  const appHosts = useAppHosts()
  // 플러그인이 자리를 모을 때 본 호스트 — 처음(플러그인 init)과 같으면 다시 모으게 하지 않는다.
  const seenHosts = useRef(appHosts)

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    // 플러그인은 대상이 같으면 같은 배열을 돌려주므로 같은 값이면 다시 그리지 않는다.
    const read = () => setTargets(appLinkChipTargets(editor.state))
    // 호스트가 바뀌었으면 카드 없는 거래로 자리를 다시 모으게 한 뒤 대상을 읽는다(문서는 그대로라 update 가 오지 않는다).
    if (seenHosts.current !== appHosts) {
      seenHosts.current = appHosts
      refreshAppLinkChips(editor.view)
    }
    read()
    editor.on('update', read)
    return () => {
      editor.off('update', read)
    }
  }, [editor, appHosts])

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
