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

/** 도움말 측정 종류(WP-1512) — 열림·검색 0건·AI 가 매뉴얼에서 못 찾은 질문. */
export type HelpMetricKind = 'OPEN' | 'SEARCH_MISS' | 'AI_GAP'

/** 측정 집계 한 줄 — 종류에 따라 route·helpId·term 중 일부는 빈 문자열이다. */
export interface HelpMetricRow {
  route: string
  helpId: string
  term: string
  count: number
  lastAt: string
}

export interface HelpMetricsResponse {
  kind: HelpMetricKind
  days: number
  items: HelpMetricRow[]
}

/** 도움말을 연 것을 기록한다 — 쏘고 잊는다(실패는 삼킨다: 측정이 사용자 화면을 깨거나 알림을 띄우면 안 된다). */
export function recordHelpOpen(body: { route: string; helpId: string | null }): void {
  client.post('/help/metrics/open', body).catch(() => {})
}

/** 검색 0건 질의를 기록한다 — recordHelpOpen 과 같이 쏘고 잊는다. */
export function recordHelpSearchMiss(body: { query: string; route: string; helpId: string | null }): void {
  client.post('/help/metrics/search-miss', body).catch(() => {})
}

/** 측정 조회 기간(일) — 서버가 받는 값과 같다. */
export type HelpMetricDays = 7 | 30 | 90

/** 최근 days 일 측정 집계(관리자 조회). */
export async function getHelpMetrics(kind: HelpMetricKind, days: HelpMetricDays): Promise<HelpMetricsResponse> {
  const { data } = await client.get<HelpMetricsResponse>('/help/metrics', { params: { kind, days } })
  return data
}
