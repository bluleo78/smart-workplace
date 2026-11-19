// 모바일 메일 예약 보내기(WP-1787) — 390px 에서 「예약됨」 목록 행이 가로로 넘치지 않고, 쓰기 화면 ⋯ → 「예약 보내기」 시트가 화면 안에 든다.
// 목록·⋯ 메뉴·취소·바로 보내기 동작은 src/pages/mail/mailScheduled.test.tsx 가 지킨다(여기서는 브라우저 레이아웃만).
// 모바일 스펙은 mobile 프로젝트(iPhone 13, 390pt)에서만 돈다 — pages/mobile/ 에 둔다.
import { draftDetail, mailAccount } from '../../factories/mail.factory'
import { mockApi } from '../../fixtures/api-mock'
import { mockDraftServer } from '../../fixtures/mail-drafts-mock'
import { expect, expectNoHorizontalOverflow, test } from '../../fixtures/mobile.fixture'

test.beforeEach(async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/messages', [])
})

test('「예약됨」 목록의 긴 받는 사람·제목 행이 390px 에서 가로로 넘치지 않는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/mail/drafts/count', { count: 0, queued: 0, scheduled: 2 })
  await mockApi(page, 'GET', '/api/v1/mail/drafts/scheduled', [
    {
      id: 21, accountId: 1, mode: 'new', to: ['아주아주긴이름의받는사람 <long-recipient-address@example.com>', 'b@example.com', 'c@example.com'],
      subject: '아주 긴 제목의 예약 메일입니다 — 줄이 넘치면 말줄임으로 잘려야 합니다 가로 스크롤이 생기면 안 됩니다',
      preview: '미리보기 본문도 아주 길어서 한 줄을 훌쩍 넘기는 경우에도 말줄임으로 잘려야 합니다 가로 스크롤이 생기면 안 됩니다',
      attachmentCount: 2, updatedAt: '2030-01-01T00:00:00Z', sendAt: '2031-03-02T00:00:00Z',
    },
    { id: 22, accountId: 1, mode: 'new', to: ['x@example.com'], subject: '짧은 제목', preview: '', attachmentCount: 0, updatedAt: '2030-01-01T00:00:00Z', sendAt: '2031-03-03T00:00:00Z' },
  ])
  await page.goto('/mail/1?folder=scheduled')
  const rows = page.getByTestId('mail-scheduled-row')
  await expect(rows).toHaveCount(2)
  await expectNoHorizontalOverflow(page)
  // 각 행도 자기 폭을 넘지 않는다(안쪽 넘침이 가려져도 잡도록 행 자체를 잰다).
  for (const row of await rows.all()) {
    expect(await row.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  }
})

test('쓰기 화면 ⋯ → 「예약 보내기」 시트의 항목이 화면 안에 든다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await mockDraftServer(page, [draftDetail({ id: 7, subject: '예약할 메일', to: ['rcpt@test.local'], bodyHtml: '<p>본문</p>' })], { 7: '본문' })
  await page.goto('/mail/1?folder=drafts')
  await page.getByTestId('mail-draft-row-7').click()
  await page.getByTestId('mail-compose-schedule-trigger').click()
  await page.getByRole('menuitem', { name: '예약 보내기' }).click()
  const sheet = page.getByTestId('mail-schedule-sheet')
  await expect(sheet).toBeVisible()
  const view = page.viewportSize()!
  const box = (await sheet.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(view.width)
  expect(box.y + box.height).toBeLessThanOrEqual(view.height)
  for (const id of ['mail-schedule-preset-tomorrow', 'mail-schedule-custom']) {
    const b = (await page.getByTestId(id).boundingBox())!
    expect(b.x).toBeGreaterThanOrEqual(0)
    expect(b.x + b.width).toBeLessThanOrEqual(view.width)
    expect(b.y + b.height).toBeLessThanOrEqual(view.height)
  }
})
