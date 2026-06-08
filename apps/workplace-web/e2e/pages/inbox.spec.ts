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

test('빈 목록은 안내 문구를 보여준다', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/notifications', [])
  await page.goto('/')
  await page.getByTestId('inbox-trigger').click()
  await expect(page.getByTestId('inbox-empty')).toHaveText('새 알림이 없습니다')
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
