// 모바일 메일 작성(WP-583) — 데스크톱용 작은 도크를 줄인 모양 대신, 다른 메일 앱처럼 처음부터 화면 전체 작성 화면.
// 상단 바 [✕ 닫기] 제목(새 메일/회신/전달) … [➤ 보내기], 최소화·확대 없음, 서식 버튼은 화면 맨 아래.
import type { Page } from '@playwright/test'

import { detail, mailAccount, summary } from '../../factories/mail.factory'
import { mockApi } from '../../fixtures/api-mock'
import { trackRequests } from '../../fixtures/requests'
import { expect, expectNoHorizontalOverflow, expectOnTop, test } from '../../fixtures/mobile.fixture'

/** 메일 목록·상세를 모킹하고 받은편지함을 연다. */
async function openInbox(page: Page) {
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/messages', [summary()])
  await mockApi(page, 'GET', '/api/v1/mail/messages/10', detail())
  await page.goto('/mail/1')
}

/** 작성 화면이 뷰포트 전체(탭바 포함)를 덮는지. */
async function expectFullScreen(page: Page) {
  const dock = page.getByTestId('mail-compose-dock')
  await expect(dock).toBeVisible()
  const vp = page.viewportSize()!
  const box = (await dock.boundingBox())!
  expect(box.x).toBe(0)
  expect(box.y).toBe(0)
  expect(Math.round(box.width)).toBe(vp.width)
  expect(Math.round(box.height)).toBe(vp.height)
}

test('편지쓰기 → 화면 전체 새 메일 화면, 상단 보내기로 발송하면 닫힌다', async ({ authenticatedPage: page }) => {
  const sends = trackRequests(page, 'ANY', '/api/v1/mail/accounts/1/send')
  await page.route(
    (url) => url.pathname === '/api/v1/mail/accounts/1/send',
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ localMessageId: 10, messageId: 'x@test.local' }) }),
  )
  await openInbox(page)
  await page.getByTestId('mobile-sidebar-trigger').click()
  const sheet = page.getByTestId('mobile-sidebar-sheet')
  await sheet.getByTestId('mail-compose-new').click()
  // 편지쓰기를 누르면 시트는 닫힌다(WP-578) — 아직 열려 있으면 Esc 로 닫는다.
  if (await sheet.isVisible()) await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()

  await expectFullScreen(page)
  const dock = page.getByTestId('mail-compose-dock')
  await expect(dock.getByRole('heading', { name: '새 메일' })).toBeVisible()
  // 모바일엔 최소화·확대가 없고, 동작하지 않는 첨부 버튼도 노출하지 않는다.
  await expect(dock.getByRole('button', { name: '최소화' })).toHaveCount(0)
  await expect(dock.getByRole('button', { name: '크게 보기' })).toHaveCount(0)
  await expect(dock.getByRole('button', { name: '첨부' })).toHaveCount(0)
  // 탭바는 작성 화면 아래에 깔린다.
  await expect(page.getByTestId('mail-compose-send')).toHaveCount(1)
  await expectNoHorizontalOverflow(page)

  await page.getByTestId('mail-compose-to').fill('rcpt@test.local')
  await page.getByTestId('mail-compose-subject').fill('모바일 제목')
  await page.getByTestId('mail-composer-body').click()
  await page.keyboard.type('모바일 본문')

  // 보내기는 상단 바에 있다(본문 아래가 아니라).
  const send = page.getByTestId('mail-compose-send')
  const sendBox = (await send.boundingBox())!
  expect(sendBox.y).toBeLessThan(60)
  expect(sendBox.width).toBeGreaterThanOrEqual(44)
  await send.click()
  await sends.waitFor()
  const body = sends.lastBody<{ to: string[]; subject: string; bodyText: string }>()!
  expect(body.to).toEqual(['rcpt@test.local'])
  expect(body.subject).toBe('모바일 제목')
  expect(body.bodyText).toContain('모바일 본문')
  await expect(dock).toHaveCount(0)
})

test('회신은 제목이 「회신」, 쓴 내용이 없으면 ✕ 로 바로 닫는다', async ({ authenticatedPage: page }) => {
  await openInbox(page)
  await page.getByTestId('mail-row-10').click()
  await page.getByTestId('mail-reply').click()
  await expectFullScreen(page)
  const dock = page.getByTestId('mail-compose-dock')
  await expect(dock.getByRole('heading', { name: '회신' })).toBeVisible()
  // 인용된 원문은 그대로 붙는다.
  await expect(dock.getByTestId('mail-compose-quote')).toBeVisible()
  await page.getByTestId('mail-compose-close').click()
  await expect(dock).toHaveCount(0)
})

test('쓴 내용이 없으면 시스템 뒤로가기는 묻지 않고 작성 화면만 닫고 보던 메일에 머문다', async ({ authenticatedPage: page }) => {
  await openInbox(page)
  await page.getByTestId('mail-row-10').click()
  const url = page.url()
  await page.getByTestId('mail-reply').click()
  await expectFullScreen(page)
  await page.goBack()
  await expect(page.getByTestId('mail-compose-dock')).toHaveCount(0)
  expect(page.url()).toBe(url)
  await expect(page.getByTestId('mail-reply')).toBeVisible()
})

test('쓴 내용이 있으면 시스템 뒤로가기·✕ 는 버릴지 묻는다 — 계속 작성하면 그대로, 버리면 닫히고 보던 메일에 머문다', async ({ authenticatedPage: page }) => {
  await openInbox(page)
  await page.getByTestId('mail-row-10').click()
  const url = page.url()
  await page.getByTestId('mail-reply').click()
  await expectFullScreen(page)
  await page.getByTestId('mail-composer-body').click()
  await page.keyboard.type('길게 쓴 답장')

  // 뒤로가기 → 확인창, 계속 작성 → 작성 화면과 내용 그대로.
  await page.goBack()
  const confirm = page.getByTestId('mail-compose-discard-dialog')
  await expect(confirm).toBeVisible()
  await expectOnTop(page, confirm, '[data-testid="mail-compose-discard-dialog"]')
  await page.getByTestId('mail-compose-discard-keep').click()
  await expect(confirm).toBeHidden()
  await expect(page.getByTestId('mail-composer-body')).toContainText('길게 쓴 답장')

  // ✕ 도 같은 확인창.
  await page.getByTestId('mail-compose-close').click()
  await expect(confirm).toBeVisible()
  await page.getByTestId('mail-compose-discard-keep').click()
  await expect(page.getByTestId('mail-compose-dock')).toBeVisible()

  // 다시 뒤로가기 → 버리기 → 닫히고 보던 메일 그대로. 다음 뒤로가기가 헛돌지 않게 표식도 남지 않는다.
  await page.goBack()
  await expect(confirm).toBeVisible()
  await page.getByTestId('mail-compose-discard-confirm').click()
  await expect(page.getByTestId('mail-compose-dock')).toHaveCount(0)
  expect(page.url()).toBe(url)
  await expect(page.getByTestId('mail-reply')).toBeVisible()
  expect(await page.evaluate(() => JSON.stringify(history.state?.usr ?? null))).not.toContain('mailCompose')
})

test('받는사람만 고쳐도 쓴 내용으로 본다 — ✕ 가 버릴지 묻는다', async ({ authenticatedPage: page }) => {
  await openInbox(page)
  await page.getByTestId('mail-row-10').click()
  await page.getByTestId('mail-reply').click()
  await page.getByTestId('mail-compose-to').fill('other@test.local')
  await page.getByTestId('mail-compose-close').click()
  await expect(page.getByTestId('mail-compose-discard-dialog')).toBeVisible()
  await page.getByTestId('mail-compose-discard-confirm').click()
  await expect(page.getByTestId('mail-compose-dock')).toHaveCount(0)
})

test('전달은 제목이 「전달」이다', async ({ authenticatedPage: page }) => {
  await openInbox(page)
  await page.getByTestId('mail-row-10').click()
  await page.getByTestId('mail-forward').click()
  await expectFullScreen(page)
  await expect(page.getByTestId('mail-compose-dock').getByRole('heading', { name: '전달' })).toBeVisible()
})

test('서식 버튼은 화면 맨 아래에 붙는다', async ({ authenticatedPage: page }) => {
  await openInbox(page)
  await page.getByTestId('mail-row-10').click()
  await page.getByTestId('mail-reply').click()
  const toolbar = page.getByTestId('mail-composer-toolbar')
  await expect(toolbar).toBeVisible()
  const t = (await toolbar.boundingBox())!
  expect(Math.round(t.y + t.height)).toBe(page.viewportSize()!.height)
  // 버튼은 손가락으로 누를 만한 크기.
  const bold = (await toolbar.getByRole('button', { name: '굵게' }).boundingBox())!
  expect(bold.height).toBeGreaterThanOrEqual(36)
  // 본문을 길게 써도 글자가 툴바 위로 그려지지 않는다 — 툴바 자리의 맨 위 요소가 툴바다.
  await page.getByTestId('mail-composer-body').click()
  for (let i = 0; i < 40; i++) await page.keyboard.press('Enter')
  await page.keyboard.type('맨 아래 줄')
  await expectOnTop(page, toolbar, '[data-testid="mail-composer-toolbar"]')
})
