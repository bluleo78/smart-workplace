// 이슈 상세·목록 페이지 테스트 공용 도우미(WP-980, 이관 묶음 b2).
// E2E 의 mockIssueDetail·setupStubs 와 같은 구성을 MSW 핸들러로 깐다 — 화면 데이터(상세·첨부·드라이브 링크·멤버)는
// 테스트가 넘기고, 이슈 상세가 늘 부르는 부가 조회(watchers·labels·attachments·drive-links)는 빈 성공으로 채운다.
// 요청 기록(recordRequests)은 MSW 이벤트로 모든 요청을 남겨 payload·쿼리·횟수를 단언하게 한다(E2E trackRequests 와 같은 역할).
import { http, HttpResponse, type RequestHandler } from 'msw'
import { onTestFinished } from 'vitest'

import { server } from '@/test/msw/server'
import type { IssueAttachment } from '@/types/attachment'
import type { IssueDetailResponse } from '@/types/issue'
import type { MemberResponse, ProjectResponse } from '@/types/project'

import { createIssue, createIssueDetail, createIssueSearchResponse } from '../../../../e2e/factories/issue.factory'
import { createProject } from '../../../../e2e/factories/project.factory'

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

export type IssueDetailOptions = {
  key?: string
  /** 이슈 번호 — 없으면 detail 의 summary.number(detail 도 없으면 1). */
  number?: number
  /** 상세 응답 — 함수면 요청마다 다시 읽는다(변경 뒤 재조회 반영). */
  detail?: IssueDetailResponse | (() => IssueDetailResponse)
  project?: Partial<ProjectResponse>
  members?: MemberResponse[]
  attachments?: IssueAttachment[] | (() => IssueAttachment[])
  driveLinks?: unknown[] | (() => unknown[])
  /** 드라이브 공간 목록(기본 빈 목록). */
  driveSpaces?: unknown[]
  /** 테스트 전용 핸들러 — 아래 기본값보다 우선한다. */
  extra?: RequestHandler[]
}

const read = <T>(v: T | (() => T)): T => (typeof v === 'function' ? (v as () => T)() : v)

/** 상세의 하위 조회 중 테스트가 값을 주지 않으면 빈 목록으로 답하는 것들 — 상세 화면이 섹션마다 부른다. */
const EMPTY_DETAIL_SUBS = ['watchers', 'labels', 'relations', 'dependencies', 'cycles', 'links', 'mail-links']

/** 상세 이슈 번호 — number 가 없으면 detail 의 summary.number(detail 도 없으면 1). */
export function detailNumberOf({ number, detail }: Pick<IssueDetailOptions, 'number' | 'detail'>): number {
  return number ?? (detail ? read(detail).summary.number : 1)
}

/**
 * 이슈 상세 본문과 하위 조회만 — 프로젝트·검색은 다른 도우미(projectScreen 등)가 깔 때 쓴다.
 * 이슈 상세 목은 여기 하나다(WP-995) — 묶음마다 따로 만든 목(상세 ref·SSE·프로젝트 화면용)을 합쳤다.
 */
export function issueDetailSubHandlers({
  key = 'WP',
  number,
  detail,
  attachments = [],
  driveLinks = [],
}: Pick<IssueDetailOptions, 'key' | 'number' | 'detail' | 'attachments' | 'driveLinks'> = {}): RequestHandler[] {
  const n = detailNumberOf({ number, detail })
  const body = detail ?? createIssueDetail({ summary: createIssue({ projectKey: key, number: n }) })
  const base = `/api/v1/projects/${key}/issues/${n}`
  return [
    http.get(base, () => HttpResponse.json(read(body))),
    http.get(`${base}/attachments`, () => HttpResponse.json(read(attachments))),
    http.get(`${base}/drive-links`, () => HttpResponse.json(read(driveLinks))),
    ...EMPTY_DETAIL_SUBS.map((sub) => http.get(`${base}/${sub}`, () => HttpResponse.json([]))),
    // 에픽 하위 목록(WP-1038) — 목록이 아니라 { items, hiddenCount } 모양이다.
    http.get(`${base}/children`, () => HttpResponse.json({ items: [], hiddenCount: 0 })),
    // 상위 에픽 고르기의 다른 프로젝트 에픽 찾기(WP-1039) — 기본은 결과 없음.
    http.get('/api/v1/issues/lookup', () => HttpResponse.json([])),
  ]
}

/** 이슈 상세 화면이 부르는 API 전부 — 프로젝트·멤버·상세와 하위 조회·하위 후보 검색·드라이브 공간. extra 가 먼저다. */
export function issueDetailHandlers({
  key = 'WP',
  project,
  members = [],
  driveSpaces = [],
  extra = [],
  ...detailOptions
}: IssueDetailOptions = {}): RequestHandler[] {
  return [
    ...extra,
    http.get(`/api/v1/projects/${key}`, () => HttpResponse.json(createProject({ key, ...project }))),
    http.get(`/api/v1/projects/${key}/members`, () => HttpResponse.json(members)),
    ...issueDetailSubHandlers({ key, ...detailOptions }),
    http.get('/api/v1/drive/spaces', () => HttpResponse.json(driveSpaces)),
    // 이슈 생성 다이얼로그·상위 선택·하위 태스크 섹션이 부르는 목록 — 빈 결과.
    http.get(`/api/v1/projects/${key}/issues`, () => HttpResponse.json(createIssueSearchResponse([], null))),
  ]
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
  extra: { types?: unknown[] | (() => unknown[]); memberGroups?: unknown[] | (() => unknown[]) } = {},
): RequestHandler[] {
  const base = `/api/v1/projects/${project.key}`
  return [
    http.get(base, () => HttpResponse.json(project)),
    http.get(`${base}/members`, () => HttpResponse.json(read(members))),
    // 멤버로 둔 조직도 부서(WP-1057) — 팀 프로젝트 멤버 섹션이 받는다. 기본은 없음.
    http.get(`${base}/member-groups`, () => HttpResponse.json(read(extra.memberGroups ?? []))),
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
