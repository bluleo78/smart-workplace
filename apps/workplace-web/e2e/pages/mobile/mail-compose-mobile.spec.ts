// 모바일 메일 작성(WP-583) — 데스크톱용 작은 도크를 줄인 모양 대신, 다른 메일 앱처럼 처음부터 화면 전체 작성 화면.
// 상단 바 [✕ 닫기] 제목(새 메일/회신/전달) … [➤ 보내기], 최소화·확대 없음, 서식 버튼은 화면 맨 아래.
// 브라우저가 있어야 판정되는 것만 남긴다 — 화면 전체 덮기·서식 줄·칩·44px(@layout), 시스템 뒤로가기(@platform), 발송 배선 1건(@wiring).
// 회신·전달 제목, 빈 작성 ✕ 즉시 닫기, 받는사람만 고친 ✕ 임시저장은 페이지 테스트 src/pages/mobile/mailComposeMobile.test.tsx 가 지킨다(WP-971).
import type { Page } from '@playwright/test'

import { detail, mailAccount, summary } from '../../factories/mail.factory'
import { mockApi } from '../../fixtures/api-mock'
import { trackRequests } from '../../fixtures/requests'
import { expect, expectNoHorizontalOverflow, expectOnTop, expectTouchTarget, test } from '../../fixtures/mobile.fixture'

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

test('편지쓰기 → 화면 전체 새 메일 화면, 상단 보내기로 발송하면 닫힌다', { tag: '@wiring' }, async ({ authenticatedPage: page }) => {
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

test('쓴 내용이 없으면 시스템 뒤로가기는 묻지 않고 작성 화면만 닫고 보던 메일에 머문다', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
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

test('쓴 내용이 있으면 시스템 뒤로가기는 묻지 않고 임시저장한 뒤 닫고 보던 메일에 머문다(WP-577)', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
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

test('서식 버튼은 화면 맨 아래에 붙는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
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
test('상단 바 📎 로 첨부하면 칩이 본문 아래(서식 줄 위)에 보이고, 다 올라가야 보내기가 열려 attachmentIds 로 보낸다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
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
test('새 메일 AI 초안 — 하단 툴바에서 열어 생성하면 본문·제목이 채워진다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
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
test('첨부 때문에 보내기가 잠기면 상단 바 바로 아래 상태 줄로 알리고, 칩·탭·참조 버튼은 44px 터치 크기다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
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

// WP-1524 — 모바일 서식 줄·서식판·표 막대의 자리(390px). safe-area 는 Playwright 가 env() 를 못 바꿔 여기서 재지 않는다 —
// 서식 줄과 위 줄이 같은 offset 클래스(mailMobileBars.ts)를 쓰는 것을 mailMobileBars.test.ts 가 지킨다.

/** 모바일 새 답장 작성 화면을 연다. */
async function openMobileReply(page: Page) {
  await openInbox(page)
  await page.getByTestId('mail-row-10').click()
  await page.getByTestId('mail-reply').click()
  await expectFullScreen(page)
}

test('서식 줄 여덟 단추가 390px 안에 모두 보이고 44px 다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  // 여덟째 「AI로 쓰기」는 새 메일에서만 있다 — AI 사용 계정으로 새 메일을 연다.
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount({ aiEnabled: true })])
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/messages', [summary()])
  await page.goto('/mail/1')
  await page.getByTestId('mobile-sidebar-trigger').click()
  const side = page.getByTestId('mobile-sidebar-sheet')
  await side.getByTestId('mail-compose-new').click()
  if (await side.isVisible()) await page.keyboard.press('Escape')
  await expectFullScreen(page)
  const bar = page.getByTestId('mail-composer-toolbar')
  const buttons = bar.getByRole('button')
  await expect(buttons).toHaveCount(8)
  await expectNoHorizontalOverflow(page)
  const vp = page.viewportSize()!
  for (let i = 0; i < 8; i++) {
    const btn = buttons.nth(i)
    // 단추끼리 틈이 없어(gap-0) expectTouchTarget 의 0.5px 안쪽 탐침이 이웃 단추 경계에 걸리므로, 상자 크기를 직접 잰다(44px, 반올림 0.5px 허용).
    const b = (await btn.boundingBox())!
    expect(b.width).toBeGreaterThanOrEqual(43.5)
    expect(b.height).toBeGreaterThanOrEqual(43.5)
    await expect(btn).toBeVisible()
    expect(b.x).toBeGreaterThanOrEqual(0)
    expect(b.x + b.width).toBeLessThanOrEqual(vp.width)
  }
  // 서식 줄 자체도 화면 안.
  const bb = (await bar.boundingBox())!
  expect(bb.y + bb.height).toBeLessThanOrEqual(vp.height)
})

test('서식판이 서식 줄 바로 위에 붙고 칩이 44px 다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await openMobileReply(page)
  const bar = page.getByTestId('mail-composer-toolbar')
  await bar.getByRole('button', { name: '서식' }).click()
  const sheet = page.getByTestId('mail-format-sheet')
  await expect(sheet).toBeVisible()
  await expectNoHorizontalOverflow(page)

  // 판의 아래끝 = 서식 줄 윗끝(공유 offset, 1px 허용). 서식 줄은 화면 안.
  const s = (await sheet.boundingBox())!
  const b = (await bar.boundingBox())!
  expect(Math.abs(s.y + s.height - b.y), `sheet bottom ${s.y + s.height} vs bar top ${b.y}`).toBeLessThanOrEqual(1)
  expect(b.y + b.height).toBeLessThanOrEqual(page.viewportSize()!.height)

  // 칩 44px — 크기·정렬·목록 칩. 판은 최대 45vh 라 안에서 스크롤되므로 칩을 보이는 자리로 올린 뒤 잰다.
  await expectTouchTarget(sheet.getByRole('group', { name: '크기' }).getByRole('button').first(), 44)
  await sheet.getByRole('group', { name: '정렬' }).getByRole('button').first().scrollIntoViewIfNeeded()
  await expectTouchTarget(sheet.getByRole('group', { name: '정렬' }).getByRole('button').first(), 44)
  await sheet.getByRole('group', { name: '목록' }).getByRole('button').first().scrollIntoViewIfNeeded()
  await expectTouchTarget(sheet.getByRole('group', { name: '목록' }).getByRole('button').first(), 44)
})

test('서식판이 열린 동안 긴 본문의 끝을 서식판 윗변 위로 올려 볼 수 있다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await openMobileReply(page)
  const body = page.getByTestId('mail-composer-body')
  await body.click()
  for (let i = 0; i < 60; i++) await page.keyboard.press('Enter')
  await page.keyboard.type('맨 아래 줄')

  await page.getByTestId('mail-composer-toolbar').getByRole('button', { name: '서식' }).click()
  const sheet = page.getByTestId('mail-format-sheet')
  await expect(sheet).toBeVisible()

  // 패널을 열면 커서가 판 뒤에 가려졌을 때 스크롤로 올려 준다 — 마지막 문단 아래끝이 판 윗변 이하가 될 때까지 기다린다.
  const last = body.locator('p').last()
  await expect
    .poll(async () => {
      const l = (await last.boundingBox())!
      const s = (await sheet.boundingBox())!
      return Math.round(s.y - (l.y + l.height))
    })
    .toBeGreaterThanOrEqual(0)
  // 마지막 문단은 화면 안에도 있다(위로 밀려 사라지지 않았다).
  await expect(last).toBeInViewport()
})

test('표 막대 줄은 서식 줄과 겹치지 않고, 서식판·표 패널이 열린 동안엔 감춰진다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await openMobileReply(page)
  const bar = page.getByTestId('mail-composer-toolbar')
  const body = page.getByTestId('mail-composer-body')
  await body.click()
  // 표 패널에서 2×2 표를 넣는다 — 패널은 넣으면 닫히고 커서는 표 안.
  await bar.getByRole('button', { name: '표 넣기' }).click()
  await page.getByTestId('mail-table-panel').getByRole('button', { name: '2행 2열 표' }).click()
  await expect(page.getByTestId('mail-table-panel')).toHaveCount(0)

  const tableBar = page.getByTestId('mail-table-toolbar')
  await expect(tableBar).toBeVisible()
  const t = (await tableBar.boundingBox())!
  const b = (await bar.boundingBox())!
  // 표 막대 줄의 아래끝 = 서식 줄 윗끝 — 겹치지 않는다(1px 허용).
  expect(t.y + t.height).toBeLessThanOrEqual(b.y + 1)
  expect(Math.abs(t.y + t.height - b.y)).toBeLessThanOrEqual(1)
  await expectNoHorizontalOverflow(page)

  // 서식판이 열린 동안엔 표 막대 줄이 사라진다.
  await bar.getByRole('button', { name: '서식' }).click()
  await expect(page.getByTestId('mail-format-sheet')).toBeVisible()
  await expect(tableBar).toHaveCount(0)
  // 표 패널을 열면 서식판이 닫히고 표 막대는 여전히 감춰진다.
  await bar.getByRole('button', { name: '표 넣기' }).click()
  await expect(page.getByTestId('mail-table-panel')).toBeVisible()
  await expect(page.getByTestId('mail-format-sheet')).toHaveCount(0)
  await expect(tableBar).toHaveCount(0)
  // 패널을 닫으면(커서는 아직 표 안) 표 막대가 돌아온다.
  await bar.getByRole('button', { name: '표 넣기' }).click()
  await expect(page.getByTestId('mail-table-panel')).toHaveCount(0)
  await expect(tableBar).toBeVisible()
})

test('표가 마지막 블록이어도 맨 아래 줄을 표 막대 줄 위로 올려 볼 수 있다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  // 회신은 인용문이 표 뒤에 남으므로, 아무것도 없는 새 메일에서 표를 마지막 블록으로 만든다.
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/messages', [summary()])
  await page.goto('/mail/1')
  await page.getByTestId('mobile-sidebar-trigger').click()
  const side = page.getByTestId('mobile-sidebar-sheet')
  await side.getByTestId('mail-compose-new').click()
  if (await side.isVisible()) await page.keyboard.press('Escape')
  await expectFullScreen(page)
  const bar = page.getByTestId('mail-composer-toolbar')
  const body = page.getByTestId('mail-composer-body')
  await body.click()
  // 본문이 길어 스크롤이 생기게 한 뒤 맨 끝에 2×2 표를 넣는다.
  for (let i = 0; i < 60; i++) await page.keyboard.press('Enter')
  await bar.getByRole('button', { name: '표 넣기' }).click()
  await page.getByTestId('mail-table-panel').getByRole('button', { name: '2행 2열 표' }).click()
  await expect(page.getByTestId('mail-table-panel')).toHaveCount(0)

  // 마지막 줄(본문 행)의 칸에 커서를 둔다 — 표가 마지막 블록이라 그 아래에는 본문이 더 없다.
  // 표 뒤에 다른 블록이 없는지 확인한다(없어야 빈 자리의 효과를 본다).
  expect(await body.locator('table').evaluate((t) => t.nextElementSibling?.textContent ?? '')).toBe('')
  const lastRow = body.locator('tr').last()
  await lastRow.locator('td').first().click()
  const tableBar = page.getByTestId('mail-table-toolbar')
  await expect(tableBar).toBeVisible()
  // 표 막대 줄 높이만큼 본문 아래 빈 자리가 있어, 스크롤하면 마지막 줄의 아래끝이 표 막대 줄 윗변 이상으로 올라온다.
  await expect
    .poll(async () => {
      const r = (await lastRow.boundingBox())!
      const t = (await tableBar.boundingBox())!
      return Math.round(t.y - (r.y + r.height))
    })
    .toBeGreaterThanOrEqual(0)
  await expect(lastRow).toBeInViewport()
})

test('표 칸에 긴 문장을 써도 표는 본문 폭 안에서 줄바꿈하고 화면이 옆으로 밀리지 않는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await openMobileReply(page)
  const bar = page.getByTestId('mail-composer-toolbar')
  const body = page.getByTestId('mail-composer-body')
  await body.click()
  await bar.getByRole('button', { name: '표 넣기' }).click()
  await page.getByTestId('mail-table-panel').getByRole('button', { name: '2행 2열 표' }).click()
  // 커서는 첫 칸 — 한 칸에 긴 문장을 쓴다(전역 표 규칙이면 475px 로 열을 넘쳤다).
  await page.keyboard.type('이 칸에는 받는 사람 화면에서는 줄바꿈되어야 하는 아주 긴 문장을 일부러 길게 적어 넣습니다')
  await expectNoHorizontalOverflow(page)
  const t = (await body.locator('table').boundingBox())!
  const b = (await body.boundingBox())!
  expect(t.width, `table ${t.width} vs body ${b.width}`).toBeLessThanOrEqual(b.width)
})

test('서식판의 글자색·배경색 칩 줄은 한 줄이고 화면이 옆으로 밀리지 않는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await openMobileReply(page)
  await page.getByTestId('mail-composer-toolbar').getByRole('button', { name: '서식' }).click()
  const sheet = page.getByTestId('mail-format-sheet')
  await expect(sheet).toBeVisible()
  for (const name of ['글자색', '배경색']) {
    const chips = sheet.getByRole('group', { name }).getByRole('button')
    await expect(chips).toHaveCount(8)
    await chips.first().scrollIntoViewIfNeeded()
    const tops = await chips.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)))
    expect(new Set(tops).size, `${name} tops ${tops}`).toBe(1)
    await expectTouchTarget(chips.first(), 44)
  }
  await expectNoHorizontalOverflow(page)
})
