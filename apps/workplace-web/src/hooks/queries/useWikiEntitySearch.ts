// 위키 @ 멘션 통합 검색 — 유저·위키페이지·이슈를 한 쿼리로 병합한다.
// 세 백엔드 엔드포인트를 병렬 호출(Promise.all) 후 타입별 상위 N개씩 합쳐 후보 리스트를 만든다.
// 응답 봉투가 셋 다 달라(유저=PageResponse.content, 페이지=배열, 이슈=items) 여기서 정규화한다.

import { useQuery } from '@tanstack/react-query'

import { fetchMeIssues } from '../../api/meIssues'
import { usersApi } from '../../api/users'
import { wikiApi } from '../../api/wiki'
import type { WikiMentionType } from '../../types/wiki'

// 멘션 피커 한 행 — mtype/id 가 삽입될 노드 attrs 의 원천, label/sublabel 은 표시용.
export interface WikiEntityCandidate {
  mtype: WikiMentionType
  id: number
  label: string
  sublabel?: string
}

// 타입별 최대 후보 수 — 셋을 합쳐도 메뉴가 너무 길지 않게 제한.
const PER_TYPE = 5

export const wikiEntitySearchKeys = {
  search: (query: string, spaceId: number) =>
    ['wiki', 'entity-search', spaceId, query] as const,
}

/**
 * @ 멘션 통합 검색 훅. query 가 비면 비활성(빈 결과). spaceId 는 위키 검색의 우선 스페이스.
 * 세 소스를 병렬 호출하되, 한 소스가 실패해도 나머지는 보이도록 개별 catch 로 빈 배열 폴백한다.
 */
export function useWikiEntitySearch(query: string, spaceId: number) {
  const trimmed = query.trim()
  return useQuery<WikiEntityCandidate[]>({
    queryKey: wikiEntitySearchKeys.search(trimmed, spaceId),
    queryFn: async () => {
      // 유저: PageResponse.content. 검색 실패는 빈 배열로 흡수(다른 타입은 계속 노출).
      const usersP = usersApi
        .getUsers({ search: trimmed, size: PER_TYPE })
        .then((r) => r.data.content)
        .catch(() => [])
      // 위키 페이지: WikiSearchResult[]. 스페이스 제한 없이(멤버 스페이스 전체) 검색하고,
      // 아래에서 현재 spaceId 를 앞으로 정렬해 "현재 스페이스 우선"을 만든다(크로스-스페이스 멘션 허용).
      const pagesP = wikiApi
        .search(trimmed)
        .then((r) => r.data)
        .catch(() => [])
      // 이슈: /me/issues?q= 횡단 검색 → IssueSearchResponse.items.
      const issuesP = fetchMeIssues({ q: trimmed }, null, PER_TYPE)
        .then((r) => r.items)
        .catch(() => [])

      const [users, pages, issues] = await Promise.all([usersP, pagesP, issuesP])

      const candidates: WikiEntityCandidate[] = []
      // USER — label=name(없으면 username), sublabel=@username.
      for (const u of users.slice(0, PER_TYPE)) {
        candidates.push({
          mtype: 'USER',
          id: u.id,
          label: u.name || u.username,
          sublabel: `@${u.username}`,
        })
      }
      // PAGE — 현재 spaceId 를 앞으로 안정 정렬(우선) 후 상위 N. label=title, sublabel=스페이스명.
      const rankedPages = [...pages].sort(
        (a, b) => Number(b.spaceId === spaceId) - Number(a.spaceId === spaceId),
      )
      for (const p of rankedPages.slice(0, PER_TYPE)) {
        candidates.push({ mtype: 'PAGE', id: p.id, label: p.title, sublabel: p.spaceName })
      }
      // ISSUE — label=title, sublabel={projectKey}-{number}.
      for (const i of issues.slice(0, PER_TYPE)) {
        candidates.push({
          mtype: 'ISSUE',
          id: i.id,
          label: i.title,
          sublabel: `${i.projectKey}-${i.number}`,
        })
      }
      return candidates
    },
    // query 비면 호출 안 함 — 빈 메뉴.
    enabled: trimmed.length >= 1,
    // 연속 타이핑 중 동일 query 재요청 억제(useUserSearch 패턴).
    staleTime: 30_000,
  })
}
