import { useNavigate, useParams } from 'react-router-dom'

import { parseId } from '@/lib/historyParam'

import { WikiPageUnavailableState, WikiPageView } from '../../components/wiki/WikiPageView'
import { WikiSpaceUnavailableState } from '../../components/wiki/WikiSpaceUnavailableState'

/** 위키 메인 — URL 의 spaceId/pageId 를 뷰로 전달. 사이드바는 모듈 레이아웃이 렌더. */
export function WikiPage() {
  const navigate = useNavigate()
  const { spaceId: spaceIdParam, pageId: pageIdParam } = useParams()
  const spaceId = parseId(spaceIdParam ?? null)
  const pageId = parseId(pageIdParam ?? null)
  // 주소의 번호가 양의 정수가 아니면(깨진 링크·직접 입력) 없는 공간·페이지와 같은 안내만 둔다(WP-612) —
  // NaN 을 넘기면 NaN !== NaN 이라 뷰의 렌더 중 상태 갱신이 끝없이 돌아 화면 오류가 났다.
  if (spaceId == null) return <WikiSpaceUnavailableState onBack={() => navigate('/wiki')} />
  if (pageIdParam != null && pageId == null) return <WikiPageUnavailableState onBack={() => navigate('/wiki')} />
  return <WikiPageView pageId={pageId} spaceId={spaceId} />
}
