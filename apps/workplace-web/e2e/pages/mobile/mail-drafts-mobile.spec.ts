// 모바일 메일 임시저장(WP-577) — ☰ 시트의 임시보관함, 화면 전체 작성 화면의 저장 상태(제목 아래)·🗑 버리기(📎 왼쪽, 44px),
// 시스템 뒤로가기는 묻지 않고 남은 저장을 마친 뒤 닫는다. 디바운스는 page.clock 으로만 넘긴다.
import { draftDetail, mailAccount } from '../../factories/mail.factory'
import { mockApi } from '../../fixtures/api-mock'
import { mockDraftServer } from '../../fixtures/mail-drafts-mock'
import { expect, expectNoHorizontalOverflow, test } from '../../fixtures/mobile.fixture'

const DEBOUNCE = 1500

test.beforeEach(async ({ authenticatedPage: page }) => {
  await page.clock.install()
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/messages', [])
})

test('☰ 시트의 임시보관함(개수) → 목록 → 행을 누르면 화면 전체 작성, 고친 뒤 뒤로가기는 저장하고 목록으로', async ({ authenticatedPage: page }) => {
  const server = await mockDraftServer(page, [draftDetail({ id: 7, subject: '모바일 임시저장', bodyHtml: '<p>쓰다 만 본문</p>' })], { 7: '쓰다 만 본문' })
  await page.goto('/mail/1')
  await page.getByTestId('mobile-sidebar-trigger').click()
  const sheet = page.getByTestId('mobile-sidebar-sheet')
  await expect(sheet.getByTestId('mail-count-drafts')).toHaveText('1')
  await sheet.getByTestId('mail-folder-drafts').click()
  if (await sheet.isVisible()) await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  await expect(page).toHaveURL(/folder=drafts/)

  const row = page.getByTestId('mail-draft-row-7')
  await expect(row).toContainText('모바일 임시저장')
  await expect(row).toContainText('쓰다 만 본문')
  await expectNoHorizontalOverflow(page)
  const listUrl = page.url()

  await row.click()
  const dock = page.getByTestId('mail-compose-dock')
  await expect(dock).toBeVisible()
  // 저장 상태는 제목 아래 한 줄
  const heading = dock.getByRole('heading', { name: '새 메일' })
  const status = page.getByTestId('mail-compose-save-status')
  await expect(status).toHaveText('저장됨')
  expect((await status.boundingBox())!.y).toBeGreaterThan((await heading.boundingBox())!.y)

  // 쓰는 사이·뒤로가기 전에 디바운스가 실제 시간으로 지나 저장하지 않게 멈춘다(저장이 둘로 나뉘거나 「저장됨」이 먼저 보인다)
  await page.clock.pauseAt(Date.now() + 1000)
  await page.getByTestId('mail-composer-body').click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type(' 이어서 씀')
  await expect(status).toHaveText('저장 중…')

  // 디바운스를 기다리지 않고 뒤로가기 — 바로 PUT 하고 닫힌다.
  await page.goBack()
  await expect(dock).toHaveCount(0)
  await server.puts.waitFor()
  expect(server.puts.lastBody()).toMatchObject({ version: 1 })
  expect(server.puts.lastBody<{ bodyText: string }>()!.bodyText).toContain('쓰다 만 본문 이어서 씀')
  // 토스트·목록 갱신은 앱 타이머를 쓴다
  await page.clock.resume()
  await expect(page.getByText('임시보관함에 저장했어요')).toBeVisible()
  expect(page.url()).toBe(listUrl)
  await expect(row).toContainText('쓰다 만 본문 이어서 씀')
  await page.clock.runFor(DEBOUNCE * 2)
  expect(server.puts.count()).toBe(1)
})

test('긴 저장 안내(충돌)는 상단 바 아이콘 위로 넘치지 않고 글만 말줄임 — 「다시 불러오기」는 그대로 보인다', async ({ authenticatedPage: page }) => {
  const server = await mockDraftServer(page, [draftDetail({ id: 7, mode: 'reply', subject: 'Re: 예산안' })])
  await page.goto('/mail/1?folder=drafts')
  await page.getByTestId('mail-draft-row-7').click()
  await expect(page.getByTestId('mail-compose-subject')).toHaveValue('Re: 예산안')
  server.bumpVersion(7, { subject: '다른 탭' })
  await page.getByTestId('mail-compose-subject').fill('Re: 예산안 (고침)')
  await page.clock.runFor(DEBOUNCE)
  const status = page.getByTestId('mail-compose-save-status')
  await expect(status).toHaveAttribute('data-status', 'conflict')
  await expect(status).toContainText('다른 곳에서 고친 내용이 있어요')

  const s = (await status.boundingBox())!
  const d = (await page.getByTestId('mail-compose-discard').boundingBox())!
  expect(s.x + s.width).toBeLessThanOrEqual(d.x)
  const reload = page.getByTestId('mail-compose-save-reload')
  await expect(reload).toBeVisible()
  const r = (await reload.boundingBox())!
  expect(r.x + r.width).toBeLessThanOrEqual(d.x)
  // 「다시 불러오기」의 투명 터치 영역이 🗑 가장자리를 덮지 않는다 — 🗑 왼쪽 끝을 눌러도 🗑 가 받는다(내 고친 내용을 버리는 오탭 방지)
  const hit = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-testid]')?.getAttribute('data-testid'),
    { x: d.x + 2, y: d.y + d.height / 2 },
  )
  expect(hit).toBe('mail-compose-discard')
})

test('저장 검증 오류는 모바일에선 원인만 빨간 글씨로 잘리지 않게 보이고, 낭독·title 에는 전체 문구가 남는다', async ({ authenticatedPage: page }) => {
  await mockDraftServer(page)
  await page.route(
    (u) => u.pathname === '/api/v1/mail/drafts',
    (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 400, json: { status: 400, message: '받는사람이 너무 많아요' } })
        : route.fallback(),
  )
  await page.goto('/mail/1')
  await page.getByTestId('mobile-sidebar-trigger').click()
  const sheet = page.getByTestId('mobile-sidebar-sheet')
  await sheet.getByTestId('mail-compose-new').click()
  if (await sheet.isVisible()) await page.keyboard.press('Escape')
  await page.getByTestId('mail-compose-subject').fill('검증 실패 메일')
  await page.clock.runFor(DEBOUNCE)
  const status = page.getByTestId('mail-compose-save-status')
  await expect(status).toHaveAttribute('data-status', 'invalid')
  // 낭독(텍스트)·title 은 전체 문구
  await expect(status).toHaveText('저장하지 못했어요 · 받는사람이 너무 많아요')
  await expect(status).toHaveAttribute('title', '저장하지 못했어요 · 받는사람이 너무 많아요')
  // 화면에 보이는 글은 원인만, 말줄임 없이
  const visible = status.locator('span.truncate')
  await expect(visible).toHaveText('받는사람이 너무 많아요')
  expect(await visible.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  await expect(status.locator('span.sr-only')).toHaveText(/저장하지 못했어요/)
})

test('🗑 버리기는 상단 바 📎 왼쪽 44px — 누르면 DELETE 하고 「되돌리기」로 다시 연다', async ({ authenticatedPage: page }) => {
  const server = await mockDraftServer(page)
  await page.goto('/mail/1')
  await page.getByTestId('mobile-sidebar-trigger').click()
  const sheet = page.getByTestId('mobile-sidebar-sheet')
  await sheet.getByTestId('mail-compose-new').click()
  if (await sheet.isVisible()) await page.keyboard.press('Escape')

  const discard = page.getByTestId('mail-compose-discard')
  const attach = page.getByTestId('mail-compose-attach')
  const d = (await discard.boundingBox())!
  const a = (await attach.boundingBox())!
  expect(d.x + d.width).toBeLessThanOrEqual(a.x + 1)
  expect(d.width).toBeGreaterThanOrEqual(44)
  expect(d.height).toBeGreaterThanOrEqual(44)
  expect(d.y).toBeLessThan(60)

  await page.getByTestId('mail-compose-subject').fill('모바일에서 버릴 메일')
  await page.clock.runFor(DEBOUNCE)
  await server.posts.waitFor()
  await expect(page.getByTestId('mail-compose-save-status')).toHaveText('저장됨')

  await discard.click()
  await expect(page.getByTestId('mail-compose-dock')).toHaveCount(0)
  await server.deletes.waitFor()
  expect(server.drafts.size).toBe(0)
  await page.getByRole('button', { name: '되돌리기' }).click()
  await server.posts.waitFor(2)
  await expect(page.getByTestId('mail-compose-dock')).toBeVisible()
  await expect(page.getByTestId('mail-compose-subject')).toHaveValue('모바일에서 버릴 메일')
})
