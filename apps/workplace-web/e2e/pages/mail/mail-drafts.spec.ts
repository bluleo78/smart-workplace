// 메일 임시저장(WP-577) E2E — 라우트 → 작성창 → 자동 저장 API(1.5초 디바운스, POST → PUT+version) → 상태 줄·사이드바 개수가
// 실제로 이어지는 @wiring 1건과, 임시보관함 행의 키보드 초점 테두리(@layout)만 남긴다.
// 저장 규칙·닫기/버리기/되돌리기·충돌(409)·없어짐(404)·목록 열기/삭제·보내기 잠금/실패·새로고침 경고·400 검증·다시 시도는
// src/pages/mail/mailDrafts.test.tsx(화면 테스트)가 지킨다(WP-984). 백엔드 없이 상태를 가진 임시저장 모킹(mail-drafts-mock).
// 디바운스는 page.clock 으로만 넘긴다(실제 시간 대기 없음) — 저장 시점·중간 상태를 단언하는 구간은 시계를 멈춘다(freezeClock).
import type { Page } from '@playwright/test'

import { detail, draftDetail, mailAccount, summary } from '../../factories/mail.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { mockDraftServer } from '../../fixtures/mail-drafts-mock'
import { expectStays } from '../../fixtures/wait'

const DEBOUNCE = 1500

/** 계정 1건 + 받은편지함(원본 메일 5) — 답장 임시저장의 인용문 원본. */
async function mockMail(page: Page) {
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
  await page.route(
    (u) => u.pathname === '/api/v1/mail/accounts/1/messages',
    (route) => route.fulfill({ json: [summary({ id: 5, subject: '원문 회의', fromAddress: 'alice@example.com' })] }),
  )
  await mockApi(
    page,
    'GET',
    '/api/v1/mail/messages/5',
    detail({ id: 5, subject: '원문 회의', fromAddress: 'alice@example.com', bodyText: '원본 메일 본문입니다', bodyHtml: null, attachments: [] }),
  )
}

/** 앱 시계를 멈춘다 — 이후 디바운스는 runFor 로만 흐른다. 토스트 자동 닫힘도 멈춰 단언이 결정적이다. */
async function freezeClock(page: Page) {
  await page.clock.pauseAt(Date.now() + 1000)
}

const status = (page: Page) => page.getByTestId('mail-compose-save-status')

test.describe('메일 임시저장', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.clock.install()
    await mockMail(page)
  })

  test('쓰면 1.5초 뒤 POST 로 만들고, 다음 변경은 받은 version 으로 PUT — 상태가 저장 중… → 저장됨', { tag: ['@wiring', '@smoke'] }, async ({ authenticatedPage: page }) => {
    const server = await mockDraftServer(page)
    await page.goto('/mail/1')
    await page.getByTestId('mail-compose-new').click()
    await freezeClock(page)

    await page.getByTestId('mail-compose-to').fill('rcpt@test.local')
    await page.getByTestId('mail-compose-subject').fill('주간 보고')
    await expect(status(page)).toHaveText('저장 중…')
    await page.clock.runFor(DEBOUNCE - 100)
    await expectStays(page, server.posts.count, 0, { ms: 100 })
    await page.clock.runFor(100)
    await server.posts.waitFor()
    expect(server.posts.lastBody()).toMatchObject({
      accountId: 1,
      mode: 'new',
      to: ['rcpt@test.local'],
      subject: '주간 보고',
      sourceMessageId: null,
      quoteRemoved: false,
      attachmentIds: [],
      forwardAttachmentIds: [],
    })
    expect(server.posts.lastBody()).not.toHaveProperty('version')
    await page.clock.resume()
    await expect(status(page)).toHaveText('저장됨')
    // 저장 뒤 사이드바 개수를 다시 받는다
    await expect(page.getByTestId('mail-count-drafts')).toHaveText('1')

    await page.getByTestId('mail-compose-subject').fill('주간 보고 (수정)')
    await page.clock.runFor(DEBOUNCE)
    await server.puts.waitFor()
    const id = [...server.drafts.keys()][0]
    expect(server.puts.lastUrl()!.pathname).toBe(`/api/v1/mail/drafts/${id}`)
    expect(server.puts.lastBody()).toMatchObject({ subject: '주간 보고 (수정)', version: 1 })
    await expect(status(page)).toHaveText('저장됨')
    expect(server.posts.count()).toBe(1)
  })

  test('임시보관함 행은 키보드 초점을 받으면 초점 테두리로 보인다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await mockDraftServer(page, [draftDetail({ id: 7, subject: 'Re: 원문 회의' })], { 7: '참석합니다' })
    await page.goto('/mail/1?folder=drafts')
    const row = page.getByTestId('mail-draft-row-7')
    await expect(row).toBeVisible()
    // 키보드 초점은 받은편지함 행처럼 초점 테두리로 보인다(배경만 바뀌면 hover 와 구분되지 않는다) — 계산된 outline 은 jsdom 이 잴 수 없다.
    await page.getByTestId('mail-draft-menu-7').focus()
    await page.keyboard.press('Shift+Tab')
    await expect(row).toBeFocused()
    expect(await row.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none')
  })
})
