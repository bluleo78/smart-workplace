import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { wikiApi } from '../../api/wiki'
import type { WikiPageDetail, WikiProjectSpace } from '../../types/wiki'
import { wikiKeys } from './wikiKeys'

/**
 * 프로젝트의 노트 공간 요약(WP-1480) — 프로젝트 설정의 「노트 공간」 영역이 지금 연결된 공간 이름을 보인다.
 * 서버는 공간 멤버(= 프로젝트 멤버)가 아니거나 공간이 없으면 404 를 준다 — 404 는 다시 시도하지 않는다(기본 재시도 정책).
 */
export function useWikiProjectSpace(projectKey: string, options?: { enabled?: boolean }) {
  return useQuery<WikiProjectSpace>({
    queryKey: wikiKeys.projectSpace(projectKey),
    queryFn: () => wikiApi.getProjectSpace(projectKey).then((r) => r.data),
    enabled: (options?.enabled ?? true) && projectKey !== '',
  })
}

/**
 * 기존 팀 공간을 프로젝트 노트 공간으로 연결(WP-1480) — 성공하면 그 프로젝트 공간 요약과 공간 목록을 다시 받는다
 * (자동 공간이 지워지거나 일반 팀 공간이 되고, 고른 공간이 프로젝트 공간으로 바뀌어 선택 상자 묶음이 달라진다).
 */
export function useLinkWikiProjectSpace(projectKey: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (spaceId: number) => wikiApi.linkProjectSpace(projectKey, spaceId).then((r) => r.data),
    onSuccess: (data) => {
      // 연결 전 공간(자동 공간) id — 「리포트」 페이지가 여기서 고른 공간으로 옮겨진다. 덮어쓰기 전에 읽어 둔다.
      const previousId = qc.getQueryData<WikiProjectSpace>(wikiKeys.projectSpace(projectKey))?.id
      qc.setQueryData(wikiKeys.projectSpace(projectKey), data)
      // 옮겨진 페이지의 캐시된 상세는 spaceId 가 옛 공간이라, 남겨 두면 노트를 열 때 옛 공간 주소로 튀었다가 돌아온다(WP-988 과 같은 문제).
      // 어떤 페이지가 옮겨졌는지 응답이 알려 주지 않으므로 옛 공간에 속한 상세 캐시를 지워 다음에 열 때 새로 받게 한다.
      // 옛 공간을 모르면(요약을 받기 전) 어느 공간 페이지가 옮겨졌는지 알 수 없어 페이지 상세를 모두 무효화한다.
      if (previousId === undefined) {
        void qc.invalidateQueries({ queryKey: ['wiki', 'page'] })
      } else if (previousId !== data.id) {
        qc.removeQueries({
          queryKey: ['wiki', 'page'],
          predicate: (q) => (q.state.data as Pick<WikiPageDetail, 'spaceId'> | undefined)?.spaceId === previousId,
        })
      }
      // 요약은 응답으로 바로 바꾸고, 서버 상태와 맞추려 한 번 더 받는다.
      void qc.invalidateQueries({ queryKey: wikiKeys.projectSpace(projectKey) })
      void qc.invalidateQueries({ queryKey: wikiKeys.spaces() })
      // 고른 공간의 멤버가 프로젝트 멤버로 맞춰진다(멤버 아닌 사람 제외) — 그 공간의 멤버·부서 멤버 목록을 다시 받는다.
      void qc.invalidateQueries({ queryKey: wikiKeys.members(data.id) })
      void qc.invalidateQueries({ queryKey: wikiKeys.memberGroups(data.id) })
      // 「리포트」 페이지가 고른 공간 트리로 옮겨진다 — 공간 트리 캐시를 모두 다시 받게 한다(tree(id) 공통 접두).
      void qc.invalidateQueries({ queryKey: ['wiki', 'tree'] })
    },
  })
}
