// 모바일 첨부 모아보기 출처 칩(WP-1392) — 칩이 6개(전체·이슈·이슈챗·메시지·노트·메일)라 휴대폰 폭에서 넘친다.
// 줄바꿈·화면 밖 잘림 대신 칩 줄만 가로로 스크롤되고 문서는 넘치지 않는지, 끝 칩(메일)까지 닿아 누를 수 있는지는
// jsdom 이 폭·스크롤을 잴 수 없어 브라우저에서 본다(@layout). 칩 → source 쿼리·배지·행 동작은 src/pages/drive/driveAttachmentsView.test.tsx 가 지킨다.
import { personalSpace } from '../../factories/drive.factory'
import { json } from '../../fixtures/mobile-chat'
import { expect, expectNoHorizontalOverflow, test } from '../../fixtures/mobile.fixture'
import { trackRequests } from '../../fixtures/requests'
import { boxOf } from '../../fixtures/layout'

test('휴대폰 폭에서 출처 칩은 한 줄로 가로 스크롤되고 끝 칩(메일)까지 누를 수 있다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.route((u) => u.pathname === '/api/v1/drive/spaces', (r) => r.fulfill(json([personalSpace()])))
  await page.route((u) => u.pathname === '/api/v1/drive/attachments', (r) => r.fulfill(json({ items: [], nextCursor: null })))
  const lists = trackRequests(page, 'ANY', /^\/api\/v1\/drive\/attachments/)
  await page.goto('/drive/attachments')

  const row = page.getByTestId('drive-attachment-filters')
  const all = page.getByTestId('drive-attachment-filter-all')
  const mail = page.getByTestId('drive-attachment-filter-mail')
  await expect(all).toBeVisible()
  // 칩 줄이 실제로 넘쳐 스크롤 가능한 상태여야 이 회귀를 재현한 것이다.
  await expect.poll(() => row.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  // 줄바꿈 없음 — 첫 칩과 끝 칩이 같은 줄(같은 y)에 있다.
  expect((await boxOf(mail)).y).toBeCloseTo((await boxOf(all)).y, 0)
  // 문서 자체는 가로로 넘치지 않는다(칩 줄 안에서만 스크롤).
  await expectNoHorizontalOverflow(page)
  // 검색 칸이 칩에 밀려 사라지지 않는다.
  expect((await boxOf(page.getByRole('textbox', { name: '파일 이름 검색' }))).width).toBeGreaterThan(80)

  // 끝 칩을 force 없이 누르면(Playwright 가 칩 줄을 스크롤해 닿는다) source=MAIL 로 다시 조회한다.
  await mail.click()
  await expect.poll(() => lists.lastUrl()?.searchParams.get('source')).toBe('MAIL')
  await expect(mail).toHaveAttribute('aria-pressed', 'true')
})
