import { useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'

import {
  clearWikiLastVisited,
  isWikiPageGone,
  readWikiLastVisited,
} from '../lib/wikiLastVisited'
import { useWikiPage } from './queries/useWikiPage'
import { useWikiSpaces } from './queries/useWikiSpaces'
import { useWikiLastSpaceKey, useWikiLastVisitedKey } from './useWikiLastVisitedKey'

/**
 * /wiki 진입 시 열 곳을 정해 replace 이동한다 — 데스크톱 본문(WikiIndexRedirect)과 모바일 목록(WikiModuleLayout)이 공유.
 * 1) (target='space' 만) 마지막으로 고른 공간이 아직 목록에 있으면 그 공간 목록으로(WP-180). 없어졌으면 기록을 지운다.
 * 2) 마지막으로 본 노트 기록이 있으면 서버에서 다시 조회해 열 수 있을 때 그곳으로 복원.
 * 3) 기록이 없거나 삭제(404)·권한 상실(403)이면 기록을 지우고 첫 스페이스(개인 위키)로 이동.
 * 4) 스페이스가 0개면 이동하지 않는다(호출부가 빈 상태를 그림).
 * target: 'page' 는 그 페이지를 연다(데스크톱). 'space' 는 스페이스 목록을 연다(모바일 — 앱은 목록에서 시작, WP-178).
 */
export function useWikiIndexRedirect(target: 'page' | 'space') {
  const { data: spaces, isLoading } = useWikiSpaces()
  const navigate = useNavigate()
  const lastVisitedKey = useWikiLastVisitedKey()
  const lastSpaceKey = useWikiLastSpaceKey()
  const storedSpaceId = useMemo(
    () => (target === 'space' && lastSpaceKey ? readWikiLastVisited(lastSpaceKey) : null),
    [target, lastSpaceKey],
  )
  // 공간 기록이 있으면 페이지 기록은 보지 않는다(조회 생략) — 공간 기록이 더 최근 선택을 반영한다.
  const storedPageId = useMemo(
    () => (storedSpaceId == null && lastVisitedKey ? readWikiLastVisited(lastVisitedKey) : null),
    [storedSpaceId, lastVisitedKey],
  )
  // 기록이 없으면 비활성(조회 안 함). 캐시 데이터가 있어도 staleTime 0 이라 마운트 시 재조회하므로
  // isFetching 동안은 판정을 미뤄, 그 사이 삭제된 페이지로 잘못 복원하지 않는다.
  const lastPage = useWikiPage(storedPageId)
  const restorePending = storedPageId != null && lastPage.isFetching

  useEffect(() => {
    if (restorePending) return
    if (storedSpaceId != null) {
      if (!spaces) return
      // 접근 가능 여부는 공간 목록 기준 — 삭제·권한 상실로 사라졌으면 기록을 지우고 첫 공간으로.
      if (spaces.some((s) => s.id === storedSpaceId)) {
        navigate(`/wiki/spaces/${storedSpaceId}`, { replace: true })
        return
      }
      if (lastSpaceKey) clearWikiLastVisited(lastSpaceKey)
    }
    if (storedPageId != null && !lastPage.isError && lastPage.data) {
      // 스페이스는 저장값이 아니라 조회 응답 기준 — 페이지가 다른 스페이스로 옮겨졌어도 정확히 연다.
      const { spaceId, id } = lastPage.data
      navigate(target === 'page' ? `/wiki/spaces/${spaceId}/pages/${id}` : `/wiki/spaces/${spaceId}`, { replace: true })
      return
    }
    // 삭제·권한 상실만 기록 정리. 5xx·네트워크 오류는 일시적이므로 다음 진입에 다시 시도한다.
    if (lastVisitedKey && lastPage.isError && isWikiPageGone(lastPage.error)) {
      clearWikiLastVisited(lastVisitedKey)
    }
    if (spaces && spaces.length > 0) {
      navigate(`/wiki/spaces/${spaces[0].id}`, { replace: true })
    }
  }, [target, restorePending, storedSpaceId, lastSpaceKey, storedPageId, lastPage.isError, lastPage.error, lastPage.data, lastVisitedKey, spaces, navigate])

  return { spaces, isLoading, restorePending }
}
