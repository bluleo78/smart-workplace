// 메일 목록 이어 보기 E2E(WP-965) — 끝까지 내리면 로컬 다음 페이지(커서)를 잇고, 로컬이 바닥나면 받은편지함·보낸편지함은 서버에서 이전 메일을 더 가져온다.
import type { Page } from '@playwright/test'

import type { EmailMessageSummary, MailOlderResult, MailUnreadCounts } from '../../../src/types/mailMessage'
import { mailAccount, summary } from '../../factories/mail.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { trackRequests } from '../../fixtures/requests'
import { expectStays } from '../../fixtures/wait'

const COUNTS: MailUnreadCounts = {
  classificationActive: true,
  inbox: 0,
  byCategory: { 업무: 0, 개인: 0, 알림: 0, 프로모션: 0, 뉴스레터: 0 },
  needsReply: 0,
}
const LIST = '/api/v1/mail/accounts/1/messages'
const OLDER = '/api/v1/mail/accounts/1/messages/older'
const HOUR = 3_600_000
const BASE = Date.parse('2026-10-20T10:00:00Z')

/** id 가 클수록 최신 — 수신 시각은 서버처럼 마이크로초까지 붙인다(커서가 그 문자열을 그대로 돌려줘야 한다). */
const row = (id: number): EmailMessageSummary =>
  summary({ id, subject: `메일 ${id}`, seen: true, hasAttachment: false, receivedAt: `${new Date(BASE - (1000 - id) * HOUR).toISOString().slice(0, 19)}.123456Z` })
const rows = (from: number, to: number) => Array.from({ length: from - to + 1 }, (_, i) => row(from - i))

const olderResult = (over: Partial<MailOlderResult> = {}): MailOlderResult => ({
  running: false, fetched: 0, saved: 0, syncedSince: null, hasMore: false, ...over,
})

async function stubBase(page: Page) {
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/unread-counts', COUNTS)
}

/** 목록 끝 감시 줄까지 내린다. */
async function scrollToEnd(page: Page) {
  await page.getByTestId('mail-list-scroll').evaluate((el) => el.scrollTo(0, el.scrollHeight))
}

test.describe('메일 목록 이어 보기(WP-965)', () => {
  test('받은편지함 — 끝까지 내리면 다음 페이지(커서)를 잇고, 로컬이 바닥나면 서버에서 이전 메일을 가져와 붙인 뒤 「더 이전 메일 없음」', async ({ authenticatedPage: page }) => {
    await stubBase(page)
    let olderLoaded = false
    // 첫 페이지 50통(1000~951), 그다음(beforeId=951) 10통 — 서버에서 가져온 뒤에는 5통(940~936)이 더 붙는다.
    await page.route(
      (u) => u.pathname === LIST,
      (route, req) => {
        const before = new URL(req.url()).searchParams.get('beforeId')
        const items = before == null ? rows(1000, 951) : before === '951' ? rows(950, olderLoaded ? 936 : 941) : []
        return route.fulfill({ json: items })
      },
    )
    await page.route(
      (u) => u.pathname === OLDER,
      (route) => {
        olderLoaded = true
        return route.fulfill({ json: olderResult({ fetched: 5, saved: 5, syncedSince: '2026-07-01T00:00:00Z', hasMore: false }) })
      },
    )
    const lists = trackRequests(page, 'GET', LIST)
    const olders = trackRequests(page, 'POST', OLDER)

    await page.goto('/mail/1')
    await expect(page.getByTestId('mail-row-1000')).toBeVisible()
    // 첫 화면에선 끝이 보이지 않아 다음 페이지·서버 가져오기를 부르지 않는다.
    await expectStays(page, olders.count, 0)

    // 끝까지 내리면 다음 페이지 — 커서는 첫 페이지 마지막 행(951)의 id·수신 시각 문자열 그대로, 한 페이지 50통씩.
    await scrollToEnd(page)
    await expect(page.getByTestId('mail-row-941')).toBeAttached()
    const paged = lists.urls().find((u) => u.searchParams.get('beforeId') === '951')!
    expect(paged.searchParams.get('beforeAt')).toBe(row(951).receivedAt)
    expect(paged.searchParams.get('limit')).toBe('50')

    // 로컬이 바닥났다(10통 < 50) — 끝이 보이면 서버에서 받은편지함 이전 메일을 가져와 목록에 붙인다.
    await scrollToEnd(page)
    await olders.waitFor(1)
    expect(olders.lastUrl()?.searchParams.get('folder')).toBe('INBOX')
    await expect(page.getByTestId('mail-row-936')).toBeAttached()
    await scrollToEnd(page)
    await expect(page.getByTestId('mail-list-no-older')).toBeVisible()
    await expect(page.getByTestId('mail-list-no-older')).toHaveText('더 이전 메일 없음')
    // 더 없다고 했으니 다시 부르지 않는다.
    await expectStays(page, olders.count, 1)
  })

  test('보낸편지함 — 짧은 목록은 끝이 바로 보여 서버 보낸편지함 이전 메일을 가져온다', async ({ authenticatedPage: page }) => {
    await stubBase(page)
    await mockApi(page, 'GET', LIST, rows(1000, 999))
    const olders = trackRequests(page, 'POST', OLDER)

    await page.goto('/mail/1?folder=sent')

    await expect(page.getByTestId('mail-row-999')).toBeVisible()
    await olders.waitFor(1)
    expect(olders.lastUrl()?.searchParams.get('folder')).toBe('SENT')
    await expect(page.getByTestId('mail-list-no-older')).toBeVisible()
  })

  test('최근 범위에 보낸 메일이 하나도 없어도 빈 목록에서 이전 메일을 가져온다', async ({ authenticatedPage: page }) => {
    await stubBase(page)
    let loaded = false
    await page.route(
      (u) => u.pathname === LIST,
      (route) => route.fulfill({ json: loaded ? [row(500)] : [] }),
    )
    await page.route(
      (u) => u.pathname === OLDER,
      (route) => {
        loaded = true
        return route.fulfill({ json: olderResult({ fetched: 1, saved: 1, hasMore: false }) })
      },
    )

    await page.goto('/mail/1?folder=sent')

    await expect(page.getByTestId('mail-row-500')).toBeVisible()
    await expect(page.getByTestId('mail-list-no-older')).toBeVisible()
  })

  test('다른 분류 보기에서는 서버에서 가져오지 않는다(검색·안 읽은 메일만 제외는 vitest mailListPages)', async ({ authenticatedPage: page }) => {
    await stubBase(page)
    await mockApi(page, 'GET', LIST, rows(1000, 999))
    const olders = trackRequests(page, 'POST', OLDER)

    await page.goto('/mail/1?category=개인')
    await expect(page.getByTestId('mail-row-999')).toBeVisible()
    await expectStays(page, olders.count, 0)
    await expect(page.getByTestId('mail-list-no-older')).toHaveCount(0)
  })

  test('가져오기에 실패하면 목록 끝에 「다시 시도」 — 누르면 다시 부른다', async ({ authenticatedPage: page }) => {
    await stubBase(page)
    await mockApi(page, 'GET', LIST, rows(1000, 999))
    let fail = true
    await page.route(
      (u) => u.pathname === OLDER,
      (route) =>
        fail
          ? route.fulfill({ status: 502, json: { message: '메일 서버에 연결하지 못했습니다' } })
          : route.fulfill({ json: olderResult() }),
    )
    const olders = trackRequests(page, 'POST', OLDER)

    await page.goto('/mail/1')
    const error = page.getByTestId('mail-list-end').getByRole('button', { name: '이전 메일을 가져오지 못했습니다 — 다시 시도' })
    await expect(error).toBeVisible()
    // 실패한 뒤에는 스스로 다시 부르지 않는다.
    await expectStays(page, olders.count, 1)

    fail = false
    await error.click()
    await expect(page.getByTestId('mail-list-no-older')).toBeVisible()
    expect(olders.count()).toBe(2)
  })
})
