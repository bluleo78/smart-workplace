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

test('"모두 읽음" → read-all POST', async ({ authenticatedPage: page }) => {
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
