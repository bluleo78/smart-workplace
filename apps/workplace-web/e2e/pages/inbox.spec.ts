import { mockApi } from '../fixtures/api-mock'
import { expect, test } from '../fixtures/auth.fixture'
import type { NotificationResponse } from '../../src/types/notification'

// 알림 1건 팩토리.
function notif(over: Partial<NotificationResponse> = {}): NotificationResponse {
  return {
    id: 1,
    type: 'COMMENTED',
    actorId: 9,
    actorName: 'AI 동료',
    actorKind: 'AGENT',
    issueId: 7,
    projectKey: 'WP',
    issueNumber: 3,
    issueTitle: '리팩터링',
    commentId: 55,
    eventId: null,
    eventTitle: null,
    eventStartsAt: null,
    read: false,
    createdAt: new Date().toISOString(),
    ...over,
  }
}

test('안읽음 배지가 카운트를 렌더한다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/notifications/unread-count', { count: 3 })
  await page.goto('/')
  await expect(page.getByTestId('inbox-badge')).toHaveText('3')
})

test('패널을 열면 목록을 보여주고, AI 액터에 배지를 단다', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/notifications/unread-count', { count: 1 })
  await mockApi(page, 'GET', '/api/v1/notifications', [notif()])
  await page.goto('/')
  await page.getByTestId('inbox-trigger').click()
  await expect(page.getByTestId('inbox-panel')).toBeVisible()
  const item = page.getByTestId('inbox-item').first()
  await expect(item).toContainText('AI 동료')
  await expect(item).toContainText('WP-3 리팩터링')
  await expect(item).toContainText('AI')
})

test('빈 목록은 아이콘·제목·설명이 있는 빈 상태를 보여준다', async ({ authenticatedPage: page }) => {
  // 디자인 시스템 §2.5 — 아이콘 + 제목 + 설명 4요소 검증
  await mockApi(page, 'GET', '/api/v1/notifications', [])
  await page.goto('/')
  await page.getByTestId('inbox-trigger').click()
  const empty = page.getByTestId('inbox-empty')
  await expect(empty).toBeVisible()
  await expect(empty).toContainText('새 알림이 없습니다')
  await expect(empty).toContainText('이슈 배정, 코멘트, 상태 변경 알림이 여기에 표시됩니다.')
  // Bell SVG 아이콘이 빈 상태 내에 렌더됨
  await expect(empty.locator('svg')).toBeVisible()
})

test('행 클릭 → 읽음 POST + 이슈 상세로 이동', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/notifications/unread-count', { count: 1 })
  await mockApi(page, 'GET', '/api/v1/notifications', [notif()])
  await mockApi(page, 'GET', '/api/v1/projects/WP/issues/3', {}, { status: 200 })
  const readCapture = await mockApi(page, 'POST', '/api/v1/notifications/1/read', {}, {
    status: 204,
    capture: true,
  })
  await page.goto('/')
  await page.getByTestId('inbox-trigger').click()
  await page.getByTestId('inbox-item').first().click()

  await readCapture.waitForRequest()
  await expect(page).toHaveURL(/\/projects\/WP\/issues\/3$/)
})

test('REMINDER 알림은 일정 정보를 렌더하고 클릭 시 캘린더로 이동한다', async ({
  authenticatedPage: page,
}) => {
  await mockApi(page, 'GET', '/api/v1/notifications/unread-count', { count: 1 })
  await mockApi(page, 'GET', '/api/v1/notifications', [
    notif({
      id: 2,
      type: 'REMINDER',
      actorId: null,
      actorName: null,
      actorKind: null,
      commentId: null,
      eventId: 5,
      eventTitle: '팀 회의',
      eventStartsAt: '2026-06-10T01:00:00Z',
    }),
  ])
  await mockApi(page, 'POST', '/api/v1/notifications/2/read', {}, { status: 204 })
  await page.goto('/')
  await page.getByTestId('inbox-trigger').click()
  const item = page.getByTestId('inbox-item').first()
  await expect(item).toContainText('일정 알림')
  await expect(item).toContainText('팀 회의')
  await item.click()
  await expect(page).toHaveURL(/\/calendar$/)
})

test('CALENDAR_INVITED 알림은 크래시 없이 일정 정보를 렌더하고 클릭 시 캘린더로 이동한다 (#585)', async ({
  authenticatedPage: page,
}) => {
  await mockApi(page, 'GET', '/api/v1/notifications/unread-count', { count: 1 })
  await mockApi(page, 'GET', '/api/v1/notifications', [
    notif({
      id: 3,
      type: 'CALENDAR_INVITED',
      actorId: 2,
      actorName: '양동희',
      actorKind: 'HUMAN',
      commentId: null,
      eventId: 6,
      eventTitle: '분기 킥오프',
      eventStartsAt: '2026-07-10T01:00:00Z',
    }),
  ])
  await mockApi(page, 'POST', '/api/v1/notifications/3/read', {}, { status: 204 })
  await page.goto('/')
  await page.getByTestId('inbox-trigger').click()
  const item = page.getByTestId('inbox-item').first()
  await expect(item).toContainText('양동희')
  await expect(item).toContainText('일정에 초대했습니다')
  await expect(item).toContainText('분기 킥오프')
  await item.click()
  await expect(page).toHaveURL(/\/calendar$/)
})

test('PRIORITY_CHANGED 알림은 상태 변경과 대칭적으로 렌더되고 이슈 상세로 이동한다 (#613)', async ({
  authenticatedPage: page,
}) => {
  await mockApi(page, 'GET', '/api/v1/notifications/unread-count', { count: 1 })
  await mockApi(page, 'GET', '/api/v1/notifications', [
    notif({
      id: 4,
      type: 'PRIORITY_CHANGED',
      actorId: 2,
      actorName: '양동희',
      actorKind: 'HUMAN',
      commentId: null,
    }),
  ])
  await mockApi(page, 'GET', '/api/v1/projects/WP/issues/3', {}, { status: 200 })
  await mockApi(page, 'POST', '/api/v1/notifications/4/read', {}, { status: 204 })
  await page.goto('/')
  await page.getByTestId('inbox-trigger').click()
  const item = page.getByTestId('inbox-item').first()
  await expect(item).toContainText('양동희')
  await expect(item).toContainText('우선순위를 변경했습니다')
  await item.click()
  await expect(page).toHaveURL(/\/projects\/WP\/issues\/3$/)
})

test('"모두 읽음" → read-all POST', async ({ authenticatedPage: page }) => {
  // unread-count 가 1 이상이어야 버튼이 활성화됨
  await mockApi(page, 'GET', '/api/v1/notifications/unread-count', { count: 1 })
  await mockApi(page, 'GET', '/api/v1/notifications', [notif()])
  const allCapture = await mockApi(page, 'POST', '/api/v1/notifications/read-all', {}, {
    status: 204,
    capture: true,
  })
  await page.goto('/')
  await page.getByTestId('inbox-trigger').click()
  await page.getByTestId('inbox-mark-all').click()
  await allCapture.waitForRequest()
})

test('알림 없을 때 "모두 읽음" 버튼이 비활성화된다 (refs #186)', async ({ authenticatedPage: page }) => {
  // 알림 목록이 비어있을 때 버튼 disabled 검증
  await mockApi(page, 'GET', '/api/v1/notifications/unread-count', { count: 0 })
  await mockApi(page, 'GET', '/api/v1/notifications', [])
  await page.goto('/')
  await page.getByTestId('inbox-trigger').click()
  await expect(page.getByTestId('inbox-empty')).toBeVisible()
  await expect(page.getByTestId('inbox-mark-all')).toBeDisabled()
})

test('모두 읽음 상태일 때(unread=0, 목록 있음) "모두 읽음" 버튼이 비활성화된다 (refs #186)', async ({ authenticatedPage: page }) => {
  // 이미 읽은 알림만 있을 때 버튼 disabled 검증
  await mockApi(page, 'GET', '/api/v1/notifications/unread-count', { count: 0 })
  await mockApi(page, 'GET', '/api/v1/notifications', [notif({ read: true })])
  await page.goto('/')
  await page.getByTestId('inbox-trigger').click()
  await expect(page.getByTestId('inbox-mark-all')).toBeDisabled()
})

// #610 — 20건 상한 해소: 스크롤이 바닥에 닿으면 offset 다음 페이지를 요청하고, 응답이 기존 목록에 이어붙는다.
test('패널 바닥까지 스크롤하면 offset 다음 페이지를 요청해 추가 알림을 이어붙인다 (#610)', async ({
  authenticatedPage: page,
}) => {
  const page1 = Array.from({ length: 20 }, (_, i) => notif({ id: 20 - i, issueNumber: 20 - i }))
  const page2 = Array.from({ length: 5 }, (_, i) => notif({ id: 100 - i, issueNumber: 100 - i }))

  await mockApi(page, 'GET', '/api/v1/notifications/unread-count', { count: 25 })
  // pathname 만 매칭하는 mockApi 대신 offset 쿼리로 분기해야 하므로 route 를 직접 건다.
  await page.route(
    (url) => url.pathname === '/api/v1/notifications',
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      const url = new URL(route.request().url())
      const offset = url.searchParams.get('offset')
      const body = offset === '20' ? page2 : page1
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    },
  )

  await page.goto('/')
  await page.getByTestId('inbox-trigger').click()
  await expect(page.getByTestId('inbox-item')).toHaveCount(20)

  // 바닥까지 스크롤 → 다음 페이지 로드 트리거
  await page.getByTestId('inbox-scroll-area').evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })

  await expect(page.getByTestId('inbox-item')).toHaveCount(25)
  // 두 번째 페이지의 첫 항목(issueNumber 100, 21번째 행)이 실제로 이어붙었는지 확인 — 요소 존재만이 아닌 데이터 파이프라인 검증.
  await expect(page.getByTestId('inbox-item').nth(20)).toContainText('WP-100')
  await expect(page.getByTestId('inbox-item').last()).toContainText('WP-96')
})
