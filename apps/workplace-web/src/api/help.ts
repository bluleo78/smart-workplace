// WP-1509 도움말 검색 — 매뉴얼 절을 의미(임베딩)·단어로 찾는 API(GET /api/v1/help/search).
// 서버가 이 사용자에게 보이는 장(관리자 장은 관리자에게만)만 돌려준다.
import { client } from './client'

/** 검색 방식 — 질의 임베딩을 얻었으면 SEMANTIC, 임베더가 꺼졌거나 실패하면 단어 일치만 본 KEYWORD. */
export type HelpSearchMode = 'SEMANTIC' | 'KEYWORD'

/** 검색 결과 1건 — 매뉴얼 절 하나. 패널은 chapter·sectionId 로 그 절을 연다. */
export interface HelpSearchHit {
  chapter: string
  sectionId: string
  /** 짧은 이름(브레드크럼·목록에 쓰는 이름). 비었으면 title 을 쓴다. */
  label: string
  title: string
  /** 평문 본문 앞부분(서버가 160자에서 자른다). */
  snippet: string
}

export interface HelpSearchResponse {
  mode: HelpSearchMode
  results: HelpSearchHit[]
}

/** 질의 q 에 맞는 매뉴얼 절을 점수 순으로 받는다. signal 로 앞 요청을 끊는다(react-query 가 질의가 바뀌면 넘긴다). */
export async function searchHelp(q: string, signal?: AbortSignal): Promise<HelpSearchResponse> {
  const { data } = await client.get<HelpSearchResponse>('/help/search', { params: { q }, signal })
  return data
}
