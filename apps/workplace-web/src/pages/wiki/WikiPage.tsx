import { useParams } from 'react-router-dom'

import { WikiPageView } from '../../components/wiki/WikiPageView'

/** 위키 메인 — URL 의 spaceId/pageId 를 뷰로 전달. 사이드바는 모듈 레이아웃이 렌더. */
export function WikiPage() {
  const { spaceId: spaceIdParam, pageId: pageIdParam } = useParams()
  const spaceId = spaceIdParam ? Number(spaceIdParam) : 0
  const pageId = pageIdParam ? Number(pageIdParam) : null
  return <WikiPageView pageId={pageId} spaceId={spaceId} />
}
