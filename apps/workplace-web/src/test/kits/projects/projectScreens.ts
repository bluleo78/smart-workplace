// 프로젝트 화면 페이지 테스트(WP-980) 공용 MSW 핸들러 — 이슈 목록·상세 화면이 늘 부르는 조회를 한 곳에 둔다.
// 각 테스트는 보려는 응답(검색 결과·상세·쓰기)을 이 핸들러보다 앞에 두어 덮어쓴다(MSW 는 앞선 핸들러가 먼저 잡는다).
import { http, HttpResponse } from 'msw'

import type { IssueDetailResponse, IssueResponse } from '@/types/issue'
import type { ProjectResponse } from '@/types/project'

import { createIssueDetail, createIssueSearchResponse } from '../../../../e2e/factories/issue.factory'
import { createProject } from '../../../../e2e/factories/project.factory'

export const API = '/api/v1'

/** 쓰기 요청 기록 — 메서드·경로·본문(JSON, 없으면 null)·쿼리. */
export type Call = { method: string; path: string; body: unknown; search: URLSearchParams }

/** 요청을 Call 로 바꾼다(본문이 비면 null). */
export async function toCall(request: Request): Promise<Call> {
  const text = await request.text()
  const url = new URL(request.url)
  return { method: request.method, path: url.pathname, body: text ? JSON.parse(text) : null, search: url.searchParams }
}

/**
 * 프로젝트 화면(목록·보드·설정) 기본 조회 — 프로젝트 메타, 이슈 검색, 그룹 총계, 사용자 정의 필드.
 * search: 검색 GET 의 응답을 정한다(기본 빈 목록). 받은 URL 은 searches 에 쌓아 쿼리 파라미터를 단언한다.
 */
export function projectScreen(
  key = 'WP',
  {
    project = createProject({ key }),
    search = () => [] as IssueResponse[],
  }: { project?: ProjectResponse; search?: (url: URL) => IssueResponse[] | ReturnType<typeof createIssueSearchResponse> } = {},
) {
  const searches: URL[] = []
  const handlers = [
    http.get(`${API}/projects/${key}`, () => HttpResponse.json(project)),
    http.get(`${API}/projects/${key}/issues`, ({ request }) => {
      const url = new URL(request.url)
      searches.push(url)
      const r = search(url)
      return HttpResponse.json(Array.isArray(r) ? createIssueSearchResponse(r, null) : r)
    }),
    http.get(`${API}/projects/${key}/issues/group-counts`, ({ request }) =>
      HttpResponse.json({ groupBy: new URL(request.url).searchParams.get('groupBy'), groups: [] }),
    ),
    http.get(`${API}/projects/${key}/fields`, () => HttpResponse.json([])),
    http.get(`${API}/projects/${key}/views`, () => HttpResponse.json([])),
  ]
  /** 이슈 본문 목록 검색(에픽 패널 조회 제외)의 마지막 URL. */
  const lastBodySearch = (epicTypeId?: number) =>
    [...searches].reverse().find((u) => epicTypeId == null || u.searchParams.get('type') !== String(epicTypeId))
  return { handlers, searches, lastBodySearch }
}

/**
 * 이슈 상세 화면 조회 — 상세(가변 getter)와 상세가 함께 부르는 부가 조회(watchers·labels·attachments·children 등).
 * 하위 목록 검색(parent=n)은 projectScreen 의 검색이 맡는다.
 */
export function issueDetailScreen(key: string, number: number, detail: () => IssueDetailResponse = () => createIssueDetail()) {
  const base = `${API}/projects/${key}/issues/${number}`
  return [
    http.get(base, () => HttpResponse.json(detail())),
    ...['watchers', 'labels', 'attachments', 'children', 'drive-links', 'relations', 'dependencies', 'cycles', 'links', 'mail-links'].map((sub) =>
      http.get(`${base}/${sub}`, () => HttpResponse.json([])),
    ),
  ]
}

/** Radix Select 는 포인터 캡처·scrollIntoView 를 부른다 — jsdom 미구현이라 빈 구현으로 보강한다(beforeAll 에서 부른다). */
export function polyfillRadixSelect() {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => {}
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
}
