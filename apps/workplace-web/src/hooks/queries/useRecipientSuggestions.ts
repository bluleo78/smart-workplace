// 메일 받는사람 자동완성 후보(WP-945) — 최근 수신인(보낸 메일)과 연락처(구성원·주소록)를 함께 찾아 한 목록으로 합친다.
// 조직도 부서·내 그룹(WP-1060)도 같은 조각으로 찾아 따로 돌려준다 — 고르면 구성원 주소로 풀린다.
import { keepPreviousData, type QueryClient, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { fetchRecentRecipients } from '../../api/mailMessages'
import { userGroupsApi } from '../../api/userGroups'
import { flattenGroupTree } from '../../components/members/groupOptions'
import { matchRecipientGroups, type RecipientGroupOption, type RecipientGroupSuggestion } from '../../lib/mailRecipientGroups'
import { mergeRecipientSuggestions, type RecipientSuggestion } from '../../lib/mailRecipientSuggest'
import type { UserGroupMemberHit } from '../../types/userGroup'
import { useDebounceValue } from '../useDebounceValue'
import { useContactsHead } from './useContacts'
import { groupAllMembersQuery } from './useGroupMemberSearch'
import { userGroupKeys } from './userGroupKeys'
import { useUserGroups } from './useUserGroups'

/** 드롭다운에 보이는 후보 수 — 출처마다 이만큼 받아 합친 뒤 자른다. */
const SUGGESTION_LIMIT = 8

/** 사람 후보 아래 보이는 부서·내 그룹 수 — 사람 후보를 밀어내지 않게 적게 둔다. */
const GROUP_LIMIT = 4

/** 그룹 인원 수를 다시 쓰는 시간 — 고를 때는 수와 상관없이 구성원을 새로 받는다(fetchRecipientGroupMembers). */
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
  // 찾은 그룹들의 하위 조직 포함 인원 수 — 그룹마다 구성원 전체를 받지 않고 한 번에 수만 받는다(WP-1135). 서버가 고를 때 쓰는 구성원 찾기와
  // 같은 규칙(같은 사람 한 번, 주소 없는 사람 포함)으로 세어, 줄의 「N명」이 고른 뒤 넣은 수·뺀 수·주소 없는 수의 합과 같다.
  // 같은 그룹 묶음은 캐시(1분)를 다시 쓴다. 실패는 자동으로 다시 시도하지 않는다 — 줄에 「불러오지 못했습니다」가 바로 보이게(고르면 구성원을 새로 받아 다시 해 본다).
  const countIds = useMemo(() => matched.map((g) => g.id).sort((a, b) => a - b), [matched])
  const counts = useQuery({
    queryKey: userGroupKeys.memberCounts(countIds),
    queryFn: () => userGroupsApi.countMembers(countIds).then((r) => r.data),
    enabled: active && countIds.length > 0,
    staleTime: GROUP_COUNT_STALE_MS,
    retry: false,
  })
  const groups = useMemo<RecipientGroupSuggestion[]>(() => {
    const byId = new Map((counts.data ?? []).map((c) => [c.groupId, c]))
    return matched.map((g) => {
      const c = byId.get(g.id)
      return {
        id: g.id,
        kind: g.kind,
        name: g.name,
        path: g.path,
        hasChildren: g.subtreeIds.length > 1,
        count: c ? { total: c.total, external: c.external } : undefined,
        failed: counts.isError,
      }
    })
  }, [matched, counts.data, counts.isError])
  return { query: q, items, groups }
}

/**
 * 그룹을 고르는 순간의 구성원(WP-1060) — 서버에서 새로 받는다(그사이 들고 난 사람이 맞게 풀리도록). 받은 결과는 공유 창의 부서 펼침과 같은 키에 둔다.
 * 실패하면 던진다(부르는 쪽이 오류 토스트를 띄운다).
 */
export function fetchRecipientGroupMembers(queryClient: QueryClient, groupId: number): Promise<UserGroupMemberHit[]> {
  return queryClient.fetchQuery({
    ...groupAllMembersQuery(groupId),
    staleTime: 0,
    retry: false,
  })
}
