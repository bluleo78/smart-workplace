// 메일 받는사람 자동완성 후보(WP-945) — 최근 수신인(보낸 메일)과 연락처(구성원·주소록)를 함께 찾아 한 목록으로 합친다.
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { fetchRecentRecipients } from '../../api/mailMessages'
import { mergeRecipientSuggestions, type RecipientSuggestion } from '../../lib/mailRecipientSuggest'
import { useDebounceValue } from '../useDebounceValue'
import { useContactsHead } from './useContacts'

/** 드롭다운에 보이는 후보 수 — 출처마다 이만큼 받아 합친 뒤 자른다. */
const SUGGESTION_LIMIT = 8

/** 한 번 받아 두는 최근 수신인 수 — 서버는 최근 보낸 메일 300통에서 모은다. */
const RECENT_LIMIT = 100

/**
 * 쓰는 중인 조각(query)에 맞는 후보. exclude 는 이미 넣은 주소(소문자).
 * 최근 수신인은 칸에 초점이 오면(active) 한 번 받아 두고 브라우저에서 거른다 — 첫 글자를 칠 때 이미 와 있어 목록이 늦게 뒤바뀌지 않게.
 * 연락처만 조각마다 서버에서 찾는다(앞선 결과를 두어 목록이 깜빡이지 않게).
 * 돌려주는 query 는 후보를 고른 기준 조각(디바운스 뒤) — 지금 칸의 글자와 다르면 후보가 아직 따라오지 못한 것이다.
 */
export function useRecipientSuggestions(query: string, exclude: ReadonlySet<string>, active: boolean) {
  const q = useDebounceValue(query.trim(), 150)
  const recent = useQuery({
    queryKey: ['mail-recent-recipients'] as const,
    queryFn: () => fetchRecentRecipients(RECENT_LIMIT),
    enabled: active,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  })
  const contacts = useContactsHead(q, 'ALL', undefined, undefined, SUGGESTION_LIMIT, {
    enabled: active && q.length > 0,
    placeholderData: keepPreviousData,
  })
  const items = useMemo(() => {
    const fromContacts = (type: 'MEMBER' | 'EXTERNAL', source: 'member' | 'external') =>
      (contacts.data?.items ?? [])
        .filter((c) => c.type === type && c.email)
        .map((c): RecipientSuggestion => ({ address: c.email as string, name: c.name || null, source }))
    return mergeRecipientSuggestions(
      q,
      {
        recent: (recent.data ?? []).map((r) => ({ address: r.address, name: r.name, source: 'recent' as const })),
        member: fromContacts('MEMBER', 'member'),
        external: fromContacts('EXTERNAL', 'external'),
      },
      exclude,
      SUGGESTION_LIMIT,
    )
  }, [q, recent.data, contacts.data, exclude])
  return { query: q, items }
}
