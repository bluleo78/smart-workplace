// 폼 제출 버튼 로딩 피드백 회귀 테스트 (#131).
// isPending 동안 버튼 텍스트가 "X 중…" 으로 변경되는지 검증.
// API 응답을 인위적으로 지연시켜 loading 상태를 관찰한다.

import type { Page } from '@playwright/test'

import { expect, test } from '../fixtures/auth.fixture'
import { createPageResponse, mockApi } from '../fixtures/api-mock'
import { createProject } from '../factories/project.factory'
import { createIssue, createIssueSearchResponse } from '../factories/issue.factory'
import { systemTypes } from '../factories/issueType.factory'
import { createChannel } from '../factories/messaging.factory'

// 지연 응답 헬퍼 — Promise 가 release 될 때까지 응답을 보류한다.
function deferFulfill(): { release: () => void; promise: Promise<void> } {
  let release!: () => void
  const promise = new Promise<void>((resolve) => { release = resolve })
  return { release, promise }
}

// messaging 사이드바 + SSE 기본 스텁.
async function stubMessaging(page: Page, channels: ReturnType<typeof createChannel>[] = []) {
  await page.route(
    (url) => url.pathname === '/api/v1/messaging/channels',
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(channels),
      })
    },
  )
  await page.route(
    (url) => url.pathname === '/api/v1/events',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'cache-control': 'no-cache' },
        body: ':\n\n',
      }),
  )
}

test.describe('폼 제출 버튼 로딩 텍스트 표시 (#131)', () => {
  // 대표 케이스 1: IssueCreateDialog — "생성" → "생성 중…"
  test('IssueCreateDialog 제출 중 버튼 텍스트가 "생성 중…" 으로 변경된다', async ({
    authenticatedPage: page,
  }) => {
    // 프로젝트 목록 / 상세 / 이슈 목록 스텁.
    await mockApi(page, 'GET', '/api/v1/projects', createPageResponse([createProject()]))
    await mockApi(page, 'GET', '/api/v1/projects/WP', createProject())
    await mockApi(
      page,
      'GET',
      '/api/v1/projects/WP/issues',
      createIssueSearchResponse([createIssue({ title: '기존 이슈' })]),
    )
    // 이슈 유형 스텁 (IssueCreateDialog 에서 /types 를 페치함).
    await page.route(
      (url) => url.pathname === '/api/v1/projects/WP/types',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(systemTypes()),
        }),
    )
    // 라벨 / 싸이클 등 기타 페치는 빈 목록으로 fallback 처리.
    await page.route('**/api/v1/projects/WP/**', (route) => {
      if (route.request().method() === 'GET' && !route.request().url().includes('/issues')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
      }
      return route.fallback()
    })

    // 지연 응답 등록 — 이슈 생성 POST 를 보류한다.
    const { release, promise: waitForRelease } = deferFulfill()
    await page.route(
      (url) => url.pathname === '/api/v1/projects/WP/issues',
      async (route) => {
        if (route.request().method() !== 'POST') return route.fallback()
        await waitForRelease // 응답 보류
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(createIssue({ title: '새 이슈' })),
        })
      },
    )

    await page.goto('/projects/WP')
    await page.getByRole('button', { name: '+ 새 태스크' }).click()
    await page.getByLabel('제목').fill('새 이슈')
    await page.getByRole('button', { name: '생성' }).click()

    // 로딩 중 텍스트 확인.
    await expect(page.getByRole('button', { name: '생성 중…' })).toBeVisible()
    await expect(page.getByRole('button', { name: '생성 중…' })).toBeDisabled()

    // 응답 해제.
    release()
  })

  // 대표 케이스 2: CreateChannelModal — "만들기" → "생성 중…"
  test('CreateChannelModal 제출 중 버튼 텍스트가 "생성 중…" 으로 변경된다', async ({
    authenticatedPage: page,
  }) => {
    await stubMessaging(page, [])

    // 생성 후 이동할 채널 상세 스텁.
    const created = createChannel({ id: 9, name: '테스트채널', visibility: 'PUBLIC', role: 'OWNER' })
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/channels/9',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(created),
        }),
    )
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/channels/9/messages',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ items: [], nextCursor: null, hasMore: false }),
        }),
    )
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/channels/9/members',
      (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )

    // 지연 응답 — 채널 생성 POST 를 보류한다.
    const { release, promise: waitForRelease } = deferFulfill()
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/channels',
      async (route) => {
        if (route.request().method() !== 'POST') return route.fallback()
        await waitForRelease
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(created),
        })
      },
    )

    await page.goto('/chat')
    await page.getByTestId('channel-create-btn').click()
    await page.getByTestId('create-channel-name').fill('테스트채널')
    await page.getByTestId('create-channel-submit').click()

    // 로딩 중 텍스트 확인.
    await expect(page.getByTestId('create-channel-submit')).toHaveText('생성 중…')
    await expect(page.getByTestId('create-channel-submit')).toBeDisabled()

    // 응답 해제.
    release()
  })

  // 대표 케이스 3: RenameChannelModal — "저장" → "저장 중…"
  test('RenameChannelModal 제출 중 버튼 텍스트가 "저장 중…" 으로 변경된다', async ({
    authenticatedPage: page,
  }) => {
    const ch = createChannel({ id: 5, name: '기존채널', visibility: 'PUBLIC', role: 'OWNER', member: true })
    // 사이드바 + SSE 스텁.
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/channels',
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([ch]) })
          : route.fallback(),
    )
    await page.route(
      (url) => url.pathname === '/api/v1/events',
      (route) =>
        route.fulfill({ status: 200, contentType: 'text/event-stream', headers: { 'cache-control': 'no-cache' }, body: ':\n\n' }),
    )

    // 메시지 목록 스텁.
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/channels/5/messages',
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], nextCursor: null, hasMore: false }) })
          : route.fallback(),
    )

    // 지연 응답 — 이름 변경 PATCH 를 보류하고 GET 은 바로 반환.
    const { release, promise: waitForRelease } = deferFulfill()
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/channels/5',
      async (route) => {
        if (route.request().method() === 'GET') {
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ch) })
        }
        if (route.request().method() === 'PATCH') {
          await waitForRelease
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...ch, name: '변경채널' }) })
        }
        return route.fallback()
      },
    )

    await page.goto('/chat/channels/5')

    // 이름 변경 모달 열기 — 설정 드롭다운 → 이름 변경 액션.
    await page.getByTestId('channel-settings-btn').click()
    await page.getByTestId('channel-rename-action').click()
    await page.getByTestId('rename-channel-name').fill('변경채널')
    await page.getByTestId('rename-channel-submit').click()

    // 로딩 중 텍스트 확인.
    await expect(page.getByTestId('rename-channel-submit')).toHaveText('저장 중…')
    await expect(page.getByTestId('rename-channel-submit')).toBeDisabled()

    // 응답 해제.
    release()
  })
})
