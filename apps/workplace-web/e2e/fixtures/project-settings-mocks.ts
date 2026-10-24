// e2e/fixtures/project-settings-mocks.ts
// 프로젝트 설정(/projects/WP/settings) 진입에 필요한 GET 목 — 데스크톱·모바일 레이아웃 스펙이 함께 쓴다(WP-397).
// 「상태」 섹션(WP-809)의 상태 목록·이슈 수·삭제 영향·순서 변경·삭제 목(mockStatusManagement)도 여기 둔다.
import type { Page } from '@playwright/test'

import type { IssueGroupCountsResponse } from '../../src/types/issue'
import type { ProjectResponse } from '../../src/types/project'
import type { ProjectStatus, StatusDeletionImpact } from '../../src/types/projectStatus'
import { createMember, createProject } from '../factories/project.factory'
import { inServerOrder, seedStatuses } from '../factories/projectStatus.factory'
import { mockApi } from './api-mock'
import { type RequestTracker, trackRequests } from './requests'

type Member = ReturnType<typeof createMember>

/** 기본 멤버 — 현재 사용자(id=1)가 OWNER. */
const DEFAULT_MEMBERS: Member[] = [createMember({ userId: 1, username: 'testuser', name: '테스트 사용자', role: 'OWNER' })]

/**
 * 프로젝트(기본 WP)·멤버 목록을 목 처리하고 라벨·유형·필드는 빈 목록으로 응답한다.
 * 상태 섹션의 이슈 수(group-counts)는 빈 묶음으로 준다 — 미스텁이면 dev 프록시로 누수된다(상태 목록은 auth.fixture 기본 스텁).
 * mockApi 는 GET 만 받으므로 추가·삭제 등 다른 요청은 테스트별 목이 받는다.
 * project 를 넘기면 그 프로젝트(키 포함)로 응답한다 — 개인·기본 프로젝트 등(WP-857).
 */
export async function mockProjectSettings(
  page: Page,
  members: Member[] = DEFAULT_MEMBERS,
  project: ProjectResponse = createProject(),
) {
  const base = `/api/v1/projects/${project.key}`
  await mockApi(page, 'GET', base, project)
  await mockApi(page, 'GET', `${base}/members`, members)
  for (const path of ['labels', 'types', 'fields']) {
    await mockApi(page, 'GET', `${base}/${path}`, [])
  }
  const noCounts: IssueGroupCountsResponse = { groupBy: 'statusId', groups: [] }
  await mockApi(page, 'GET', `${base}/issues/group-counts`, noCounts)
}

/** 상태 섹션 목 옵션 — 상태 목록·상태별 이슈 수·삭제 영향·순서 변경 응답 코드. */
export interface StatusManagementMockOptions {
  projectKey?: string
  /** 처음 상태 목록(기본: 시드 4상태). 추가·수정·순서 변경·삭제가 이 목록을 고쳐 다음 GET 이 바뀐 값을 준다. */
  statuses?: ProjectStatus[]
  /** 상태 id → 활성 이슈 수(group-counts·deletion-impact 의 issueCount). */
  counts?: Record<number, number>
  /** 상태 id 별 삭제 영향 덮어쓰기(issueCount 기본은 counts). */
  impact?: (id: number) => Partial<StatusDeletionImpact>
  /** 순서 변경(PUT /order) 응답 코드 — 500 이면 실패(목록은 그대로). */
  orderStatus?: number
}

/** 상태 섹션 목 핸들 — 지금 목록과 쓰기 요청 기록. */
export interface StatusManagementMock {
  list: () => ProjectStatus[]
  creates: RequestTracker
  patches: RequestTracker
  orders: RequestTracker
  deletes: RequestTracker
}

/**
 * 상태 섹션 목(WP-809) — 서버처럼 목록 상태를 들고 있어 추가·수정·순서 변경·삭제 뒤 재조회가 바뀐 목록을 받는다.
 * (늘 같은 목록을 주면 무효화 재조회가 화면을 원래대로 되돌려 「끝에 붙는다」·순서 단언이 흔들린다.)
 * auth.fixture 의 상태 GET 기본 스텁보다 나중에 등록돼 우선한다(LIFO).
 */
export async function mockStatusManagement(page: Page, opts: StatusManagementMockOptions = {}): Promise<StatusManagementMock> {
  const base = `/api/v1/projects/${opts.projectKey ?? 'WP'}`
  let list = inServerOrder(opts.statuses ?? seedStatuses())
  const counts = opts.counts ?? {}
  let nextId = 500
  const statusPath = new RegExp(`^${base}/statuses/(\\d+)$`)
  const impactPath = new RegExp(`^${base}/statuses/(\\d+)/deletion-impact$`)

  const creates = trackRequests(page, 'POST', `${base}/statuses`)
  const patches = trackRequests(page, 'PATCH', statusPath)
  const orders = trackRequests(page, 'PUT', `${base}/statuses/order`)
  const deletes = trackRequests(page, 'DELETE', statusPath)

  // 목록 GET + 추가 POST — 새 상태는 범주 맨 끝(서버처럼 position 최대 + 1).
  await page.route((u) => u.pathname === `${base}/statuses`, async (route) => {
    const req = route.request()
    if (req.method() === 'GET') return route.fulfill({ json: list })
    if (req.method() !== 'POST') return route.fallback()
    const body = req.postDataJSON() as Pick<ProjectStatus, 'name' | 'category' | 'color'>
    const created: ProjectStatus = {
      id: nextId++,
      name: body.name,
      category: body.category,
      color: body.color,
      position: Math.max(...list.map((s) => s.position)) + 1,
    }
    list = inServerOrder([...list, created])
    return route.fulfill({ status: 201, json: created })
  })

  // 단건 수정·삭제 — 삭제는 moveTo 와 무관하게 목록에서 뺀다(이슈 이전은 서버 몫이라 목은 보지 않는다).
  await page.route((u) => statusPath.test(u.pathname), async (route) => {
    const req = route.request()
    const id = Number(statusPath.exec(new URL(req.url()).pathname)![1])
    if (req.method() === 'PATCH') {
      const patch = req.postDataJSON() as Partial<ProjectStatus>
      list = list.map((s) => (s.id === id ? { ...s, ...patch } : s))
      return route.fulfill({ json: list.find((s) => s.id === id) })
    }
    if (req.method() === 'DELETE') {
      list = list.filter((s) => s.id !== id)
      return route.fulfill({ status: 204, body: '' })
    }
    return route.fallback()
  })

  // 같은 범주 순서 변경 — 그 범주가 쓰던 position 들을 새 순서대로 다시 나눠 준다.
  await page.route((u) => u.pathname === `${base}/statuses/order`, async (route) => {
    const req = route.request()
    if (req.method() !== 'PUT') return route.fallback()
    if (opts.orderStatus && opts.orderStatus >= 400) {
      return route.fulfill({ status: opts.orderStatus, json: { status: opts.orderStatus, message: '서버 오류' } })
    }
    const { category, statusIds } = req.postDataJSON() as { category: string; statusIds: number[] }
    const positions = list.filter((s) => s.category === category).map((s) => s.position).sort((a, b) => a - b)
    list = inServerOrder(list.map((s) => (s.category === category ? { ...s, position: positions[statusIds.indexOf(s.id)] } : s)))
    return route.fulfill({ json: list })
  })

  // 삭제 영향 — 이슈 수는 counts, 나머지는 0 기본에 테스트별 덮어쓰기.
  await page.route((u) => impactPath.test(u.pathname), async (route) => {
    const id = Number(impactPath.exec(new URL(route.request().url()).pathname)![1])
    const impact: StatusDeletionImpact = {
      issueCount: counts[id] ?? 0,
      savedViewCount: 0,
      blockedEpicCount: 0,
      emptiedFilterViewCount: 0,
      ...opts.impact?.(id),
    }
    return route.fulfill({ json: impact })
  })

  // 상태별 이슈 수(group-counts groupBy=statusId) — 상태 행의 「N개」.
  await page.route((u) => u.pathname === `${base}/issues/group-counts`, async (route) => {
    const res: IssueGroupCountsResponse = {
      groupBy: 'statusId',
      groups: Object.entries(counts).map(([key, count]) => ({ key, count })),
    }
    return route.fulfill({ json: res })
  })

  return { list: () => list, creates, patches, orders, deletes }
}
