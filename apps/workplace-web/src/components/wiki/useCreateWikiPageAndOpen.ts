import { useNavigate } from 'react-router-dom'

import { useCreatePage } from '../../hooks/queries/useWikiMutations'

/**
 * 빈 페이지를 만들고 바로 연다 — 사이드바 ＋(루트·하위), 데스크톱 본문 빈 상태, 모바일 빈 목록(WP-179)이 공유.
 * withAiDraft=true 면 라우터 state 로 표식을 넘겨, WikiEditor 가 마운트 직후 AI 초안 토픽 입력을 띄운다
 * (#733 — 초안 작성이 가장 유효한 순간이 새 페이지다).
 */
export function useCreateWikiPageAndOpen(spaceId: number | null) {
  const createPage = useCreatePage(spaceId ?? 0)
  const navigate = useNavigate()
  const create = async (parentId: number | null, withAiDraft = false) => {
    if (spaceId == null) return
    // 실제 저장값은 빈 문자열 — "제목 없음"은 표시용 폴백일 뿐 초기 상태 값이 아니다.
    const created = await createPage.mutateAsync({ parentId, title: '' })
    navigate(`/wiki/spaces/${spaceId}/pages/${created.id}`, {
      state: withAiDraft ? { wikiAiDraft: true } : undefined,
    })
  }
  return { create, isPending: createPage.isPending }
}
