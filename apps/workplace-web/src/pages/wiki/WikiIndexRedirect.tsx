import { useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'

import { useWikiCreateSpaceDialog } from '@/components/wiki/useWikiCreateSpaceDialog'
import { WikiNoSpaces } from '@/components/wiki/WikiNoSpaces'

import { useWikiPage } from '../../hooks/queries/useWikiPage'
import { useWikiSpaces } from '../../hooks/queries/useWikiSpaces'
import { useWikiLastVisitedKey } from '../../hooks/useWikiLastVisitedKey'
import {
  clearWikiLastVisited,
  isWikiPageGone,
  readWikiLastVisited,
} from '../../lib/wikiLastVisited'

/**
 * /wiki 진입 처리 — 앱 레일·홈 위젯 등 노트 앱의 모든 진입점이 거친다.
 * 1) 마지막으로 본 노트 기록이 있으면 서버에서 다시 조회해 열 수 있을 때 그 페이지로 복원.
 * 2) 기록이 없거나 삭제(404)·권한 상실(403)이면 기록을 지우고 첫 스페이스(개인 위키)로 이동.
 * 3) 스페이스가 하나도 없으면 빈 상태 + [공간 만들기] — 이동할 곳이 없어 "준비 중…"에 멈추던 문제(WP-143).
 */
export function WikiIndexRedirect() {
  const { data: spaces, isLoading } = useWikiSpaces()
  const navigate = useNavigate()
  // 공간 0개 빈 상태의 [공간 만들기] — 생성 후 새 스페이스로 이동한다.
  const { openCreateSpace, dialog: createSpaceDialog } = useWikiCreateSpaceDialog()
  const lastVisitedKey = useWikiLastVisitedKey()
  const storedPageId = useMemo(
    () => (lastVisitedKey ? readWikiLastVisited(lastVisitedKey) : null),
    [lastVisitedKey],
  )
  // 기록이 없으면 비활성(조회 안 함). 캐시 데이터가 있어도 staleTime 0 이라 마운트 시 재조회하므로
  // isFetching 동안은 판정을 미뤄, 그 사이 삭제된 페이지로 잘못 복원하지 않는다.
  const lastPage = useWikiPage(storedPageId)
  const restorePending = storedPageId != null && lastPage.isFetching

  useEffect(() => {
    if (restorePending) return
    if (storedPageId != null && !lastPage.isError && lastPage.data) {
      // 스페이스는 저장값이 아니라 조회 응답 기준 — 페이지가 다른 스페이스로 옮겨졌어도 정확히 연다.
      navigate(`/wiki/spaces/${lastPage.data.spaceId}/pages/${lastPage.data.id}`, { replace: true })
      return
    }
    // 삭제·권한 상실만 기록 정리. 5xx·네트워크 오류는 일시적이므로 다음 진입에 다시 시도한다.
    if (lastVisitedKey && lastPage.isError && isWikiPageGone(lastPage.error)) {
      clearWikiLastVisited(lastVisitedKey)
    }
    if (spaces && spaces.length > 0) {
      navigate(`/wiki/spaces/${spaces[0].id}`, { replace: true })
    }
  }, [restorePending, storedPageId, lastPage.isError, lastPage.error, lastPage.data, lastVisitedKey, spaces, navigate])

  if (isLoading || restorePending) return <div className="p-6 text-sm text-muted-foreground">불러오는 중…</div>
  if (spaces?.length === 0) {
    return (
      <>
        <WikiNoSpaces className="h-full" onCreate={openCreateSpace} />
        {createSpaceDialog}
      </>
    )
  }
  return <div className="p-6 text-sm text-muted-foreground">노트 공간을 준비 중…</div>
}
