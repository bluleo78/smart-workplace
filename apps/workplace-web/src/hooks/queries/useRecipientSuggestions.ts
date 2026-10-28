// 메일 받는사람 자동완성 후보(WP-945) — 최근 수신인(보낸 메일)과 연락처(구성원·주소록)를 함께 찾아 한 목록으로 합친다.
// 조직도 부서·내 그룹(WP-1060)도 같은 조각으로 찾아 따로 돌려준다 — 고르면 구성원 주소로 풀린다.
import { keepPreviousData, type QueryClient, useQueries, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { fetchRecentRecipients } from '../../api/mailMessages'
import { flattenGroupTree } from '../../components/members/groupOptions'
import { matchRecipientGroups, type RecipientGroupOption, type RecipientGroupSuggestion } from '../../lib/mailRecipientGroups'
import { mergeRecipientSuggestions, type RecipientSuggestion } from '../../lib/mailRecipientSuggest'
import type { UserGroupMemberHit } from '../../types/userGroup'
import { useDebounceValue } from '../useDebounceValue'
import { useContactsHead } from './useContacts'
import { groupAllMembersQuery } from './useGroupMemberSearch'
import { useUserGroups } from './useUserGroups'

/** 드롭다운에 보이는 후보 수 — 출처마다 이만큼 받아 합친 뒤 자른다. */
const SUGGESTION_LIMIT = 8

/**
 * 사람 후보 아래 보이는 부서·내 그룹 수 — 그룹마다 구성원(하위 포함)을 받아 인원 수를 세므로 적게 둔다.
 * 그룹 트리(/user-groups)에는 인원 수가 없고, 「· N명」을 주는 다른 응답(노트·드라이브 스페이스 부서 행)은 스페이스에 넣은 부서에만 있어
 * 이름이 맞는 그룹마다 구성원 찾기를 부른다. 조각이 바뀌어도 같은 그룹은 캐시(1분)를 다시 쓰고, 고를 때는 따로 새로 받는다.
 */
const GROUP_LIMIT = 4

/** 인원 수를 세려고 받아 둔 그룹 구성원을 다시 쓰는 시간 — 고를 때는 이 캐시를 쓰지 않고 새로 받는다(fetchRecipientGroupMembers). */
const GROUP_COUNT_STALE_MS = 60_000

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

  // 조직도 부서·내 그룹(WP-1060) — 트리(공유 조직도 + 내 개인 그룹만 온다)를 칸에 초점이 오면 한 번 받아 이름으로 거른다.
  // 트리를 못 받으면(권한·오류) 그룹 후보만 빠지고 사람 후보는 그대로다.
  const tree = useUserGroups(active)
  // 트리를 편 목록은 트리가 바뀔 때만 만든다 — 조각이 바뀔 때는 이름 거르기만 다시 한다.
  const groupOptions = useMemo<RecipientGroupOption[]>(
    () => [
      ...flattenGroupTree(tree.data?.shared ?? []).map((o) => ({ ...o, kind: 'department' as const })),
      ...flattenGroupTree(tree.data?.personal ?? []).map((o) => ({ ...o, kind: 'personal' as const })),
    ],
    [tree.data],
  )
  const matched = useMemo(() => matchRecipientGroups(groupOptions, q, GROUP_LIMIT), [groupOptions, q])
  // 찾은 그룹마다 하위 그룹까지 모은 지금 구성원 — 줄의 인원 수와 고를 때 풀 주소가 같은 조회·같은 규칙이다.
  // 공유 창·스페이스 멤버 창의 부서 펼침과 같은 조회·같은 캐시(빈 검색어 구성원 찾기)를 쓴다.
  // 실패는 자동으로 다시 시도하지 않는다 — 줄에 「불러오지 못했습니다」가 바로 보이게. 그 줄을 고르면 새로 받으며 다시 해 본다(fetchRecipientGroupMembers).
  // combine 결과는 바뀐 것이 없으면 같은 참조라 아래 groups·입력 칸의 후보 목록 memo 가 매 렌더 새로 만들어지지 않는다.
  const memberResults = useQueries({
    queries: matched.map((g) => ({
      ...groupAllMembersQuery(g.id),
      enabled: active,
      staleTime: GROUP_COUNT_STALE_MS,
      retry: false,
    })),
    combine: (results) => results.map((r) => ({ data: r.data, isError: r.isError })),
  })
  const groups = useMemo<RecipientGroupSuggestion[]>(
    () =>
      matched.map((g, i) => ({
        id: g.id,
        kind: g.kind,
        name: g.name,
        path: g.path,
        hasChildren: g.subtreeIds.length > 1,
        members: memberResults[i]?.data,
        failed: memberResults[i]?.isError ?? false,
      })),
    [matched, memberResults],
  )
  return { query: q, items, groups }
}

/**
 * 그룹을 고르는 순간의 구성원(WP-1060) — 줄의 인원 수용 캐시가 아니라 서버에서 새로 받는다(그사이 들고 난 사람이 맞게 풀리도록).
 * 받은 결과는 같은 키에 넣어 줄의 인원 수도 함께 새것이 된다. 실패하면 던진다(부르는 쪽이 오류 토스트를 띄운다).
 */
export function fetchRecipientGroupMembers(queryClient: QueryClient, groupId: number): Promise<UserGroupMemberHit[]> {
  return queryClient.fetchQuery({
    ...groupAllMembersQuery(groupId),
    staleTime: 0,
    retry: false,
  })
}
