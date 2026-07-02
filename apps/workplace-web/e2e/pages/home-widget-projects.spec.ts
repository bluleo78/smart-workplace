// #460: 홈 챗 도크 프로젝트 위젯 렌더 — show_projects / show_project 지시를 받아
// 프로젝트 목록(ProjectsWidget)과 상세(ProjectWidget)를 렌더하는지 검증한다.
// 전략: compose done SSE 에 widgets:[{type:'projects',...}] / [{type:'project',...}] 를 포함시키고
//   위젯이 자체 훅으로 호출하는 /projects, /projects/:key, /projects/:key/members 를 모킹한다.

import { expect, test } from '../fixtures/auth.fixture'
import { mockHomeChatGeneration } from '../fixtures/home-chat-mock'

import type { PageResponse } from '../../src/types/common'
import type { MemberResponse, ProjectResponse } from '../../src/types/project'

// 팩토리 헬퍼 — 테스트용 최소 ProjectResponse 생성.
function makeProject(overrides: Partial<ProjectResponse> & { key: string }): ProjectResponse {
  return {
    id: 1,
    ownerId: 1,
    type: 'TEAM',
    isDefault: false,
    description: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    name: `프로젝트-${overrides.key}`,
    issueTotal: 0,
    issueDone: 0,
    memberCount: 0,
    memberNames: [],
    viewerIsMember: true,
    ...overrides, // key·name 등 호출자 지정이 기본값을 덮음
  }
}

// 팩토리 헬퍼 — 테스트용 MemberResponse 생성.
function makeMember(overrides: Partial<MemberResponse> & { userId: number; username: string; name: string }): MemberResponse {
  return {
    kind: 'HUMAN',
    role: 'MEMBER',
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides, // userId·username·name 등 호출자 지정이 기본값을 덮음
  }
}

// 팩토리 헬퍼 — PageResponse 래퍼.
function pageOf(items: ProjectResponse[]): PageResponse<ProjectResponse> {
  return { content: items, page: 0, size: 20, totalElements: items.length, totalPages: 1 }
}

test.describe('#460 홈 챗 도크 프로젝트 위젯 렌더', () => {
  test(
    'projects 위젯이 프로젝트 목록을 렌더한다',
    { tag: '@smoke' },
    async ({ authenticatedPage: pg }) => {
      // 1) compose → projects 위젯 지시.
      await mockHomeChatGeneration(pg, {
        frames: [
          { event: 'done', data: { sessionId: 's-projects-1', widgets: [{ type: 'projects', params: {} }] } },
        ],
      })
      // 2) 프로젝트 목록 API 모킹.
      await pg.route(
        (url) => url.pathname === '/api/v1/projects',
        (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(
              pageOf([
                makeProject({ id: 1, key: 'ALPHA', name: '알파 프로젝트' }),
                makeProject({ id: 2, key: 'BETA', name: '베타 프로젝트' }),
              ]),
            ),
          }),
      )

      await pg.goto('/')
      await pg.getByTestId('chat-launcher').click()
      await pg.getByTestId('chat-input').fill('프로젝트 목록 보여줘')
      await pg.getByRole('button', { name: '보내기' }).click()

      // 위젯 컨테이너 + 프로젝트 목록 확인.
      await expect(pg.getByTestId('chat-widgets')).toBeVisible()
      const items = pg.getByTestId('projects-items')
      await expect(items).toBeVisible()
      await expect(items).toContainText('알파 프로젝트')
      await expect(items).toContainText('베타 프로젝트')
      await expect(items).toContainText('ALPHA')
      await expect(items).toContainText('BETA')
    },
  )

  test('projects 위젯이 결과 없으면 빈 상태를 표시한다', async ({ authenticatedPage: pg }) => {
    await mockHomeChatGeneration(pg, {
      frames: [
        { event: 'done', data: { sessionId: 's-projects-2', widgets: [{ type: 'projects', params: {} }] } },
      ],
    })
    await pg.route(
      (url) => url.pathname === '/api/v1/projects',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(pageOf([])),
        }),
    )

    await pg.goto('/')
    await pg.getByTestId('chat-launcher').click()
    await pg.getByTestId('chat-input').fill('프로젝트 목록 보여줘')
    await pg.getByRole('button', { name: '보내기' }).click()

    await expect(pg.getByTestId('chat-widgets')).toBeVisible()
    await expect(pg.getByTestId('projects-empty')).toBeVisible()
    await expect(pg.getByTestId('projects-empty')).toContainText('프로젝트가 없어요')
  })

  test(
    'project 위젯이 프로젝트 상세와 멤버를 렌더한다',
    { tag: '@smoke' },
    async ({ authenticatedPage: pg }) => {
      // compose → project 위젯(projectKey='ALPHA') 지시.
      await mockHomeChatGeneration(pg, {
        frames: [
          { event: 'done', data: { sessionId: 's-projects-3', widgets: [{ type: 'project', params: { projectKey: 'ALPHA' } }] } },
        ],
      })
      // 프로젝트 상세 API 모킹.
      await pg.route(
        (url) => url.pathname === '/api/v1/projects/ALPHA',
        (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(
              makeProject({ id: 1, key: 'ALPHA', name: '알파 프로젝트', description: '알파 팀 메인 프로젝트' }),
            ),
          }),
      )
      // 멤버 목록 API 모킹.
      await pg.route(
        (url) => url.pathname === '/api/v1/projects/ALPHA/members',
        (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([
              makeMember({ userId: 1, username: 'kim', name: '김멤버', role: 'OWNER' }),
              makeMember({ userId: 2, username: 'park', name: '박개발', role: 'MEMBER' }),
            ]),
          }),
      )

      await pg.goto('/')
      await pg.getByTestId('chat-launcher').click()
      await pg.getByTestId('chat-input').fill('ALPHA 프로젝트 상세 보여줘')
      await pg.getByRole('button', { name: '보내기' }).click()

      await expect(pg.getByTestId('chat-widgets')).toBeVisible()
      const detail = pg.getByTestId('project-detail')
      await expect(detail).toBeVisible()
      await expect(detail).toContainText('알파 프로젝트')
      await expect(detail).toContainText('알파 팀 메인 프로젝트')
      await expect(detail).toContainText('김멤버')
      await expect(detail).toContainText('박개발')
    },
  )

  test('project 위젯 projectKey 누락 시 안내 메시지를 표시한다', async ({ authenticatedPage: pg }) => {
    // compose → project 위젯(projectKey 없음) 지시.
    await mockHomeChatGeneration(pg, {
      frames: [
        { event: 'done', data: { sessionId: 's-projects-4', widgets: [{ type: 'project', params: {} }] } },
      ],
    })

    await pg.goto('/')
    await pg.getByTestId('chat-launcher').click()
    await pg.getByTestId('chat-input').fill('프로젝트 상세 보여줘')
    await pg.getByRole('button', { name: '보내기' }).click()

    await expect(pg.getByTestId('chat-widgets')).toBeVisible()
    const error = pg.getByTestId('project-error')
    await expect(error).toBeVisible()
    await expect(error).toContainText('프로젝트 키가 없습니다')
  })
})
