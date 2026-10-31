import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { wikiApi } from '../../api/wiki'
import { useCreatePage } from '../../hooks/queries/useWikiMutations'
import { convertHtmlToWiki, htmlFileBaseName } from './wikiHtmlImport'
import { htmlImportNotice, readHtmlFile } from './wikiHtmlImportInsert'

/** 노트 제목 최대 길이 — 서버 CreatePageRequest 의 @Size(max = 255). <title> 이 더 길면 잘라 400 을 피한다. */
const TITLE_MAX = 255

/**
 * 빈 페이지를 만들고 바로 연다 — 사이드바 ＋(루트·하위), 데스크톱 본문 빈 상태, 모바일 빈 목록(WP-179)이 공유.
 * withAiDraft=true 면 라우터 state 로 표식을 넘겨, WikiEditor 가 마운트 직후 AI 초안 토픽 입력을 띄운다
 * (#733 — 초안 작성이 가장 유효한 순간이 새 페이지다).
 *
 * createFromHtml(WP-1241) — HTML 파일을 노트로 바꿔 새 페이지로 만든다. 제목은 변환 제목(<title>·첫 h1), 없으면 파일 이름.
 * 본문은 만든 직후 그 응답 version 으로 심는다(wikiApi.seedPageBody — AI 쓰기와 같은 서버 경로라 동기화 문서에 바로 들어간다). 그래서
 * 페이지를 열면 본문이 이미 동기화돼 있다. 심기가 실패해도 페이지는 있으므로 알리고 그대로 연다(제목만 있는 노트).
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
  const createFromHtml = async (parentId: number | null, file: File) => {
    if (spaceId == null) return
    const html = await readHtmlFile(file)
    if (html == null) return
    const result = convertHtmlToWiki(html, { stripTitleHeading: true })
    const title = (result.title ?? htmlFileBaseName(file.name)).slice(0, TITLE_MAX)
    // 만들기 실패는 useCreatePage 의 onError 가 알린다 — 여기서는 멈추기만 한다.
    const created = await createPage.mutateAsync({ parentId, title }).catch(() => null)
    if (!created) return
    if (result.markdown.trim()) {
      try {
        await wikiApi.seedPageBody(created.id, result.markdown, created.version)
        const notice = htmlImportNotice(result)
        if (notice) toast.warning(notice)
      } catch {
        toast.error('HTML 파일 내용을 넣지 못했습니다 — 제목만 있는 노트를 열었습니다.')
      }
    }
    navigate(`/wiki/spaces/${spaceId}/pages/${created.id}`)
  }
  return { create, createFromHtml, isPending: createPage.isPending }
}
