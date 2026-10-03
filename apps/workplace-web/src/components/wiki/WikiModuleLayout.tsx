import { useEffect, useMemo } from 'react'
import { useLocation, useParams } from 'react-router-dom'

import { useRegisterAiScreenContext } from '@/components/ai/screen-context/useAiScreenContext'
import { ResponsiveModuleLayout } from '@/components/mobile/ResponsiveModuleLayout'
import { mobileWikiListClass } from '@/components/mobile/sidebarListClass'
import { useWikiSpaces } from '@/hooks/queries/useWikiSpaces'
import { useWikiTree } from '@/hooks/queries/useWikiTree'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useWikiIndexRedirect } from '@/hooks/useWikiIndexRedirect'
import { useWikiLastSpaceKey } from '@/hooks/useWikiLastVisitedKey'
import { buildWikiSpaceListContext } from '@/lib/aiScreenContext/builders/mobileLists'
import { norm } from '@/lib/mobile/routes'
import { MOBILE_TABS } from '@/lib/mobile/tabs'
import { writeWikiLastVisited } from '@/lib/wikiLastVisited'

import { WikiSidebar } from './WikiSidebar'

/**
 * 위키 모듈 레이아웃 — 좌측 스페이스/페이지 트리 + Outlet(에디터/뷰).
 * 모바일 목록 모드는 채팅 목록 규격에 머리말 여백·글자를 맞춘다(U3-R5, 데스크톱엔 쓰이지 않음).
 * 모바일(WP-178): /wiki/spaces/:id 도 목록(페이지 트리)이다(경로 표 isTabRoot). 사이드바는 공간을 URL 로만 알므로
 * 공간이 없는 /wiki 에선 데스크톱과 같은 규칙으로 고른 공간의 목록으로 보낸다
 * (데스크톱 WikiIndexRedirect 는 Outlet 에 있어 모바일 목록 모드에선 그려지지 않는다).
 */
export function WikiModuleLayout() {
  const isMobile = useIsMobile()
  const { pathname } = useLocation()
  useRecordLastSpace()
  return (
    <>
      <ResponsiveModuleLayout sidebar={<WikiSidebar />} rootPath={MOBILE_TABS.wiki.path} title="노트" listClassName={mobileWikiListClass} listContext={<WikiListScreenContext />} />
      {isMobile && norm(pathname) === MOBILE_TABS.wiki.path && <MobileWikiIndexRedirect />}
    </>
  )
}

/**
 * WP-191: 모바일 공간 페이지 목록(/wiki/spaces/:id)의 화면 컨텍스트 등록기 — 공간이 없는 /wiki 는 리다이렉트되므로 null(미등록).
 * 모바일 목록 분기에서만 마운트되어, 데스크톱·상세에선 공간·트리 쿼리를 구독하지 않는다.
 */
function WikiListScreenContext() {
  const { spaceId: sp } = useParams()
  const spaceId = sp ? Number(sp) : null
  const { data: spaces } = useWikiSpaces()
  const { data: pages } = useWikiTree(spaceId)
  const ctx = useMemo(
    () => (spaceId == null || !Number.isInteger(spaceId) ? null : buildWikiSpaceListContext({
      spaceId,
      spaceName: spaces?.find((s) => s.id === spaceId)?.name ?? null,
      pageCount: pages ? pages.length : null,
    })),
    [spaceId, spaces, pages],
  )
  useRegisterAiScreenContext(ctx)
  return null
}

/** 모바일 /wiki 진입 시에만 마운트 — 마지막 본 페이지의 공간(없으면 첫 공간) 목록으로 이동. 그리는 것은 없다. */
function MobileWikiIndexRedirect() {
  useWikiIndexRedirect('space')
  return null
}

/**
 * 보고 있는 공간(공간 목록·그 안의 페이지)을 "마지막으로 고른 공간"으로 기록 — 모바일 /wiki 진입이 이 공간 목록에서 이어진다(WP-180).
 * 레이아웃에서 기록하는 이유: 모바일 페이지 상세는 사이드바를 그리지 않아, 링크로 바로 연 페이지의 공간도 남기려면 여기여야 한다.
 * 접근 가능 여부는 읽을 때 공간 목록으로 확인한다(useWikiIndexRedirect — 없어진 공간이면 기록을 지움).
 */
function useRecordLastSpace() {
  const { spaceId } = useParams()
  const lastSpaceKey = useWikiLastSpaceKey()
  useEffect(() => {
    const id = Number(spaceId)
    if (lastSpaceKey && Number.isInteger(id) && id > 0) writeWikiLastVisited(lastSpaceKey, id)
  }, [lastSpaceKey, spaceId])
}
