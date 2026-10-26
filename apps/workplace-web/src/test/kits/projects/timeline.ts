// 타임라인 페이지 테스트 공용 도구(WP-980, b1) — 캔버스 흉내와 타임라인 화면 API 목.
// SVAR 간트는 글자 폭을 캔버스 2D 컨텍스트(measureText)로 잰다. jsdom 에는 캔버스가 없어 getContext 가 null 이고
// 간트가 첫 렌더에서 던진다 — 글자 수에 비례한 폭을 돌려주는 흉내 컨텍스트로 바꿔 그리드·막대 DOM 이 그려지게 한다.
// 폭·좌표 자체는 jsdom 에서 의미가 없으므로 이 도구로 띄운 테스트는 위치·크기를 단언하지 않는다(그건 E2E @layout).
import { http, HttpResponse, type RequestHandler } from 'msw'

import type { CycleResponse } from '@/types/cycle'
import type { IssueResponse } from '@/types/issue'
import type { MilestoneResponse } from '@/types/milestone'
import type { MemberResponse } from '@/types/project'

import { createIssueSearchResponse } from '../../../../e2e/factories/issue.factory'
import { createProject } from '../../../../e2e/factories/project.factory'

export const KEY = 'WP'
export const API = `/api/v1/projects/${KEY}`

/**
 * 간트가 jsdom 에서 그려지게 한다 — 파일 맨 위에서 한 번 부른다.
 * 1) 캔버스 2D 컨텍스트 흉내: measureText 만 값(글자당 7px)을 주고 나머지 그리기 호출은 무시한다.
 * 2) 간트 안 요소의 크기(1200×800)와, 관찰 즉시 한 번 알리는 ResizeObserver: SVAR 는 보이는 행 구간(area)을
 *    컨테이너 높이로 정하는데 jsdom 은 늘 0 이라 기본 2행만 그려 펼친 하위 행이 잘렸다. 크기는 간트 안에서만 준다.
 */
export function stubCanvas() {
  const ctx = new Proxy({ measureText: (t: string) => ({ width: t.length * 7 }) } as Record<string, unknown>, {
    get: (o, k) => (k in o ? o[k as string] : () => undefined),
    set: () => true,
  })
  HTMLCanvasElement.prototype.getContext = (() => ctx) as unknown as HTMLCanvasElement['getContext']
  const inGantt = (el: Element) => !!el.closest('.timeline-gantt-root')
  for (const [k, size] of [['clientHeight', 800], ['offsetHeight', 800], ['clientWidth', 1200], ['offsetWidth', 1200]] as const) {
    Object.defineProperty(HTMLElement.prototype, k, { configurable: true, get(this: HTMLElement) { return inGantt(this) ? size : 0 } })
  }
  globalThis.ResizeObserver = class {
    private cb: ResizeObserverCallback
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb
    }
    observe(el: Element) {
      const entry = { target: el, contentRect: { width: 1200, height: 800 } } as unknown as ResizeObserverEntry
      setTimeout(() => this.cb([entry], this as unknown as ResizeObserver), 0)
    }
    unobserve() {}
    disconnect() {}
  }
}

/** 사이클 응답 한 건. */
export function cycle(overrides: Partial<CycleResponse>): CycleResponse {
  return { id: 7, projectId: 1, name: '사이클 7', goal: null, startDate: '2026-07-01', endDate: '2026-07-14', status: 'ACTIVE', createdAt: '', updatedAt: '', ...overrides }
}

/** 마일스톤 응답 한 건. */
export function milestone(overrides: Partial<MilestoneResponse>): MilestoneResponse {
  return { id: 1, projectId: 1, name: 'v1 출시', dueDate: '2026-08-01', description: null, createdAt: '', updatedAt: '', ...overrides }
}

type TimelineApiOptions = {
  issues?: IssueResponse[]
  members?: MemberResponse[]
  cycles?: CycleResponse[]
  milestones?: MilestoneResponse[]
  viewerIsMember?: boolean
}

/**
 * 타임라인 화면 GET 목 — 프로젝트·멤버·이슈 검색·사이클·마일스톤·의존. 이슈 검색 URL 은 searches 에 쌓는다(필터 → 쿼리 단언용).
 * 쓰기 요청(PATCH 등)은 테스트가 handlers 앞에 따로 둔다.
 */
export function timelineApi(opts: TimelineApiOptions = {}) {
  const searches: URL[] = []
  const handlers: RequestHandler[] = [
    http.get(API, () => HttpResponse.json(createProject({ key: KEY, viewerIsMember: opts.viewerIsMember ?? true }))),
    http.get(`${API}/members`, () => HttpResponse.json(opts.members ?? [])),
    http.get(`${API}/issues`, ({ request }) => {
      searches.push(new URL(request.url))
      return HttpResponse.json(createIssueSearchResponse(opts.issues ?? []))
    }),
    http.get(`${API}/cycles`, () => HttpResponse.json(opts.cycles ?? [])),
    http.get(`${API}/milestones`, () => HttpResponse.json(opts.milestones ?? [])),
    http.get(`${API}/issue-dependencies`, () => HttpResponse.json([])),
  ]
  return { handlers, searches }
}
