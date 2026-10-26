// 이슈 상세 페이지 테스트 공용 목(WP-980) — 상세 화면이 부르는 부속 조회(구성원·구독·라벨·첨부)를 MSW 로 깐다.
// E2E 의 setupCommonStubs(activity-timeline·issue-instant-context 등)와 같은 목 집합이다. 앱 셸 기본값(baseHandlers)
// 위에 얹고, 화면을 검증하는 테스트는 extra 로 같은 경로를 다시 주면 그쪽이 먼저다(MSW 는 앞에 둔 핸들러가 우선).
import { http, HttpResponse, type RequestHandler } from 'msw'

import type { IssueDetailResponse } from '@/types/issue'
import type { MemberResponse, ProjectResponse } from '@/types/project'

import { createIssueSearchResponse } from '../../../../e2e/factories/issue.factory'
import { createProject } from '../../../../e2e/factories/project.factory'

type DetailMockOptions = {
  /** 프로젝트 키 — 기본 WP. */
  key?: string
  /** 상세 응답. 함수면 요청마다 다시 부른다(저장 뒤 재조회로 바뀌는 상세). */
  detail: IssueDetailResponse | (() => IssueDetailResponse)
  project?: ProjectResponse
  members?: MemberResponse[]
  /** 테스트 전용 핸들러 — 아래 기본값보다 우선한다. */
  extra?: RequestHandler[]
}

/** 이슈 상세(번호는 detail.summary.number)와 그 부속 조회 핸들러. */
export function issueDetailHandlers({ key = 'WP', detail, project, members = [], extra = [] }: DetailMockOptions): RequestHandler[] {
  const read = () => (typeof detail === 'function' ? detail() : detail)
  const base = `/api/v1/projects/${key}/issues/${read().summary.number}`
  return [
    ...extra,
    http.get(`/api/v1/projects/${key}`, () => HttpResponse.json(project ?? createProject({ key }))),
    http.get(`/api/v1/projects/${key}/members`, () => HttpResponse.json(members)),
    http.get(base, () => HttpResponse.json(read())),
    // 하위 태스크·에픽 후보 검색 — 상세가 부모·자식 목록을 위해 부른다. 기본은 빈 결과.
    http.get(`/api/v1/projects/${key}/issues`, () => HttpResponse.json(createIssueSearchResponse([], null))),
    ...['watchers', 'labels', 'attachments'].map((sub) => http.get(`${base}/${sub}`, () => HttpResponse.json([]))),
  ]
}

/**
 * 통합 SSE(/api/v1/events) 를 테스트가 프레임을 밀어 넣을 수 있는 열린 스트림으로 둔다 — E2E 의 mockGatedEvents·pushHeldEvents 자리.
 * 연결을 끊지 않으므로 재연결 catch-up(활성 쿼리 전체 재조회)이 끼지 않고, 밀어 넣은 프레임 처리만 검증된다.
 * push 는 열린 연결이 생길 때까지 기다린 뒤 모든 열린 연결에 같은 프레임을 보낸다.
 */
export function controllableEvents() {
  const open = new Set<ReadableStreamDefaultController<Uint8Array>>()
  const handler = http.get('/api/v1/events', ({ request }) => {
    let ctrl!: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        ctrl = c
        open.add(c)
      },
    })
    request.signal.addEventListener('abort', () => {
      open.delete(ctrl)
      try {
        ctrl.close()
      } catch {
        // 이미 닫혔으면 무시
      }
    })
    return new HttpResponse(stream, { headers: { 'Content-Type': 'text/event-stream' } })
  })
  return {
    handler,
    /** SSE 프레임 문자열(`event: x\ndata: {...}\n\n`)을 열린 연결 모두에 보낸다. */
    async push(frame: string) {
      for (let i = 0; open.size === 0 && i < 100; i++) await new Promise((r) => setTimeout(r, 20))
      if (open.size === 0) throw new Error('열린 /api/v1/events 연결이 없다')
      const bytes = new TextEncoder().encode(frame)
      for (const c of open) c.enqueue(bytes)
    },
  }
}

/** 서버 ResourceSseDispatcher 가 보내는 resource.changed 프레임. */
export const resourceChangedFrame = (data: object) => `event: resource.changed\ndata: ${JSON.stringify(data)}\n\n`
