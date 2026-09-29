// WP-36/WP-64 — 알림·연락처·메일 resource.changed 실시간 반영 E2E.
// /api/v1/events 를 게이트 모킹해 프레임을 첫 렌더 *뒤에* 흘려보내고, 재조회로 화면이 바뀌는지 본다.
import { external, member, page as makePage } from '../factories/contacts.factory'
import { mailAccount, summary as mailSummary } from '../factories/mail.factory'
import { mockApi } from '../fixtures/api-mock'
import { expect, test } from '../fixtures/auth.fixture'
import { mockGatedEvents, resourceChangedFrame } from '../fixtures/gatedEvents'

// 서버 ResourceSseDispatcher 가 보내는 resource.changed 프레임.
function frame(data: Record<string, unknown>) {
  return resourceChangedFrame({ scopeType: 'USER', scopeId: 1, ids: [], actorId: 99, ...data })
}

test.describe('알림·연락처·메일 실시간 반영 (WP-64)', () => {
  test('알림 읽음 이벤트 — 안읽음 배지가 사라진다', async ({ authenticatedPage: page }) => {
    let count = 3
    await page.route(
      (url) => url.pathname === '/api/v1/notifications/unread-count',
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ count }) }),
    )
    const events = await mockGatedEvents(page)

    await page.goto('/')
    await expect(page.getByTestId('inbox-badge')).toHaveText('3')

    count = 0
    events.deliver(frame({ resource: 'notification', op: 'updated' }))

    await expect(page.getByTestId('inbox-badge')).toHaveCount(0)
  })

  // WP-83 — 초대 일정이 지워지면 알림 행이 cascade 로 사라지지만 notification 이벤트는 오지 않는다.
  // calendar-event deleted 프레임만으로도 배지가 다시 조회돼 사라져야 한다.
  test('일정 삭제 이벤트 — cascade 로 지워진 알림의 배지가 사라진다', async ({ authenticatedPage: page }) => {
    let count = 1
    await page.route(
      (url) => url.pathname === '/api/v1/notifications/unread-count',
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ count }) }),
    )
    const events = await mockGatedEvents(page)

    await page.goto('/')
    await expect(page.getByTestId('inbox-badge')).toHaveText('1')

    count = 0
    events.deliver(frame({ resource: 'calendar-event', op: 'deleted', ids: [77] }))

    await expect(page.getByTestId('inbox-badge')).toHaveCount(0)
  })

  test('연락처 생성 이벤트 — 새 연락처 행이 나타난다', async ({ authenticatedPage: page }) => {
    let items = [member()]
    await page.route(
      (url) => url.pathname === '/api/v1/contacts',
      (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(makePage(items)) }),
    )
    await page.route(
      (url) => url.pathname === '/api/v1/contacts/facets',
      (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ organizations: [], titles: [] }) }),
    )
    const events = await mockGatedEvents(page)

    await page.goto('/contacts')
    await expect(page.getByTestId('contact-row-MEMBER-1')).toBeVisible()
    await expect(page.getByTestId('contact-row-EXTERNAL-100')).toHaveCount(0)

    items = [member(), external()]
    events.deliver(frame({ resource: 'contact', op: 'created', ids: [100] }))

    await expect(page.getByTestId('contact-row-EXTERNAL-100')).toBeVisible()
  })

  test('메일 회신필요 처리 이벤트 — 회신필요 목록에서 행이 사라진다', async ({ authenticatedPage: page }) => {
    let rows = [mailSummary({ id: 10, subject: '검토 요청', aiCategory: '업무', aiNeedsReply: true })]
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount({ aiEnabled: true })])
    await mockApi(page, 'GET', '/api/v1/mail/accounts/1/sync-status', { running: false })
    await mockApi(page, 'GET', '/api/v1/mail/accounts/1/needs-reply-count', { count: 1 })
    await page.route(
      (url) => url.pathname === '/api/v1/mail/accounts/1/messages',
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) }),
    )
    const events = await mockGatedEvents(page)

    await page.goto('/mail/1?needsReply=true')
    await expect(page.getByTestId('mail-row-10')).toBeVisible()

    rows = []
    events.deliver(frame({ resource: 'mail', op: 'updated', ids: [10], accountId: 1, messageId: 10 }))

    await expect(page.getByTestId('mail-row-10')).toHaveCount(0)
  })
})
