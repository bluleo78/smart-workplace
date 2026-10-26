// 프로젝트 버전(WP-888) 페이지 테스트 공용 MSW 응답 — e2e/pages/issue-versions.spec.ts 의 setup() 과 같은 서버 모양.
// 버전 목록은 상태를 가진 모킹이다 — 출시(POST release)는 그 버전을 RELEASED 로 바꿔 재조회가 바뀐 목록을 받는다.
// 쓰기 요청(POST·PUT)은 writes 에 경로·본문을 쌓아 테스트가 payload 를 단언한다.
// 「없다」 단언은 데이터가 오기 전에도 참이라, served 플래그로 버전 응답이 실제로 나간 뒤에 판정하게 한다.
import { http, HttpResponse } from 'msw'

import type { IssueResponse } from '@/types/issue'
import type { MemberResponse } from '@/types/project'
import type { VersionIssueCount, VersionResponse } from '@/types/version'

import { createIssue, createIssueDetail, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { systemTypes } from '../../../e2e/factories/issueType.factory'
import { createMember, createProject } from '../../../e2e/factories/project.factory'

export const KEY = 'WP'
export const BASE = `/api/v1/projects/${KEY}`

/** 현재 사용자(id 1)가 프로젝트 OWNER — 버전 관리 권한이 있다. */
export const OWNER_MEMBERS = [createMember({ userId: 1, username: 'testuser', name: '테스트 사용자', role: 'OWNER' })]
/** 현재 사용자(id 1)가 일반 MEMBER — 버전 화면은 읽기 전용이다. */
export const PLAIN_MEMBERS = [createMember({ userId: 1, username: 'testuser', name: '테스트 사용자', role: 'MEMBER' })]

export interface VersionApiOptions {
  versions?: VersionResponse[]
  /** 이슈 목록·상세에 쓸 이슈(번호 1). */
  issue?: Partial<IssueResponse>
  /** 출시 대화상자가 읽는 붙은 이슈 수. */
  count?: VersionIssueCount
  members?: MemberResponse[]
}

export type Write = { method: string; path: string; body: unknown }

/** 버전 화면·이슈 상세·이슈 목록이 부르는 API 를 한꺼번에 준다. */
export function versionApi(opts: VersionApiOptions = {}) {
  let list = [...(opts.versions ?? [])]
  const members = opts.members ?? OWNER_MEMBERS
  const issue = createIssue({ id: 1, number: 1, title: '결제 모듈 개편', ...opts.issue })
  const writes: Write[] = []
  const served = { versions: false }

  const handlers = [
    http.get(BASE, () => HttpResponse.json(createProject())),
    http.get(`${BASE}/members`, () => HttpResponse.json(members)),
    http.get(`${BASE}/types`, () => HttpResponse.json(systemTypes())),
    http.get(`${BASE}/views`, () => HttpResponse.json([])),
    // 사용자 정의 필드 — 목록 필터·열 후보가 부른다. 이 테스트들은 쓰지 않는다.
    http.get(`${BASE}/fields`, () => HttpResponse.json([])),
    http.get(`${BASE}/versions`, () => {
      served.versions = true
      return HttpResponse.json(list)
    }),
    http.get(`${BASE}/versions/:id/issue-count`, () => HttpResponse.json(opts.count ?? { fix: 0, affects: 0, unresolvedFix: 0 })),
    // 상세의 이슈 탭(fixVersion/affectsVersion 검색)과 목록 — 이 테스트들은 이슈 한 건이면 된다.
    http.get(`${BASE}/issues`, () => HttpResponse.json(createIssueSearchResponse([issue], null))),
    http.post(`${BASE}/versions/:id/release`, async ({ request, params }) => {
      const id = Number(params.id)
      writes.push({ method: 'POST', path: new URL(request.url).pathname, body: await request.json() })
      list = list.map((v) => (v.id === id ? { ...v, status: 'RELEASED', releasedAt: new Date().toISOString() } : v))
      return HttpResponse.json(list.find((v) => v.id === id))
    }),
    http.get(`${BASE}/issues/1`, () => HttpResponse.json(createIssueDetail({ summary: issue }))),
    http.get(`${BASE}/issues/1/watchers`, () => HttpResponse.json([])),
    http.get(`${BASE}/issues/1/attachments`, () => HttpResponse.json([])),
  ]
  return { handlers, writes, served, list: () => list, issue }
}
