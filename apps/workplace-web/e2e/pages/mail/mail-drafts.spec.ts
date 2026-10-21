// 메일 임시저장(WP-577) E2E — 작성창 자동 저장(1.5초 디바운스, POST → PUT+version), 닫기·버리기·충돌, 임시보관함 목록에서 다시 열기·삭제, 보내기.
// 백엔드 없이 상태를 가진 임시저장 모킹(mail-drafts-mock)으로 계약(201·409 DRAFT_CONFLICT·404·204)대로 응답한다.
// 디바운스는 page.clock 으로만 넘긴다(실제 시간 대기 없음) — 병렬 부하에서도 결정적이게. 저장 시점·중간 상태를 단언하는 구간은
// 시계를 멈춘다(freezeClock) — 시계가 흐르면 부하로 늦어진 동작 사이에 실제 1.5초가 지나 디바운스가 먼저 저장해 버린다.
import type { Page, Route } from '@playwright/test'

import { detail, draftDetail, mailAccount, summary } from '../../factories/mail.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { mockDraftServer, mockSendWithDrafts } from '../../fixtures/mail-drafts-mock'
import { trackRequests } from '../../fixtures/requests'
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

  test('쓰면 1.5초 뒤 POST 로 만들고, 다음 변경은 받은 version 으로 PUT — 상태가 저장 중… → 저장됨', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
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

  test('빈 새 메일은 저장하지 않고 ✕ 로 조용히 닫힌다', async ({ authenticatedPage: page }) => {
    const server = await mockDraftServer(page)
    await page.goto('/mail/1')
    await page.getByTestId('mail-compose-new').click()
    await page.clock.runFor(DEBOUNCE * 2)
    await expect(status(page)).toHaveCount(0)
    await page.getByTestId('mail-compose-close').click()
    await expect(page.getByTestId('mail-compose-dock')).toHaveCount(0)
    await expectStays(page, server.posts.count, 0)
    await expect(page.getByText('임시보관함에 저장했어요')).toHaveCount(0)
  })

  test('올리는 중인 첨부는 저장에 싣지 않고, 다 올라가면 그 id 로 다시 저장한다', async ({ authenticatedPage: page }) => {
    const server = await mockDraftServer(page)
    const held: Route[] = []
    await page.route((u) => u.pathname === '/api/v1/mail/compose-attachments', (route) => {
      held.push(route)
    })
    await page.goto('/mail/1')
    await page.getByTestId('mail-compose-new').click()
    await page.getByTestId('mail-compose-file-input').setInputFiles({ name: 'a.pdf', mimeType: 'application/pdf', buffer: Buffer.from('A') })
    await page.getByTestId('mail-compose-subject').fill('첨부 메일')
    await page.clock.runFor(DEBOUNCE)
    await server.posts.waitFor()
    expect(server.posts.lastBody()).toMatchObject({ subject: '첨부 메일', attachmentIds: [] })

    await expect.poll(() => held.length).toBe(1)
    await held[0].fulfill({ status: 201, json: { id: 901, name: 'a.pdf', size: 1, mimeType: 'application/pdf', expiresAt: '2026-10-22T00:00:00Z' } })
    await page.clock.runFor(DEBOUNCE)
    await server.puts.waitFor()
    expect(server.puts.lastBody()).toMatchObject({ attachmentIds: [901], version: 1 })
  })

  test('✕ 는 디바운스를 기다리지 않고 바로 저장한 뒤 닫고 「임시보관함에 저장했어요」', async ({ authenticatedPage: page }) => {
    const server = await mockDraftServer(page)
    await page.goto('/mail/1')
    await page.getByTestId('mail-compose-new').click()
    await freezeClock(page)
    await page.getByTestId('mail-compose-subject').fill('바로 닫기')
    await page.getByTestId('mail-compose-close').click()
    await expect(page.getByTestId('mail-compose-dock')).toHaveCount(0)
    await server.posts.waitFor()
    expect(server.posts.lastBody()).toMatchObject({ subject: '바로 닫기' })
    await page.clock.resume()
    await expect(page.getByText('임시보관함에 저장했어요')).toBeVisible()
    await expect(page.getByTestId('mail-count-drafts')).toHaveText('1')
    // 닫은 뒤 디바운스 시간이 지나도 더 저장하지 않는다
    await page.clock.runFor(DEBOUNCE * 2)
    await expectStays(page, () => server.posts.count() + server.puts.count(), 1)
  })

  test('🗑 버리기 → DELETE 후 목록·개수에서 빠지고, 「되돌리기」로 같은 내용을 새 임시저장으로 만들어 다시 연다', async ({ authenticatedPage: page }) => {
    const server = await mockDraftServer(page)
    await page.goto('/mail/1?folder=drafts')
    await page.getByTestId('mail-compose-new').click()
    // 제목·본문을 쓰는 사이에 디바운스가 먼저 저장하지 않게(저장이 POST 와 PUT 으로 나뉘면 아래 PUT 대기가 앞 PUT 에 풀린다)
    await freezeClock(page)
    await page.getByTestId('mail-compose-subject').fill('버릴 메일')
    await page.getByTestId('mail-composer-body').click()
    await page.keyboard.type('버릴 본문')
    await page.clock.runFor(DEBOUNCE)
    await server.posts.waitFor()
    // 목록 갱신·토스트는 앱 타이머를 쓴다
    await page.clock.resume()
    await expect(status(page)).toHaveText('저장됨')
    const id = [...server.drafts.keys()][0]
    await expect(page.getByTestId(`mail-draft-row-${id}`)).toBeVisible()

    await page.getByTestId('mail-compose-discard').click()
    await expect(page.getByTestId('mail-compose-dock')).toHaveCount(0)
    await server.deletes.waitFor()
    expect(server.deletes.lastUrl()!.pathname).toBe(`/api/v1/mail/drafts/${id}`)
    expect(server.drafts.size).toBe(0)
    // 지운 뒤 임시보관함 목록·사이드바 개수를 다시 받는다
    await expect(page.getByTestId(`mail-draft-row-${id}`)).toHaveCount(0)
    await expect(page.getByTestId('mail-drafts-empty')).toBeVisible()
    await expect(page.getByTestId('mail-count-drafts')).toHaveCount(0)

    await page.getByRole('button', { name: '되돌리기' }).click()
    await server.posts.waitFor(2)
    expect(server.posts.lastBody()).toMatchObject({ subject: '버릴 메일' })
    expect(server.posts.lastBody<{ bodyText: string }>()!.bodyText).toContain('버릴 본문')
    await expect(page.getByTestId('mail-compose-dock')).toBeVisible()
    await expect(page.getByTestId('mail-compose-subject')).toHaveValue('버릴 메일')
    await expect(page.getByTestId('mail-composer-body')).toContainText('버릴 본문')
    // 되살린 임시저장 id 로 이어 저장한다(또 POST 하지 않는다)
    const restored = [...server.drafts.keys()][0]
    const putsBefore = server.puts.count()
    await page.getByTestId('mail-compose-subject').fill('버릴 메일 (살림)')
    await page.clock.runFor(DEBOUNCE)
    await server.puts.waitFor(putsBefore + 1)
    expect(server.puts.lastUrl()!.pathname).toBe(`/api/v1/mail/drafts/${restored}`)
    expect(server.posts.count()).toBe(2)
  })

  test('다른 곳에서 먼저 고쳤으면(409) 안내하고, 「다시 불러오기」로 서버 내용을 연다', async ({ authenticatedPage: page }) => {
    const server = await mockDraftServer(page, [draftDetail({ id: 7, subject: '처음 제목', version: 1 })], { 7: '쓰다 만 본문' })
    await page.goto('/mail/1?folder=drafts')
    await page.getByTestId('mail-draft-row-7').click()
    await expect(page.getByTestId('mail-compose-subject')).toHaveValue('처음 제목')

    server.bumpVersion(7, { subject: '다른 탭에서 고친 제목' })
    await page.getByTestId('mail-compose-subject').fill('여기서 고친 제목')
    await page.clock.runFor(DEBOUNCE)
    await server.puts.waitFor()
    expect(server.puts.lastBody()).toMatchObject({ version: 1 })
    await expect(status(page)).toHaveAttribute('data-status', 'conflict')
    await expect(status(page)).toContainText('다른 곳에서 고친 내용이 있어요')
    // 충돌 중에는 더 써도 서버 내용을 덮지 않는다
    await page.getByTestId('mail-compose-subject').fill('여기서 또 고친 제목')
    await page.clock.runFor(DEBOUNCE)
    await expectStays(page, server.puts.count, 1)

    await page.getByTestId('mail-compose-save-reload').click()
    await expect(page.getByTestId('mail-compose-subject')).toHaveValue('다른 탭에서 고친 제목')
    await expect(status(page)).toHaveText('저장됨')
    // 다시 받은 버전(2)으로 이어 저장한다
    await page.getByTestId('mail-compose-subject').fill('합친 제목')
    await page.clock.runFor(DEBOUNCE)
    await server.puts.waitFor(2)
    expect(server.puts.lastBody()).toMatchObject({ subject: '합친 제목', version: 2 })
  })

  test('충돌 중 ✕ 는 서버 글을 덮지 않고 내 내용을 새 임시저장으로 남긴다 — 첨부도 함께 옮겨 간다', async ({ authenticatedPage: page }) => {
    const server = await mockDraftServer(page, [
      draftDetail({ id: 7, subject: '처음 제목', version: 1, attachments: [{ id: 501, name: '안건.pdf', size: 10, mimeType: 'application/pdf', source: 'upload' }] }),
    ])
    await page.goto('/mail/1?folder=drafts')
    await page.getByTestId('mail-draft-row-7').click()
    await expect(page.getByTestId('mail-compose-dock').getByText('안건.pdf')).toBeVisible()
    server.bumpVersion(7, { subject: '다른 탭 제목' })
    await page.getByTestId('mail-compose-subject').fill('내 제목')
    await page.clock.runFor(DEBOUNCE)
    await expect(status(page)).toHaveAttribute('data-status', 'conflict')

    await page.getByTestId('mail-compose-close').click()
    await server.posts.waitFor()
    expect(server.posts.lastBody()).toMatchObject({ subject: '내 제목', attachmentIds: [501] })
    expect(server.drafts.get(7)!.detail.subject).toBe('다른 탭 제목')
    await expect(page.getByTestId('mail-draft-row-7')).toBeVisible()
    await expect(page.getByTestId('mail-drafts-list').getByText('내 제목')).toBeVisible()

    // 새로 남긴 임시저장을 다시 열면 첨부가 그대로 있다
    const copy = [...server.drafts.keys()].find((k) => k !== 7)!
    await page.getByTestId(`mail-draft-row-${copy}`).click()
    await expect(page.getByTestId('mail-compose-subject')).toHaveValue('내 제목')
    await expect(page.getByTestId('mail-compose-dock').getByText('안건.pdf')).toBeVisible()
  })

  test('다른 곳에서 보냈거나 버린 임시저장(PUT 404)은 되살리지 않는다 — 안내를 보이고 저장을 멈추며, 보내기는 draftId 없이 나간다', async ({ authenticatedPage: page }) => {
    const server = await mockDraftServer(page, [
      draftDetail({ id: 7, subject: '사라질 메일', to: ['rcpt@test.local'], attachments: [{ id: 501, name: '안건.pdf', size: 10, mimeType: 'application/pdf', source: 'upload' }] }),
    ])
    const sends = await mockSendWithDrafts(page, server)
    await page.goto('/mail/1?folder=drafts')
    await page.getByTestId('mail-draft-row-7').click()
    await expect(page.getByTestId('mail-compose-subject')).toHaveValue('사라질 메일')

    server.drafts.delete(7) // 다른 탭에서 보냈거나 버렸다
    await page.getByTestId('mail-compose-subject').fill('사라질 메일 (고침)')
    await page.clock.runFor(DEBOUNCE)
    await server.puts.waitFor()
    await expect(status(page)).toHaveAttribute('data-status', 'gone')
    await expect(status(page)).toHaveText('다른 곳에서 보냈거나 버린 메일이에요')
    // 목록·개수에서도 그 줄을 걷어낸다(눌러도 열리지 않는 줄이 남지 않게)
    await expect(page.getByTestId('mail-draft-row-7')).toHaveCount(0)
    await expect(page.getByTestId('mail-count-drafts')).toHaveCount(0)
    // 되살리지 않는다 — 더 써도 POST·PUT 이 없고, 새로고침 경고도 없다
    await page.getByTestId('mail-compose-subject').fill('사라질 메일 (또 고침)')
    await page.clock.runFor(DEBOUNCE * 2)
    await expectStays(page, () => [server.posts.count(), server.puts.count()], [0, 1])
    const blocked = await page.evaluate(() => {
      const e = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(e)
      return e.defaultPrevented
    })
    expect(blocked).toBe(false)

    // 작성창은 남아 여기서 보낼 수 있다 — 없어진 draftId 는 싣지 않는다
    await page.getByTestId('mail-compose-send').click()
    await sends.waitFor()
    expect(sends.lastBody()).toMatchObject({ subject: '사라질 메일 (또 고침)', attachmentIds: [501] })
    expect(sends.lastBody()).not.toHaveProperty('draftId')
    await expect(page.getByTestId('mail-compose-dock')).toHaveCount(0)
  })

  test('없어진 임시저장(404) 상태에서 ✕ 는 저장하지 않고 토스트 없이 닫는다', async ({ authenticatedPage: page }) => {
    const server = await mockDraftServer(page, [draftDetail({ id: 7, subject: '사라질 메일' })])
    await page.goto('/mail/1?folder=drafts')
    await page.getByTestId('mail-draft-row-7').click()
    server.drafts.delete(7)
    await page.getByTestId('mail-compose-subject').fill('고침')
    await page.clock.runFor(DEBOUNCE)
    await expect(status(page)).toHaveAttribute('data-status', 'gone')
    await page.getByTestId('mail-compose-close').click()
    await expect(page.getByTestId('mail-compose-dock')).toHaveCount(0)
    await expectStays(page, () => [server.posts.count(), server.puts.count()], [0, 1])
    await expect(page.getByText('임시보관함에 저장했어요')).toHaveCount(0)
    await expect(page.getByText('임시저장하지 못했어요')).toHaveCount(0)
  })

  test('임시보관함 — 사이드바 개수·행 표시, 답장 임시저장을 누르면 작성창이 열리고 인용문을 원본으로 다시 만든다', async ({ authenticatedPage: page }) => {
    const server = await mockDraftServer(
      page,
      [
        draftDetail({
          id: 7,
          mode: 'reply',
          to: ['앨리스 <alice@example.com>'],
          subject: 'Re: 원문 회의',
          bodyHtml: '<p>참석합니다</p>',
          sourceMessageId: 5,
          attachments: [{ id: 501, name: '안건.pdf', size: 1024, mimeType: 'application/pdf', source: 'upload' }],
          updatedAt: '2026-10-21T01:00:00Z',
        }),
      ],
      { 7: '참석합니다' },
    )
    const sourceGets = trackRequests(page, 'GET', '/api/v1/mail/messages/5')
    await page.goto('/mail/1')
    const link = page.getByTestId('mail-folder-drafts')
    await expect(page.getByTestId('mail-count-drafts')).toHaveText('1')
    await link.click()
    await expect(page).toHaveURL(/folder=drafts/)
    await expect(link).toHaveAttribute('aria-current', 'page')
    await expect(page.getByTestId('mail-drafts-detail-empty')).toBeVisible()
    await server.lists.waitFor()
    expect(server.lists.lastUrl()!.searchParams.get('accountId')).toBe('1')

    const row = page.getByTestId('mail-draft-row-7')
    await expect(row).toContainText('임시저장')
    await expect(row).toContainText('앨리스')
    await expect(row).toContainText('Re: 원문 회의')
    await expect(row).toContainText('참석합니다')
    await expect(page.getByTestId('mail-draft-attachment-7')).toHaveAttribute('aria-label', '첨부 1개')
    // 키보드 초점은 받은편지함 행처럼 초점 테두리로 보인다(배경만 바뀌면 hover 와 구분되지 않는다)
    await page.getByTestId('mail-draft-menu-7').focus()
    await page.keyboard.press('Shift+Tab')
    await expect(row).toBeFocused()
    expect(await row.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none')

    await row.click()
    const dock = page.getByTestId('mail-compose-dock')
    await expect(dock).toBeVisible()
    await expect(page.getByTestId('mail-compose-to')).toHaveValue('앨리스 <alice@example.com>')
    await expect(page.getByTestId('mail-compose-subject')).toHaveValue('Re: 원문 회의')
    await expect(page.getByTestId('mail-composer-body')).toContainText('참석합니다')
    // 인용문 머리(보낸 사람 · 날짜)는 원본 상세로 다시 만든 것이다(본문은 접힌 격리 프레임 안).
    await expect(page.getByTestId('mail-compose-quote')).toContainText('앨리스 · 6월 3일')
    await expect(dock.getByText('안건.pdf')).toBeVisible()
    await expect(status(page)).toHaveText('저장됨')
    expect(sourceGets.count()).toBe(1)
  })

  test('인용문을 지운 답장 임시저장은 인용문 없이 열리고 원본을 받지 않는다 — 고쳐 저장해도 지움 상태가 이어진다', async ({ authenticatedPage: page }) => {
    const server = await mockDraftServer(page, [
      draftDetail({ id: 8, mode: 'reply', subject: 'Re: 원문 회의', sourceMessageId: 5, quoteRemoved: true }),
    ])
    const sourceGets = trackRequests(page, 'GET', '/api/v1/mail/messages/5')
    await page.goto('/mail/1?folder=drafts')
    await page.getByTestId('mail-draft-row-8').click()
    await expect(page.getByTestId('mail-compose-subject')).toHaveValue('Re: 원문 회의')
    await expect(page.getByTestId('mail-compose-quote')).toHaveCount(0)
    expect(sourceGets.count()).toBe(0)

    await page.getByTestId('mail-compose-subject').fill('Re: 원문 회의 (고침)')
    await page.clock.runFor(DEBOUNCE)
    await server.puts.waitFor()
    expect(server.puts.lastBody()).toMatchObject({ mode: 'reply', sourceMessageId: 5, quoteRemoved: true, version: 1 })
  })

  test('다시 연 임시저장은 고치기 전에는 저장하지 않는다 — 다른 작성이 열린 채 열어도 마찬가지', async ({ authenticatedPage: page }) => {
    const server = await mockDraftServer(page, [
      draftDetail({ id: 7, subject: '첫째', bodyHtml: '<p>첫째 본문</p>' }),
      draftDetail({ id: 9, mode: 'reply', subject: 'Re: 원문 회의', bodyHtml: '<p>둘째 본문</p>', sourceMessageId: 5, attachments: [{ id: 501, name: '안건.pdf', size: 1, mimeType: 'application/pdf', source: 'upload' }] }),
    ])
    await page.goto('/mail/1?folder=drafts')
    await page.getByTestId('mail-draft-row-7').click()
    await expect(page.getByTestId('mail-composer-body')).toContainText('첫째 본문')
    await page.clock.runFor(DEBOUNCE * 3)
    await expectStays(page, () => server.puts.count() + server.posts.count(), 0)

    // 첫째가 열린 채 둘째를 연다 — 첫째는 고친 것이 없어 저장할 것이 없고, 둘째도 열자마자 저장하지 않는다.
    await page.getByTestId('mail-draft-row-9').click()
    await expect(page.getByTestId('mail-composer-body')).toContainText('둘째 본문')
    await expect(page.getByTestId('mail-compose-quote')).toBeVisible()
    await page.clock.runFor(DEBOUNCE * 3)
    await expectStays(page, () => server.puts.count() + server.posts.count(), 0)
    await expect(page.getByText('임시보관함에 저장했어요')).toHaveCount(0)
  })

  test('열린 작성을 두고 다른 임시저장을 열면 쓰던 것을 먼저 저장한다', async ({ authenticatedPage: page }) => {
    const server = await mockDraftServer(page, [draftDetail({ id: 7, subject: '보관된 메일' })])
    await page.goto('/mail/1?folder=drafts')
    await page.getByTestId('mail-compose-new').click()
    await page.getByTestId('mail-compose-subject').fill('쓰던 새 메일')
    await page.getByTestId('mail-draft-row-7').click()
    await server.posts.waitFor()
    expect(server.posts.lastBody()).toMatchObject({ subject: '쓰던 새 메일' })
    await expect(page.getByTestId('mail-compose-subject')).toHaveValue('보관된 메일')
    await expect(page.getByText('임시보관함에 저장했어요')).toBeVisible()
  })

  test('이미 열린 임시저장을 다시 누르면 새로 열지 않고 최소화를 풀어 앞으로 가져온다', async ({ authenticatedPage: page }) => {
    const server = await mockDraftServer(page, [draftDetail({ id: 7, subject: '열린 메일' })])
    await page.goto('/mail/1?folder=drafts')
    await page.getByTestId('mail-draft-row-7').click()
    const body = page.getByTestId('mail-composer-body')
    await expect(body).toContainText('쓰다 만 본문')
    await body.click()
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.type(' 이어서')
    await page.getByTestId('mail-compose-minimize').click()
    await expect(body).toBeHidden()

    await page.getByTestId('mail-draft-row-7').click()
    await expect(body).toBeVisible()
    // 쓰던 내용 그대로(서버 내용으로 다시 열지 않았다)
    await expect(body).toContainText('쓰다 만 본문 이어서')
    expect(server.details.count()).toBe(1)
  })

  test('보내기는 draftId 를 싣고, 보낸 뒤 임시보관함 목록·개수를 다시 받는다', async ({ authenticatedPage: page }) => {
    const server = await mockDraftServer(page, [draftDetail({ id: 7, subject: '보낼 메일', to: ['rcpt@test.local'] })])
    const sends = await mockSendWithDrafts(page, server)
    await page.goto('/mail/1?folder=drafts')
    await expect(page.getByTestId('mail-count-drafts')).toHaveText('1')
    await page.getByTestId('mail-draft-row-7').click()
    await expect(page.getByTestId('mail-compose-subject')).toHaveValue('보낼 메일')
    const lists = server.lists.count()
    await page.getByTestId('mail-compose-send').click()
    await sends.waitFor()
    expect(sends.lastBody()).toMatchObject({ to: ['rcpt@test.local'], subject: '보낼 메일', draftId: 7 })
    await expect(page.getByTestId('mail-compose-dock')).toHaveCount(0)
    await expect(page.getByTestId('mail-drafts-empty')).toBeVisible()
    await expect(page.getByTestId('mail-count-drafts')).toHaveCount(0)
    expect(server.lists.count()).toBeGreaterThan(lists)
    // 보낸 뒤에는 더 저장하지 않는다
    await page.clock.runFor(DEBOUNCE * 2)
    await expectStays(page, () => server.puts.count() + server.posts.count(), 0)
  })

  test('저장하지 않은 변경이 있는 동안만 새로고침·탭 닫기를 경고한다', async ({ authenticatedPage: page }) => {
    await mockDraftServer(page)
    await page.goto('/mail/1')
    await page.getByTestId('mail-compose-new').click()
    const blocked = () =>
      page.evaluate(() => {
        const e = new Event('beforeunload', { cancelable: true })
        window.dispatchEvent(e)
        return e.defaultPrevented
      })
    expect(await blocked()).toBe(false)
    await freezeClock(page)
    await page.getByTestId('mail-compose-subject').fill('아직 저장 전')
    await expect(status(page)).toHaveText('저장 중…')
    await expect.poll(blocked).toBe(true)
    await page.clock.runFor(DEBOUNCE)
    await page.clock.resume()
    await expect(status(page)).toHaveText('저장됨')
    await expect.poll(blocked).toBe(false)
  })

  test('임시저장이 없으면 빈 상태를 보여 주고 사이드바 개수도 없다', async ({ authenticatedPage: page }) => {
    await mockDraftServer(page)
    await page.goto('/mail/1?folder=drafts')
    await expect(page.getByTestId('mail-drafts-empty')).toContainText('임시저장한 메일이 없어요')
    await expect(page.getByTestId('mail-count-drafts')).toHaveCount(0)
    // 임시보관함은 메시지 목록을 받지 않고 검색 칸도 없다
    await expect(page.getByTestId('mail-search')).toHaveCount(0)
  })

  test('⋯ 삭제 → DELETE 후 행이 사라지고, 「되돌리기」로 같은 내용·첨부로 다시 만든다', async ({ authenticatedPage: page }) => {
    const server = await mockDraftServer(
      page,
      [
        draftDetail({
          id: 7,
          subject: '지울 메일',
          attachments: [
            { id: 31, name: '원본.pdf', size: 10, mimeType: 'application/pdf', source: 'forward' },
            { id: 501, name: '내 파일.pdf', size: 10, mimeType: 'application/pdf', source: 'upload' },
          ],
        }),
      ],
      { 7: '지울 본문 미리보기' },
    )
    await page.goto('/mail/1?folder=drafts')
    await page.getByTestId('mail-draft-menu-7').click()
    await page.getByTestId('mail-draft-delete-7').click()
    await server.deletes.waitFor()
    await expect(page.getByTestId('mail-draft-row-7')).toHaveCount(0)
    await expect(page.getByTestId('mail-drafts-empty')).toBeVisible()
    // 메뉴로 지워도 작성창은 열리지 않는다
    await expect(page.getByTestId('mail-compose-dock')).toHaveCount(0)

    await page.getByRole('button', { name: '되돌리기' }).click()
    await server.posts.waitFor()
    expect(server.posts.lastBody()).toMatchObject({
      subject: '지울 메일',
      bodyText: '지울 본문 미리보기',
      attachmentIds: [501],
      forwardAttachmentIds: [31],
    })
    expect(server.posts.lastBody()).not.toHaveProperty('attachments')
    await expect(page.getByTestId('mail-drafts-list').getByText('지울 메일')).toBeVisible()
    await expect(page.getByTestId('mail-count-drafts')).toHaveText('1')
  })

  test('작성창에 열린 임시저장을 목록에서 지우면 DELETE 가 성공한 뒤 저장 없이 작성창을 닫는다(지운 것을 다시 저장하지 않게)', async ({ authenticatedPage: page }) => {
    const server = await mockDraftServer(page, [draftDetail({ id: 7, subject: '열어 둔 메일' })])
    await page.goto('/mail/1?folder=drafts')
    await page.getByTestId('mail-draft-row-7').click()
    await freezeClock(page)
    await page.getByTestId('mail-compose-subject').fill('고치던 중')
    await expect(status(page)).toHaveText('저장 중…')

    await page.getByTestId('mail-draft-menu-7').click()
    await page.getByTestId('mail-draft-delete-7').click()
    await server.deletes.waitFor()
    await expect(page.getByTestId('mail-compose-dock')).toHaveCount(0)
    await page.clock.runFor(DEBOUNCE * 2)
    await expectStays(page, () => server.puts.count() + server.posts.count(), 0)
    expect(server.drafts.size).toBe(0)
  })

  test('목록에서 지우기가 실패하면 작성창과 아직 저장하지 않은 고친 내용을 그대로 두고, 이어서 저장한다', async ({ authenticatedPage: page }) => {
    const server = await mockDraftServer(page, [draftDetail({ id: 7, subject: '열어 둔 메일' })])
    await page.route(
      (u) => u.pathname === '/api/v1/mail/drafts/7',
      (route) => (route.request().method() === 'DELETE' ? route.fulfill({ status: 500, json: { status: 500 } }) : route.fallback()),
    )
    await page.goto('/mail/1?folder=drafts')
    await page.getByTestId('mail-draft-row-7').click()
    await freezeClock(page)
    await page.getByTestId('mail-compose-subject').fill('고치던 중')

    await page.getByTestId('mail-draft-menu-7').click()
    await page.getByTestId('mail-draft-delete-7').click()
    await server.deletes.waitFor()
    // 토스트 표시는 앱 타이머를 쓴다 — 시계를 다시 흐르게 한다(남은 디바운스도 곧 흐른다)
    await page.clock.resume()
    await expect(page.getByText('임시저장을 지우지 못했어요')).toBeVisible()
    await expect(page.getByTestId('mail-compose-dock')).toBeVisible()
    await expect(page.getByTestId('mail-compose-subject')).toHaveValue('고치던 중')
    await page.clock.runFor(DEBOUNCE)
    await server.puts.waitFor()
    expect(server.puts.lastBody()).toMatchObject({ subject: '고치던 중', version: 1 })
    expect(server.drafts.has(7)).toBe(true)
  })

  test('닫은 뒤 저장이 실패하면 「임시저장하지 못했어요 · 다시 열기」 — 다시 연 작성창은 고치지 않아도 같은 임시저장에 받은 version 으로 다시 저장한다', async ({ authenticatedPage: page }) => {
    const server = await mockDraftServer(page, [draftDetail({ id: 7, subject: '이어 쓸 메일', version: 1 })])
    let fail = true
    await page.route(
      (u) => u.pathname === '/api/v1/mail/drafts/7',
      (route) => {
        if (route.request().method() === 'PUT' && fail) {
          fail = false
          return route.fulfill({ status: 500, json: { status: 500, message: 'boom' } })
        }
        return route.fallback()
      },
    )
    await page.goto('/mail/1?folder=drafts')
    await page.getByTestId('mail-draft-row-7').click()
    await page.getByTestId('mail-compose-subject').fill('이어 쓸 메일 (닫기 전)')
    await page.getByTestId('mail-compose-close').click()
    await expect(page.getByTestId('mail-compose-dock')).toHaveCount(0)
    await server.puts.waitFor()
    await expect(page.getByText('임시저장하지 못했어요')).toBeVisible()
    // 다시 연 작성창의 「저장 중…」을 보기 전에 디바운스가 실제 시간으로 지나 저장되지 않게 멈춘다
    await freezeClock(page)

    // 오류 토스트는 fixture 가 포인터 이벤트를 통과시키므로(auth.fixture) 동작 버튼은 클릭 이벤트를 직접 보낸다.
    await page.getByRole('button', { name: '다시 열기' }).dispatchEvent('click')
    await expect(page.getByTestId('mail-compose-subject')).toHaveValue('이어 쓸 메일 (닫기 전)')
    // 저장 안 된 상태로 열린다 — 고치지 않아도 곧 다시 저장한다
    await expect(status(page)).toHaveText('저장 중…')
    await page.clock.runFor(DEBOUNCE)
    await server.puts.waitFor(2)
    expect(server.puts.lastUrl()!.pathname).toBe('/api/v1/mail/drafts/7')
    expect(server.puts.lastBody()).toMatchObject({ subject: '이어 쓸 메일 (닫기 전)', version: 1 })
    await expect(status(page)).toHaveText('저장됨')
    expect(server.posts.count()).toBe(0)
  })

  test('새 메일 저장이 닫을 때 실패해 「다시 열기」로 열면 그냥 닫아도 POST 로 저장한다', async ({ authenticatedPage: page }) => {
    const server = await mockDraftServer(page)
    let fail = true
    await page.route(
      (u) => u.pathname === '/api/v1/mail/drafts',
      (route) => {
        if (route.request().method() === 'POST' && fail) {
          fail = false
          return route.fulfill({ status: 500, json: { status: 500, message: 'boom' } })
        }
        return route.fallback()
      },
    )
    await page.goto('/mail/1')
    await page.getByTestId('mail-compose-new').click()
    // 쓰고 닫는 사이에 디바운스가 먼저 저장하지 않게 — 그러면 실패한 POST 뒤 닫기가 다시 저장에 성공해 「다시 열기」가 뜨지 않는다
    await freezeClock(page)
    await page.getByTestId('mail-compose-subject').fill('새로 쓴 메일')
    await page.getByTestId('mail-compose-close').click()
    await server.posts.waitFor()
    // 토스트는 앱 타이머를 쓴다
    await page.clock.resume()
    await page.getByRole('button', { name: '다시 열기' }).dispatchEvent('click')
    await expect(page.getByTestId('mail-compose-subject')).toHaveValue('새로 쓴 메일')
    // 고치지 않고 바로 닫아도 저장한다(처음 값과 같아도 저장 안 된 내용이다)
    await page.getByTestId('mail-compose-close').click()
    await server.posts.waitFor(2)
    expect(server.posts.lastBody()).toMatchObject({ subject: '새로 쓴 메일' })
    await expect(page.getByText('임시보관함에 저장했어요')).toBeVisible()
    expect(server.drafts.size).toBe(1)
  })

  test('작성창 🗑 의 DELETE 가 실패하면 「되돌리기」 대신 「버리지 못했어요」를 알리고 임시저장을 그대로 둔다', async ({ authenticatedPage: page }) => {
    const server = await mockDraftServer(page, [draftDetail({ id: 7, subject: '못 버릴 메일' })])
    await page.route(
      (u) => u.pathname === '/api/v1/mail/drafts/7',
      (route) => (route.request().method() === 'DELETE' ? route.fulfill({ status: 500, json: { status: 500, message: 'boom' } }) : route.fallback()),
    )
    await page.goto('/mail/1?folder=drafts')
    await page.getByTestId('mail-draft-row-7').click()
    await page.getByTestId('mail-compose-discard').click()
    await server.deletes.waitFor()
    await expect(page.getByText('임시저장을 버리지 못했어요')).toBeVisible()
    await expect(page.getByRole('button', { name: '되돌리기' })).toHaveCount(0)
    await expect(page.getByTestId('mail-draft-row-7')).toBeVisible()
    expect(server.posts.count()).toBe(0)
  })

  test('보내기를 두 번 눌러도 한 번만 나간다 — 진행 중인 임시저장을 기다리는 동안에도 잠긴다', async ({ authenticatedPage: page }) => {
    const server = await mockDraftServer(page, [draftDetail({ id: 7, subject: '보낼 메일', to: ['rcpt@test.local'] })])
    const sends = await mockSendWithDrafts(page, server)
    let releasePut!: () => void
    const held = new Promise<void>((r) => (releasePut = r))
    await page.route(
      (u) => u.pathname === '/api/v1/mail/drafts/7',
      async (route) => {
        if (route.request().method() === 'PUT') await held
        return route.fallback()
      },
    )
    await page.goto('/mail/1?folder=drafts')
    await page.getByTestId('mail-draft-row-7').click()
    await page.getByTestId('mail-compose-subject').fill('보낼 메일 (고침)')
    await page.clock.runFor(DEBOUNCE)
    await server.puts.waitFor() // 저장이 붙잡힌 채 진행 중
    const send = page.getByTestId('mail-compose-send')
    await send.click()
    await expect(send).toBeDisabled()
    await send.dispatchEvent('click') // 잠긴 동안 한 번 더
    releasePut()
    await sends.waitFor()
    await expect(page.getByTestId('mail-compose-dock')).toHaveCount(0)
    await expectStays(page, sends.count, 1)
    expect(sends.lastBody()).toMatchObject({ subject: '보낼 메일 (고침)', draftId: 7 })
  })

  test('보내는 동안 고친 내용은 저장하지 않다가, 보내기가 실패하면 자동 저장을 다시 켜 같은 임시저장에 저장한다', async ({ authenticatedPage: page }) => {
    const server = await mockDraftServer(page, [draftDetail({ id: 7, subject: '보낼 메일', to: ['rcpt@test.local'] })])
    let releaseSend!: () => void
    const held = new Promise<void>((r) => (releaseSend = r))
    const sends = trackRequests(page, 'POST', '/api/v1/mail/accounts/1/send')
    await page.route(
      (u) => u.pathname === '/api/v1/mail/accounts/1/send',
      async (route) => {
        await held
        return route.fulfill({ status: 502, json: { status: 502, message: '메일 서버에 보내지 못했어요' } })
      },
    )
    await page.goto('/mail/1?folder=drafts')
    await page.getByTestId('mail-draft-row-7').click()
    await expect(page.getByTestId('mail-compose-subject')).toHaveValue('보낼 메일')
    await page.getByTestId('mail-compose-send').click()
    await sends.waitFor()
    // 보내는 중에 고친다 — 디바운스가 지나도 저장하지 않는다
    await page.getByTestId('mail-compose-subject').fill('보내는 중 고침')
    await page.clock.runFor(DEBOUNCE * 2)
    await expectStays(page, () => server.puts.count() + server.posts.count(), 0)

    releaseSend()
    await expect(page.getByText('메일 서버에 보내지 못했어요')).toBeVisible()
    await expect(page.getByTestId('mail-compose-dock')).toBeVisible()
    await page.clock.runFor(DEBOUNCE)
    await server.puts.waitFor()
    expect(server.puts.lastBody()).toMatchObject({ subject: '보내는 중 고침', version: 1 })
    expect(server.posts.count()).toBe(0)
  })

  test('보내는 동안 ✕ 로 닫은 뒤 보내기가 실패하면 그 작성의 내용으로 임시저장하고 「보내지 못해 임시보관함에 저장했어요 · 다시 열기」', async ({ authenticatedPage: page }) => {
    const server = await mockDraftServer(page, [draftDetail({ id: 7, subject: '보낼 메일', to: ['rcpt@test.local'] })])
    let releaseSend!: () => void
    const held = new Promise<void>((r) => (releaseSend = r))
    const sends = trackRequests(page, 'POST', '/api/v1/mail/accounts/1/send')
    await page.route(
      (u) => u.pathname === '/api/v1/mail/accounts/1/send',
      async (route) => {
        await held
        return route.fulfill({ status: 502, json: { status: 502, message: '메일 서버에 보내지 못했어요' } })
      },
    )
    await page.goto('/mail/1?folder=drafts')
    await page.getByTestId('mail-draft-row-7').click()
    await expect(page.getByTestId('mail-compose-subject')).toHaveValue('보낼 메일')
    await freezeClock(page)
    await page.getByTestId('mail-compose-send').click()
    await sends.waitFor()
    // 보내는 동안 고치고 닫는다 — 닫기는 저장하지 않는다
    await page.getByTestId('mail-compose-subject').fill('보낼 메일 (고침)')
    await page.getByTestId('mail-compose-close').click()
    await expect(page.getByTestId('mail-compose-dock')).toHaveCount(0)
    await expectStays(page, () => server.puts.count() + server.posts.count(), 0)

    releaseSend()
    await server.puts.waitFor()
    expect(server.puts.lastUrl()!.pathname).toBe('/api/v1/mail/drafts/7')
    expect(server.puts.lastBody()).toMatchObject({ accountId: 1, subject: '보낼 메일 (고침)', version: 1 })
    await page.clock.resume()
    await expect(page.getByText('보내지 못해 임시보관함에 저장했어요')).toBeVisible()
    await expect(page.getByText('메일 서버에 보내지 못했어요')).toBeVisible()
    expect(server.posts.count()).toBe(0)

    // 다시 열기 → 저장한 임시저장을 작성창으로 연다
    await page.getByRole('button', { name: '다시 열기' }).dispatchEvent('click')
    await expect(page.getByTestId('mail-compose-subject')).toHaveValue('보낼 메일 (고침)')
  })

  test('보내는 동안 다른 작성으로 바꾼 뒤 실패하면 앞 작성의 내용만 앞 임시저장에 저장한다 — 지금 작성은 그대로', async ({ authenticatedPage: page }) => {
    const server = await mockDraftServer(page, [draftDetail({ id: 7, subject: '앞 메일', to: ['rcpt@test.local'] })])
    let releaseSend!: () => void
    const held = new Promise<void>((r) => (releaseSend = r))
    const sends = trackRequests(page, 'POST', '/api/v1/mail/accounts/1/send')
    await page.route(
      (u) => u.pathname === '/api/v1/mail/accounts/1/send',
      async (route) => {
        await held
        return route.fulfill({ status: 502, json: { status: 502, message: '메일 서버에 보내지 못했어요' } })
      },
    )
    await page.goto('/mail/1?folder=drafts')
    await page.getByTestId('mail-draft-row-7').click()
    await expect(page.getByTestId('mail-compose-subject')).toHaveValue('앞 메일')
    await freezeClock(page)
    await page.getByTestId('mail-compose-send').click()
    await sends.waitFor()
    // 다른 작성(새 메일)으로 바꿔 쓴다
    await page.getByTestId('mail-compose-new').click()
    await expect(page.getByTestId('mail-compose-subject')).toHaveValue('')
    await page.getByTestId('mail-compose-subject').fill('새로 쓰는 메일')

    releaseSend()
    await server.puts.waitFor()
    expect(server.puts.lastUrl()!.pathname).toBe('/api/v1/mail/drafts/7')
    expect(server.puts.lastBody()).toMatchObject({ subject: '앞 메일', version: 1 })
    expect(server.posts.count()).toBe(0)
    await page.clock.resume()
    await expect(page.getByText('보내지 못해 임시보관함에 저장했어요')).toBeVisible()
    // 지금 작성은 그대로 열려 있다
    await expect(page.getByTestId('mail-compose-subject')).toHaveValue('새로 쓰는 메일')
  })

  test('충돌 중 보내기는 draftId 없이 나가 다른 곳의 더 새 임시저장을 지우지 않는다', async ({ authenticatedPage: page }) => {
    const server = await mockDraftServer(page, [draftDetail({ id: 7, subject: '처음 제목', to: ['rcpt@test.local'], version: 1 })])
    const sends = await mockSendWithDrafts(page, server)
    await page.goto('/mail/1?folder=drafts')
    await page.getByTestId('mail-draft-row-7').click()
    await expect(page.getByTestId('mail-compose-subject')).toHaveValue('처음 제목')
    server.bumpVersion(7, { subject: '다른 탭 제목' })
    await page.getByTestId('mail-compose-subject').fill('여기서 고친 제목')
    await page.clock.runFor(DEBOUNCE)
    await expect(status(page)).toHaveAttribute('data-status', 'conflict')

    await page.getByTestId('mail-compose-send').click()
    await sends.waitFor()
    expect(sends.lastBody()).toMatchObject({ subject: '여기서 고친 제목' })
    expect(sends.lastBody()).not.toHaveProperty('draftId')
    await expect(page.getByTestId('mail-compose-dock')).toHaveCount(0)
    expect(server.drafts.get(7)!.detail.subject).toBe('다른 탭 제목')
  })

  test('충돌 「다시 불러오기」가 실패하면 충돌 상태를 두고, ✕ 는 내 내용을 새 임시저장으로 남긴다', async ({ authenticatedPage: page }) => {
    const server = await mockDraftServer(page, [draftDetail({ id: 7, subject: '처음 제목', version: 1 })])
    await page.goto('/mail/1?folder=drafts')
    await page.getByTestId('mail-draft-row-7').click()
    await expect(page.getByTestId('mail-compose-subject')).toHaveValue('처음 제목')
    server.bumpVersion(7, { subject: '다른 탭 제목' })
    await page.getByTestId('mail-compose-subject').fill('여기서 고친 제목')
    await page.clock.runFor(DEBOUNCE)
    await expect(status(page)).toHaveAttribute('data-status', 'conflict')

    // 다시 불러오기의 GET 이 실패한다
    await page.route(
      (u) => u.pathname === '/api/v1/mail/drafts/7',
      (route) => (route.request().method() === 'GET' ? route.fulfill({ status: 500, json: { status: 500, message: 'boom' } }) : route.fallback()),
    )
    await page.getByTestId('mail-compose-save-reload').click()
    await expect(page.getByText('boom')).toBeVisible()
    await expect(status(page)).toHaveAttribute('data-status', 'conflict')
    await expect(page.getByTestId('mail-compose-subject')).toHaveValue('여기서 고친 제목')

    await page.getByTestId('mail-compose-close').click()
    await server.posts.waitFor()
    expect(server.posts.lastBody()).toMatchObject({ subject: '여기서 고친 제목' })
    expect(server.drafts.get(7)!.detail.subject).toBe('다른 탭 제목')
    await expect(page.getByText('임시보관함에 저장했어요')).toBeVisible()
  })

  test('제목은 500자까지만 들어가고, 저장이 400 검증 오류면 원인을 짧게 보이며 같은 내용으로 다시 보내지 않는다', async ({ authenticatedPage: page }) => {
    await mockDraftServer(page)
    const posts = trackRequests(page, 'POST', '/api/v1/mail/drafts')
    let reject = true
    await page.route(
      (u) => u.pathname === '/api/v1/mail/drafts',
      (route) =>
        route.request().method() === 'POST' && reject
          ? // 서버 상한 검사(MailComposeLimits)와 같은 모양 — 문구는 message 에, errors 는 없다
            route.fulfill({ status: 400, json: { status: 400, message: '받는사람이 너무 많아요' } })
          : route.fallback(),
    )
    await page.goto('/mail/1')
    await page.getByTestId('mail-compose-new').click()
    const subject = page.getByTestId('mail-compose-subject')
    await subject.fill('가'.repeat(600))
    await expect(subject).toHaveValue('가'.repeat(500))

    await page.clock.runFor(DEBOUNCE)
    await posts.waitFor()
    await expect(status(page)).toHaveAttribute('data-status', 'invalid')
    await expect(status(page)).toHaveText('저장하지 못했어요 · 받는사람이 너무 많아요')
    await expect(status(page)).toHaveAttribute('title', '저장하지 못했어요 · 받는사람이 너무 많아요')
    await expect(page.getByTestId('mail-compose-save-retry')).toHaveCount(0)
    await page.clock.runFor(DEBOUNCE * 2)
    await expectStays(page, posts.count, 1)

    // 고치면 다시 저장한다
    reject = false
    await page.getByTestId('mail-compose-to').fill('a@x.com')
    await page.clock.runFor(DEBOUNCE)
    await posts.waitFor(2)
    await expect(status(page)).toHaveText('저장됨')
  })

  test('PUT 은 목록의 그 행만 그 자리에서 고쳐 맨 위로 올린다 — 목록·개수를 다시 받지 않는다', async ({ authenticatedPage: page }) => {
    const server = await mockDraftServer(
      page,
      [
        draftDetail({ id: 7, subject: '고칠 메일', updatedAt: '2026-10-21T01:00:00Z' }),
        draftDetail({ id: 8, subject: '다른 메일', updatedAt: '2026-10-21T01:30:00Z' }),
      ],
      { 7: '옛 미리보기' },
    )
    await page.goto('/mail/1?folder=drafts')
    const rows = page.getByTestId('mail-drafts-list').locator('[data-testid^="mail-draft-row-"]')
    await expect(rows).toHaveCount(2)
    await expect(rows.first()).toHaveAttribute('data-testid', 'mail-draft-row-8')
    await page.getByTestId('mail-draft-row-7').click()
    await expect(page.getByTestId('mail-count-drafts')).toHaveText('2')
    const counts = server.counts.count()
    const lists = server.lists.count()
    await page.getByTestId('mail-compose-subject').fill('고친 메일')
    await page.clock.runFor(DEBOUNCE)
    await server.puts.waitFor()
    // 고친 행이 맨 위로, 제목·미리보기(서버와 같은 규칙)가 바뀐다
    await expect(rows.first()).toHaveAttribute('data-testid', 'mail-draft-row-7')
    await expect(rows.first()).toContainText('고친 메일')
    await expect(rows.first()).toContainText('쓰다 만 본문')
    await expectStays(page, () => server.lists.count() + server.counts.count(), lists + counts)
  })

  test('임시저장이 아닌 404(계정 비활성 등)는 없어진 것으로 보지 않고 「저장하지 못했어요 · 다시 시도」', async ({ authenticatedPage: page }) => {
    const server = await mockDraftServer(page, [draftDetail({ id: 7, subject: '계정 문제' })])
    let fail = true
    await page.route(
      (u) => u.pathname === '/api/v1/mail/drafts/7',
      (route) =>
        route.request().method() === 'PUT' && fail
          ? route.fulfill({ status: 404, json: { status: 404, message: '메일 계정을 찾을 수 없습니다' } })
          : route.fallback(),
    )
    await page.goto('/mail/1?folder=drafts')
    await page.getByTestId('mail-draft-row-7').click()
    await page.getByTestId('mail-compose-subject').fill('계정 문제 (고침)')
    await page.clock.runFor(DEBOUNCE)
    await expect(status(page)).toHaveAttribute('data-status', 'error')
    fail = false
    await page.getByTestId('mail-compose-save-retry').click()
    await server.puts.waitFor(2)
    expect(server.puts.lastBody()).toMatchObject({ subject: '계정 문제 (고침)', version: 1 })
    await expect(status(page)).toHaveText('저장됨')
  })

  test('저장이 실패하면 「저장하지 못했어요 · 다시 시도」, 다시 시도하면 저장된다', async ({ authenticatedPage: page }) => {
    await mockDraftServer(page)
    let fail = true
    const posts = trackRequests(page, 'POST', '/api/v1/mail/drafts')
    await page.route(
      (u) => u.pathname === '/api/v1/mail/drafts',
      (route) => (route.request().method() === 'POST' && fail ? route.fulfill({ status: 500, json: { status: 500, message: 'boom' } }) : route.fallback()),
    )
    await page.goto('/mail/1')
    await page.getByTestId('mail-compose-new').click()
    await page.getByTestId('mail-compose-subject').fill('실패할 메일')
    await page.clock.runFor(DEBOUNCE)
    await expect(status(page)).toHaveAttribute('data-status', 'error')
    await expect(status(page)).toContainText('저장하지 못했어요')

    fail = false
    await page.getByTestId('mail-compose-save-retry').click()
    await posts.waitFor(2)
    await expect(status(page)).toHaveText('저장됨')
  })
})
