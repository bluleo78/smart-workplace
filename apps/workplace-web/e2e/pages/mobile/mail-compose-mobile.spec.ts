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
  // 모바일엔 최소화·확대가 없다. 파일 첨부(WP-574)는 상단 바 보내기 왼쪽에 있다.
  await expect(dock.getByRole('button', { name: '최소화' })).toHaveCount(0)
  await expect(dock.getByRole('button', { name: '크게 보기' })).toHaveCount(0)
  await expect(dock.getByRole('button', { name: '파일 첨부' })).toHaveCount(1)
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

test('쓴 내용이 있으면 시스템 뒤로가기는 묻지 않고 임시저장한 뒤 닫고 보던 메일에 머문다(WP-577)', async ({ authenticatedPage: page }) => {
  await openInbox(page)
  await page.getByTestId('mail-row-10').click()
  const url = page.url()
  const draftPosts = trackRequests(page, 'POST', '/api/v1/mail/drafts')
  await page.getByTestId('mail-reply').click()
  await expectFullScreen(page)
  await page.getByTestId('mail-composer-body').click()
  await page.keyboard.type('길게 쓴 답장')

  // 뒤로가기 → 확인창 없이 남은 저장을 마치고 닫힌다. 보던 메일 그대로, 다음 뒤로가기가 헛돌지 않게 표식도 남지 않는다.
  await page.goBack()
  await expect(page.getByTestId('mail-compose-dock')).toHaveCount(0)
  await draftPosts.waitFor()
  expect(draftPosts.lastBody()).toMatchObject({ mode: 'reply', sourceMessageId: 10 })
  expect(draftPosts.lastBody<{ bodyText: string }>()!.bodyText).toContain('길게 쓴 답장')
  await expect(page.getByText('임시보관함에 저장했어요')).toBeVisible()
  expect(page.url()).toBe(url)
  await expect(page.getByTestId('mail-reply')).toBeVisible()
  expect(await page.evaluate(() => JSON.stringify(history.state?.usr ?? null))).not.toContain('mailCompose')
})

test('받는사람만 고쳐도 쓴 내용으로 본다 — ✕ 가 임시저장한다', async ({ authenticatedPage: page }) => {
  await openInbox(page)
  await page.getByTestId('mail-row-10').click()
  const draftPosts = trackRequests(page, 'POST', '/api/v1/mail/drafts')
  await page.getByTestId('mail-reply').click()
  // 답장이 채운 받는사람은 칩이다(WP-945) — 빼고 다른 주소를 넣는다.
  await page.getByRole('button', { name: 'alice@example.com 빼기' }).click()
  await page.getByTestId('mail-compose-to').fill('other@test.local')
  await page.getByTestId('mail-compose-close').click()
  await expect(page.getByTestId('mail-compose-dock')).toHaveCount(0)
  await draftPosts.waitFor()
  expect(draftPosts.lastBody()).toMatchObject({ to: ['other@test.local'] })
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

// WP-574 — 모바일 첨부: 상단 바 📎(기본 글자색) → 업로드 중엔 보내기 잠김 + 칩 위 이유 한 줄 → 완료 후 attachmentIds 로 발송.
test('상단 바 📎 로 첨부하면 칩이 본문 아래(서식 줄 위)에 보이고, 다 올라가야 보내기가 열려 attachmentIds 로 보낸다', async ({ authenticatedPage: page }) => {
  let release: (() => void) | undefined
  await page.route(
    (u) => u.pathname === '/api/v1/mail/compose-attachments',
    (route) => {
      release = () =>
        void route.fulfill({
          status: 201,
          json: { id: 501, name: '현장사진.jpg', size: 4, mimeType: 'image/jpeg', expiresAt: '2026-10-21T10:00:00Z' },
        })
    },
  )
  const sends = trackRequests(page, 'POST', '/api/v1/mail/accounts/1/send')
  await page.route(
    (url) => url.pathname === '/api/v1/mail/accounts/1/send',
    (route) => route.fulfill({ status: 200, json: { localMessageId: 10, messageId: 'x@test.local' } }),
  )
  await openInbox(page)
  await page.getByTestId('mail-row-10').click()
  await page.getByTestId('mail-reply').click()
  await expectFullScreen(page)

  // 📎 는 보내기 왼쪽, 주 색(보내기)이 아니라 기본 글자색이다.
  const attach = page.getByRole('button', { name: '파일 첨부' })
  const send = page.getByTestId('mail-compose-send')
  expect((await attach.boundingBox())!.x).toBeLessThan((await send.boundingBox())!.x)
  const color = (el: Element) => getComputedStyle(el).color
  expect(await attach.evaluate(color)).not.toBe(await send.evaluate(color))

  const chooser = page.waitForEvent('filechooser')
  await attach.click()
  await (await chooser).setFiles({ name: '현장사진.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('JPEG') })

  // 올리는 중 — 보내기 잠김, 모바일에서도 이유가 보인다.
  await expect(send).toBeDisabled()
  await expect(page.getByTestId('mail-compose-send-blocked')).toBeVisible()
  await expect(page.getByTestId('mail-compose-send-blocked')).toHaveText(/올리는 중/)
  // 칩 목록은 하단 서식 줄과 겹치지 않는다(스크롤 끝에서 서식 줄 위).
  const chips = page.getByTestId('mail-compose-attachments')
  await chips.scrollIntoViewIfNeeded()
  const c = (await chips.boundingBox())!
  const t = (await page.getByTestId('mail-composer-toolbar').boundingBox())!
  expect(c.y + c.height).toBeLessThanOrEqual(t.y)

  await expect.poll(() => release != null).toBe(true)
  release!()
  await expect(page.locator('[data-testid^="mail-compose-attachment-"][data-status]')).toHaveAttribute('data-status', 'done')
  // 잠금 이유 줄은 사라지고, live 영역은 빈 채로 남는다.
  await expect(page.getByTestId('mail-compose-send-blocked')).toHaveCount(0)
  await expect(page.getByTestId('mail-compose-attachments-status')).toHaveText('')
  await send.click()
  await sends.waitFor()
  expect(sends.lastBody<{ attachmentIds: number[] }>()!.attachmentIds).toEqual([501])
})

// WP-576 — 모바일 새 메일 AI 초안: 하단 서식 툴바 「AI로 쓰기」 → 지시 → 상단 보내기가 생성 중엔 막히고, 끝나면 본문·제목이 채워진다.
test('새 메일 AI 초안 — 하단 툴바에서 열어 생성하면 본문·제목이 채워진다', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount({ aiEnabled: true })])
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/messages', [summary()])
  const drafts = trackRequests(page, 'POST', '/api/v1/mail/accounts/1/compose-draft')
  let release!: () => void
  const held = new Promise<void>((res) => (release = res))
  await page.route(
    (u) => u.pathname === '/api/v1/mail/accounts/1/compose-draft',
    async (route) => {
      await held
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ subject: '회의 변경 요청', body: '안녕하세요.\n\n목요일로 옮겨도 될까요?' }) })
    },
  )
  await page.goto('/mail/1')
  await page.getByTestId('mobile-sidebar-trigger').click()
  const sheet = page.getByTestId('mobile-sidebar-sheet')
  await sheet.getByTestId('mail-compose-new').click()
  if (await sheet.isVisible()) await page.keyboard.press('Escape')
  await expectFullScreen(page)

  await page.getByTestId('mail-compose-to').fill('jihoon@example.com')
  // AI 버튼은 화면 맨 아래 서식 툴바 안 — 44px 터치 높이.
  const open = page.getByTestId('mail-composer-toolbar').getByTestId('mail-ai-compose-open')
  await expectOnTop(page, open, '[data-testid="mail-ai-compose-open"]')
  expect((await open.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await open.click()
  await page.getByTestId('mail-ai-compose-instruction').fill('회의를 목요일로 옮기자고 요청')
  await page.getByTestId('mail-ai-compose-generate').click()
  await expect(page.getByTestId('mail-ai-compose-generating')).toBeVisible()
  await expect(page.getByTestId('mail-compose-send')).toBeDisabled()

  release()
  await drafts.waitFor()
  expect(drafts.lastBody()).toEqual({ instruction: '회의를 목요일로 옮기자고 요청', to: ['jihoon@example.com'], cc: [], subject: null })
  await expect(page.getByTestId('mail-composer-body').locator('p')).toHaveText(['안녕하세요.', '', '목요일로 옮겨도 될까요?'])
  await expect(page.getByTestId('mail-compose-subject')).toHaveValue('회의 변경 요청')
  await expect(page.getByTestId('mail-ai-compose-bar')).toBeVisible()
  await expect(page.getByTestId('mail-compose-send')).toBeEnabled()
})

// UI 리뷰 — 모바일 잠금 이유는 보내기 가까이(상단 바 바로 아래) 한 줄, 꺼진 보내기는 켜진 색과 구분, 칩 ✕·다시 시도·참조/숨은참조·탭은 44px.
test('첨부 때문에 보내기가 잠기면 상단 바 바로 아래 상태 줄로 알리고, 칩·탭·참조 버튼은 44px 터치 크기다', async ({ authenticatedPage: page }) => {
  const held: import('@playwright/test').Route[] = []
  await page.route((u) => u.pathname === '/api/v1/mail/compose-attachments', (route) => {
    held.push(route)
  })
  await openInbox(page)
  await page.getByTestId('mail-row-10').click()
  await page.getByTestId('mail-reply').click()
  await expectFullScreen(page)

  const send = page.getByTestId('mail-compose-send')
  const enabledColor = await send.evaluate((el) => getComputedStyle(el).color)
  // 실패 1(다시 시도 가능) + 올리는 중 1 — 이유는 사용자가 손대야 하는 실패를 고르고, 색도 같은 톤(destructive).
  await page.getByTestId('mail-compose-file-input').setInputFiles([
    { name: '도면.dwg', mimeType: 'application/octet-stream', buffer: Buffer.from('D') },
    { name: '사진.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('J') },
  ])
  await expect.poll(() => held.length).toBe(2)
  await held[0].fulfill({ status: 500, json: { message: 'x' } })

  const statusBar = page.getByTestId('mail-compose-send-blocked')
  await expect(statusBar).toHaveText(/빼거나 다시 시도/)
  await expect(statusBar).toHaveCount(1) // 본문 아래 칩 목록엔 같은 줄을 다시 두지 않는다.
  const header = (await page.locator('[data-testid="mail-compose-dock"] > div').filter({ has: send }).boundingBox())!
  const bar = (await statusBar.boundingBox())!
  expect(Math.abs(bar.y - (header.y + header.height))).toBeLessThanOrEqual(1)
  // 꺼진 보내기는 켜진 주 색과 다른 글자색이다.
  await expect(send).toBeDisabled()
  expect(await send.evaluate((el) => getComputedStyle(el).color)).not.toBe(enabledColor)

  // 44px 터치 크기 — 칩 ✕·다시 시도·참조/숨은참조·작성/AI 검토 탭.
  const failedChip = page.locator('[data-testid^="mail-compose-attachment-upload-"][data-status="error"]')
  const targets = [
    failedChip.getByTestId('mail-compose-attachment-remove'),
    failedChip.getByTestId('mail-compose-attachment-retry'),
    page.getByRole('button', { name: '참조/숨은참조' }),
    page.getByTestId('mail-compose-tabs').getByRole('button', { name: '작성' }),
    page.getByTestId('mail-review-tab'),
  ]
  for (const t of targets) {
    const b = (await t.boundingBox())!
    expect(b.height).toBeGreaterThanOrEqual(44)
  }
  expect((await failedChip.getByTestId('mail-compose-attachment-remove').boundingBox())!.width).toBeGreaterThanOrEqual(44)

  await held[1].fulfill({ status: 201, json: { id: 2, name: '사진.jpg', size: 1, mimeType: 'image/jpeg', expiresAt: '2026-10-22T00:00:00Z' } })
  await failedChip.getByTestId('mail-compose-attachment-remove').click()
  await expect(statusBar).toHaveCount(0)
  await expect(send).toBeEnabled()
})
