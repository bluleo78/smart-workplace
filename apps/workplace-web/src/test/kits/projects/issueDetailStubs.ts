// 이슈 상세·목록 페이지 테스트 공용 도우미(WP-980, 이관 묶음 b2).
// E2E 의 mockIssueDetail·setupStubs 와 같은 구성을 MSW 핸들러로 깐다 — 화면 데이터(상세·첨부·드라이브 링크·멤버)는
// 테스트가 넘기고, 이슈 상세가 늘 부르는 부가 조회(watchers·labels·attachments·drive-links)는 빈 성공으로 채운다.
// 요청 기록(recordRequests)은 MSW 이벤트로 모든 요청을 남겨 payload·쿼리·횟수를 단언하게 한다(E2E trackRequests 와 같은 역할).
import { screen } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { onTestFinished } from 'vitest'

import { server } from '@/test/msw/server'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import type { IssueAttachment } from '@/types/attachment'
import type { IssueDetailResponse } from '@/types/issue'
import type { MemberResponse, ProjectResponse } from '@/types/project'

import { createIssue, createIssueDetail } from '../../../../e2e/factories/issue.factory'
import { createProject } from '../../../../e2e/factories/project.factory'

// jsdom 에 없는 브라우저 API 의 빈 구현 — 이 도우미를 불러오는 테스트 파일에만 적용된다(공용 setup 은 건드리지 않는다).
// Radix Select 는 포인터 캡처를, 모바일 탭·목록은 Element.scrollTo 를, 인증 이미지는 objectURL 을 부른다 — 모두 이 테스트들의 관심사가 아니다.
if (typeof Element !== 'undefined') {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {}
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {}
}
if (typeof URL !== 'undefined' && !URL.createObjectURL) URL.createObjectURL = () => 'blob:fake'
if (typeof URL !== 'undefined' && !URL.revokeObjectURL) URL.revokeObjectURL = () => {}

/** 기록된 요청 한 건 — body 는 JSON 이면 객체, 아니면(멀티파트 등) 원문 문자열, 없으면 null. */
export type RecordedRequest = { method: string; path: string; search: URLSearchParams; body: unknown }

/**
 * 이 테스트 동안 앱이 보낸 모든 요청을 기록한다(핸들러 응답과 무관하게).
 * 본문은 비동기로 읽혀 기록 직후엔 undefined 일 수 있다 — 단언은 waitFor 안에서 한다.
 */
export function recordRequests() {
  const list: RecordedRequest[] = []
  const listener = ({ request }: { request: Request }) => {
    const url = new URL(request.url)
    const entry: RecordedRequest = { method: request.method, path: url.pathname, search: url.searchParams, body: undefined }
    list.push(entry)
    void request
      .clone()
      .text()
      .then((text) => {
        if (!text) return (entry.body = null)
        try {
          entry.body = JSON.parse(text)
        } catch {
          entry.body = text
        }
      })
      .catch(() => (entry.body = null))
  }
  server.events.on('request:start', listener)
  onTestFinished(() => {
    server.events.removeListener('request:start', listener)
  })
  const match = (method: string, path: string | RegExp) =>
    list.filter(
      (r) => (method === 'ANY' || r.method === method) && (typeof path === 'string' ? r.path === path : path.test(r.path)),
    )
  return {
    all: () => list,
    of: match,
    count: (method: string, path: string | RegExp) => match(method, path).length,
    bodies: (method: string, path: string | RegExp) => match(method, path).map((r) => r.body),
    last: (method: string, path: string | RegExp) => match(method, path).at(-1),
  }
}

type IssueDetailOptions = {
  key?: string
  number?: number
  /** 상세 응답 — 함수면 요청마다 다시 읽는다(변경 뒤 재조회 반영). */
  detail?: IssueDetailResponse | (() => IssueDetailResponse)
  project?: Partial<ProjectResponse>
  members?: MemberResponse[]
  attachments?: IssueAttachment[] | (() => IssueAttachment[])
  driveLinks?: unknown[] | (() => unknown[])
  /** 드라이브 공간 목록(기본 빈 목록). */
  driveSpaces?: unknown[]
}

const read = <T>(v: T | (() => T)): T => (typeof v === 'function' ? (v as () => T)() : v)

/** 이슈 상세 화면이 부르는 API — E2E mockIssueDetail 과 같은 최소 구성. */
export function issueDetailHandlers({
  key = 'WP',
  number = 1,
  detail = createIssueDetail({ summary: createIssue({ projectKey: key, number }) }),
  project,
  members = [],
  attachments = [],
  driveLinks = [],
  driveSpaces = [],
}: IssueDetailOptions = {}): RequestHandler[] {
  const base = `/api/v1/projects/${key}/issues/${number}`
  return [
    http.get(`/api/v1/projects/${key}`, () => HttpResponse.json(createProject({ key, ...project }))),
    http.get(`/api/v1/projects/${key}/members`, () => HttpResponse.json(members)),
    http.get(base, () => HttpResponse.json(read(detail))),
    http.get(`${base}/watchers`, () => HttpResponse.json([])),
    http.get(`${base}/labels`, () => HttpResponse.json([])),
    http.get(`${base}/attachments`, () => HttpResponse.json(read(attachments))),
    http.get(`${base}/drive-links`, () => HttpResponse.json(read(driveLinks))),
    http.get('/api/v1/drive/spaces', () => HttpResponse.json(driveSpaces)),
    // 이슈 생성 다이얼로그·상위 선택이 부르는 목록 — 빈 결과.
    http.get(`/api/v1/projects/${key}/issues`, () => HttpResponse.json({ items: [], nextCursor: null, hasMore: false })),
  ]
}

/** 이슈 상세를 열고 제목이 뜰 때까지 기다린다. extra 핸들러는 기본보다 우선한다. */
export async function openIssueDetail(options: IssueDetailOptions & { handlers?: RequestHandler[]; path?: string } = {}) {
  const { handlers = [], path, ...rest } = options
  const key = rest.key ?? 'WP'
  const number = rest.number ?? 1
  const view = renderPage(path ?? `/projects/${key}/issues/${number}`, { handlers: [...handlers, ...issueDetailHandlers(rest)] })
  await screen.findByTestId('issue-title-heading', {}, { timeout: PAGE_LOAD_TIMEOUT })
  return view
}

/** JSON 응답 축약. */
export const json = (body: unknown, status = 200) => HttpResponse.json(body as never, { status })

/**
 * 프로젝트 설정(/projects/:key/settings) 진입 API — E2E mockProjectSettings 와 같은 구성.
 * members 가 함수면 요청마다 다시 읽는다(추가·제거 뒤 재조회 반영).
 */
export function projectSettingsHandlers(
  project: ProjectResponse,
  members: MemberResponse[] | (() => unknown[]),
  extra: { types?: unknown[] | (() => unknown[]) } = {},
): RequestHandler[] {
  const base = `/api/v1/projects/${project.key}`
  return [
    http.get(base, () => HttpResponse.json(project)),
    http.get(`${base}/members`, () => HttpResponse.json(read(members))),
    http.get(`${base}/labels`, () => HttpResponse.json([])),
    http.get(`${base}/types`, () => HttpResponse.json(read(extra.types ?? []))),
    http.get(`${base}/fields`, () => HttpResponse.json([])),
    http.get(`${base}/issues/group-counts`, () => HttpResponse.json({ groupBy: 'statusId', groups: [] })),
  ]
}

/**
 * 이슈 채팅 스레드·메시지 목록·읽음 — E2E mockChatThread 와 같다. 드로워를 열면 메시지 목록을 다시 읽고 읽음을 보낸다.
 * messages 가 함수면 요청마다 다시 읽는다(작성·수정 뒤 재조회 반영). 커서가 있으면 olderPages 에서 그 페이지를 준다.
 */
export function issueChatHandlers({
  key = 'WP',
  number = 1,
  thread,
  messages,
  nextCursor = null,
  olderPages = {},
}: {
  key?: string
  number?: number
  thread: { threadId: number; recentMessages: unknown[] }
  messages?: unknown[] | (() => unknown[])
  nextCursor?: string | null
  olderPages?: Record<string, unknown[]>
}): RequestHandler[] {
  const list = messages ?? thread.recentMessages
  return [
    http.get(`/api/v1/projects/${key}/issues/${number}/chat/thread`, () => HttpResponse.json(thread)),
    http.get(`/api/v1/chat/threads/${thread.threadId}/messages`, ({ request }) => {
      const cursor = new URL(request.url).searchParams.get('cursor')
      if (cursor) return HttpResponse.json({ items: olderPages[cursor] ?? [], nextCursor: null, hasMore: false })
      return HttpResponse.json({ items: read(list), nextCursor, hasMore: nextCursor !== null })
    }),
    http.post(`/api/v1/chat/threads/${thread.threadId}/read`, () => new HttpResponse(null, { status: 204 })),
    http.post(`/api/v1/chat/threads/${thread.threadId}/typing`, () => new HttpResponse(null, { status: 204 })),
  ]
}

/** 이슈 목록·보드 화면 API — 목록 응답은 요청 URL 을 받아 고른다(그룹·커서·필터별 응답). */
export function issueListHandlers({
  key = 'WP',
  issues,
  project,
  extra = {},
}: {
  key?: string
  issues: (url: URL) => unknown
  project?: Partial<ProjectResponse>
  /** 프로젝트 하위 GET(예: 'saved-views'·'fields'·'cycles'·'types') 응답 — 없으면 셸 기본(빈 목록). */
  extra?: Record<string, unknown | (() => unknown)>
}): RequestHandler[] {
  return [
    http.get(`/api/v1/projects/${key}`, () => HttpResponse.json(createProject({ key, ...project }))),
    http.get(`/api/v1/projects/${key}/issues`, ({ request }) => HttpResponse.json(issues(new URL(request.url)) as never)),
    // 그룹 헤더 총계(WP-472) — 기본은 빈 묶음(헤더는 불러온 행 수로 폴백).
    http.get(`/api/v1/projects/${key}/issues/group-counts`, ({ request }) =>
      HttpResponse.json({ groupBy: new URL(request.url).searchParams.get('groupBy') ?? 'statusId', groups: [] }),
    ),
    ...Object.entries(extra).map(([sub, body]) =>
      http.get(`/api/v1/projects/${key}/${sub}`, () => HttpResponse.json(read(body) as never)),
    ),
  ]
}
