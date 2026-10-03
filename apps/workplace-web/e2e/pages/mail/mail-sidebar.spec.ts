// 메일 사이드바 E2E — 계정 스위처(멀티계정 전환) · 폴더 nav active.
import type { Page } from '@playwright/test'

import type { MailUnreadCounts } from '../../../src/types/mailMessage'
import { detail, mailAccount, summary } from '../../factories/mail.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'

test.describe('메일 사이드바', () => {
  test('계정 스위처 → 다른 계정 선택 시 /mail/:id 이동 + 폴더 INBOX 초기화', async ({
    authenticatedPage: page,
  }) => {
    // 계정 2개.
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [
      mailAccount({ id: 1, emailAddress: 'me@example.com' }),
      mailAccount({ id: 2, emailAddress: 'work@example.com' }),
    ])
    // 두 계정의 메시지 목록은 빈 배열로 스텁(folder 파라미터 수집).
    const seen: { id: string; folder: string }[] = []
    for (const id of ['1', '2']) {
      await page.route(
        (url) => url.pathname === `/api/v1/mail/accounts/${id}/messages`,
        (route) => {
          seen.push({ id, folder: new URL(route.request().url()).searchParams.get('folder') ?? '' })
          return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
        },
      )
    }

    // 계정 2의 보낸편지함에서 시작.
    await page.goto('/mail/2?folder=sent')
    await expect(page.getByTestId('mail-account-switcher')).toContainText('work@example.com')

    // 스위처 열고 계정 1 선택 → /mail/1 (folder 파라미터 제거 = INBOX).
    await page.getByTestId('mail-account-switcher').click()
    await page.getByTestId('mail-account-1').click()
    await expect(page).toHaveURL(/\/mail\/1$/)
    await expect(page.getByTestId('mail-account-switcher')).toContainText('me@example.com')
    // 전환 후 계정 1 목록 요청의 folder 는 SENT 가 아니어야 한다(INBOX 초기화).
    await expect.poll(() => seen.some((s) => s.id === '1' && s.folder !== 'SENT')).toBe(true)
  })

  test('폴더 nav active — 보낸편지함 진입 시 aria-current', async ({
    authenticatedPage: page,
  }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
    await page.route(
      (url) => url.pathname === '/api/v1/mail/accounts/1/messages',
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )
    await page.goto('/mail/1?folder=sent')
    await expect(page.getByTestId('mail-folder-sent')).toHaveAttribute('aria-current', 'page')
    await expect(page.getByTestId('mail-folder-inbox')).not.toHaveAttribute('aria-current', 'page')
  })
})

// WP-186: 사이드바 — 받은편지함 하위 분류 + 안 읽은 수.
const counts = (over: Partial<MailUnreadCounts> = {}): MailUnreadCounts => ({
  classificationActive: true,
  inbox: 4,
  byCategory: { 업무: 2, 개인: 1, 알림: 1, 프로모션: 0, 뉴스레터: 0 },
  needsReply: 0,
  ...over,
})

async function stubInbox(page: Page, c: MailUnreadCounts) {
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/unread-counts', c)
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/needs-reply-count', { count: 0 })
  return mockApi(page, 'GET', '/api/v1/mail/accounts/1/messages', [], { capture: true })
}

test.describe('메일 사이드바 — 받은편지함 하위 분류(WP-186)', () => {
  test('기본 진입 = 업무 활성, 받은편지함은 전체로 가는 상위 항목, 하위마다 안 읽은 수', async ({ authenticatedPage: page }) => {
    const list = await stubInbox(page, counts())
    await page.goto('/mail/1')
    await expect.poll(() => list.lastRequest()?.searchParams.get('category')).toBe('업무') // 기본 = 업무(+미분류) 요청
    await expect(page.getByTestId('mail-filter-category-업무')).toHaveAttribute('aria-current', 'page')
    await expect(page.getByTestId('mail-folder-inbox')).not.toHaveAttribute('aria-current', 'page')
    await expect(page.getByTestId('mail-count-inbox')).toHaveText('4')
    await expect(page.getByTestId('mail-count-category-업무')).toHaveText('2')
    await expect(page.getByTestId('mail-count-category-프로모션')).toHaveCount(0) // 0 은 숨김
    // 별도 "분류" 섹션 제목은 없다
    await expect(page.getByTestId('mail-sidebar').getByText('분류', { exact: true })).toHaveCount(0)
  })

  test('받은편지함 클릭 → 전체(category=all) 활성', async ({ authenticatedPage: page }) => {
    const list = await stubInbox(page, counts())
    await page.goto('/mail/1')
    await page.getByTestId('mail-folder-inbox').click()
    await expect(page).toHaveURL(/\/mail\/1\?category=all$/)
    await expect(page.getByTestId('mail-folder-inbox')).toHaveAttribute('aria-current', 'page')
    // 전체는 category 를 API 로 보내지 않는다(category=all 도 보내지 않음).
    await expect.poll(() => list.lastRequest()?.searchParams.has('category')).toBe(false)
  })

  test('AI 분류 꺼짐 → 하위 분류 숨김, 받은편지함 활성', async ({ authenticatedPage: page }) => {
    await stubInbox(page, counts({ classificationActive: false }))
    await page.goto('/mail/1?category=업무')
    await expect(page.getByTestId('mail-filter-category-업무')).toHaveCount(0)
    await expect(page.getByTestId('mail-folder-inbox')).toHaveAttribute('aria-current', 'page')
  })

  test('딥링크(?messageId, category 없음) → 전체 보기로 열려 개인 메일 행이 목록에 보인다', async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
    await mockApi(page, 'GET', '/api/v1/mail/accounts/1/unread-counts', counts())
    await mockApi(page, 'GET', '/api/v1/mail/accounts/1/needs-reply-count', { count: 0 })
    await mockApi(page, 'GET', '/api/v1/mail/messages/55', detail({ id: 55, subject: '개인 메일' }))
    await mockApi(page, 'GET', '/api/v1/mail/messages/55/summary', { summary: null })
    const list = await mockApi(page, 'GET', '/api/v1/mail/accounts/1/messages', [summary({ id: 55, subject: '개인 메일', aiCategory: '개인' })], { capture: true })
    await page.goto('/mail/1?messageId=55')
    await expect(page.getByTestId('mail-row-55')).toBeVisible()
    await expect.poll(() => list.lastRequest()?.searchParams.has('category')).toBe(false) // 업무로 좁히지 않음
    await expect(page.getByTestId('mail-folder-inbox')).toHaveAttribute('aria-current', 'page')
  })
})
