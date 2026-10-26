// 이슈 목록·보드 페이지 테스트(WP-980) 공용 도우미 — 프로젝트 메타·이슈 검색 MSW 핸들러와 요청 기록.
// E2E 의 stubProjectMeta + routeIssueSearch + trackRequests 를 MSW 로 옮긴 것이다(목록·보드 page test 들이 함께 쓴다).
import { http, HttpResponse, type RequestHandler } from 'msw'
import { expect } from 'vitest'

import type { IssueResponse } from '@/types/issue'

import { createIssueSearchResponse } from '../../../../e2e/factories/issue.factory'
import { createProject } from '../../../../e2e/factories/project.factory'

export const KEY = 'WP'
export const API = '/api/v1'
export const ISSUES = `${API}/projects/${KEY}/issues`

/** 보드 열 쿼리는 시드 상태 id(statusId 1~4)로 좁혀 온다(WP-808) — 범주로 되돌린다. 열 쿼리가 아니면 null. */
const SEED_CATEGORY: Record<string, string> = { '1': 'TODO', '2': 'IN_PROGRESS', '3': 'DONE', '4': 'CANCELED' }
export function columnStatusOf(url: URL): string | null {
  return SEED_CATEGORY[url.searchParams.get('statusId') ?? ''] ?? null
}

/** 프로젝트·멤버 메타 — 화면이 처음 부르는 조회. members 를 주면 그 목록을 돌려준다. */
export function projectMeta(members: unknown[] = []): RequestHandler[] {
  return [
    http.get(`${API}/projects/${KEY}`, () => HttpResponse.json(createProject({ key: KEY }))),
    http.get(`${API}/projects/${KEY}/members`, () => HttpResponse.json(members)),
  ]
}

/**
 * 이슈 검색 GET — respond 가 URL 을 받아 이슈 목록(그리고 다음 cursor)이나 Response 를 돌려준다.
 * 보낸 검색 URL 은 urls 에 차례로 쌓인다(E2E trackRequests 와 같은 역할).
 */
export function issueSearch(
  respond: (url: URL) => IssueResponse[] | { items: IssueResponse[]; next?: string | null } | Response | Promise<Response>,
) {
  const urls: URL[] = []
  const handler = http.get(ISSUES, async ({ request }) => {
    const url = new URL(request.url)
    urls.push(url)
    const out = await respond(url)
    if (out instanceof Response) return out
    if (Array.isArray(out)) return HttpResponse.json(createIssueSearchResponse(out, null))
    return HttpResponse.json(createIssueSearchResponse(out.items, out.next ?? null))
  })
  return { handler, urls, last: () => urls.at(-1) }
}

/** 쓰기 요청 기록 — method·경로·본문. */
export type Call = { method: string; path: string; body: unknown }

/** 요청 본문을 JSON 으로 읽는다(없으면 null). */
export async function bodyOf(request: Request): Promise<unknown> {
  const text = await request.text()
  return text ? (JSON.parse(text) as unknown) : null
}

/** 켜짐 모양(TOGGLE_ON) — E2E expectToggleLook 과 같은 토큰(primary 글자·테두리·배경)을 클래스로 본다. */
export function expectToggleLook(el: HTMLElement, on: boolean) {
  const tokens = ['text-primary', 'border-primary/50', 'bg-primary/10']
  const classes = el.className.split(/\s+/)
  for (const t of tokens) {
    if (on) expect(classes, t).toContain(t)
    else expect(classes, t).not.toContain(t)
  }
}

/** 서버 오류 응답. */
export const fail = (status = 500, message = '서버 오류') => HttpResponse.json({ status, message }, { status })
