// 「채팅·이슈로 보내기」 대상 검색(WP-1235) — 내 채널·구성원(DM)·이슈를 한 검색어로 찾는다.
// 서버에 통합 검색이 없어 이미 있는 조회 셋을 나눠 부른다: 채널은 내 채널 목록(사이드바와 같은 캐시)을 화면에서 거르고,
// 사람은 구성원 디렉터리(/members), 이슈는 프로젝트 횡단 검색(/me/issues?q=, 제목·본문)과 키 바로 열기(WP-12)를 함께 쓴다.
import { useQuery } from '@tanstack/react-query'

import { issuesApi } from '../../api/issues'
import { fetchMeIssues } from '../../api/meIssues'
import { parseIssueKeyQuery, type SendDestination } from '../../lib/sendToChat'
import { useMembers } from './useMembers'
import { useMyChannels } from './useMyChannels'

/** 종류별 최대 후보 수 — 셋을 합쳐도 목록이 너무 길지 않게. 검색어가 없을 때 채널은 조금 더 보인다. */
const PER_KIND = 5
const CHANNELS_WITHOUT_QUERY = 8

export interface SendDestinationResults {
  channels: SendDestination[]
  people: SendDestination[]
  issues: SendDestination[]
  /** 사람·이슈 검색이 아직 오는 중인가 — 「찾는 중…」 표시. */
  loading: boolean
}

/**
 * 검색어(디바운스한 값)로 보낼 곳 후보를 찾는다. 검색어가 없으면 채널만 보인다(사람·이슈는 검색해야 나온다 — 첫 화면은 최근 대상과 채널).
 * 한 소스가 실패해도 나머지는 보이도록 각 소스를 따로 둔다.
 */
export function useSendDestinationSearch(query: string): SendDestinationResults {
  const q = query.trim()
  const hasQuery = q.length > 0

  const channelsQuery = useMyChannels()
  const needle = q.toLowerCase()
  // 보관된 채널에는 글을 쓸 수 없어 뺀다. 이름 부분 일치(대소문자 무시).
  const channels: SendDestination[] = (channelsQuery.data ?? [])
    .filter((c) => !c.archived && (!hasQuery || c.name.toLowerCase().includes(needle)))
    .slice(0, hasQuery ? PER_KIND : CHANNELS_WITHOUT_QUERY)
    .map((c) => ({ kind: 'channel', channelId: c.id, name: c.name }))

  // 사람 — AI 구성원에게도 DM 을 보낼 수 있으므로 ALL. 정지된 구성원은 디렉터리가 기본으로 뺀다.
  const membersQuery = useMembers({ search: q, kind: 'ALL', size: PER_KIND }, { enabled: hasQuery })
  const people: SendDestination[] = hasQuery
    ? (membersQuery.data?.content ?? []).map((m) => ({ kind: 'person', userId: m.userId, name: m.name || m.username }))
    : []

  // 이슈 — 제목·본문 검색. 키처럼 생긴 검색어는 그 이슈를 바로 연다(제목 검색으로는 키가 걸리지 않는다).
  const issueSearch = useQuery({
    queryKey: ['send-to-chat', 'issues', q],
    queryFn: () => fetchMeIssues({ q }, null, PER_KIND).then((r) => r.items),
    enabled: hasQuery,
    staleTime: 30_000,
  })
  const keyQuery = parseIssueKeyQuery(q)
  const issueByKey = useQuery({
    queryKey: ['send-to-chat', 'issue-key', keyQuery?.projectKey, keyQuery?.number],
    queryFn: () => issuesApi.get(keyQuery!.projectKey, keyQuery!.number).then((r) => r.data.summary),
    enabled: keyQuery != null,
    // 없는 키·권한 없는 이슈(404·403)는 후보가 없을 뿐이다 — 다시 묻지 않는다.
    retry: false,
    staleTime: 30_000,
  })
  const issueRows = [...(keyQuery && issueByKey.data ? [issueByKey.data] : []), ...(issueSearch.data ?? [])]
  const seen = new Set<number>()
  const issues: SendDestination[] = []
  for (const i of issueRows) {
    if (seen.has(i.id)) continue
    seen.add(i.id)
    issues.push({ kind: 'issue', issueId: i.id, projectKey: i.projectKey, number: i.number, title: i.title })
  }

  return {
    channels,
    people,
    issues: issues.slice(0, PER_KIND),
    loading: hasQuery && (membersQuery.isLoading || issueSearch.isLoading || (keyQuery != null && issueByKey.isLoading)),
  }
}
