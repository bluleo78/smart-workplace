// 모바일 메일 보기(WP-186) — 헤더 제목·☰ 시트 하위 분류·탭 배지.
import type { Page } from '@playwright/test'

import { mailAccount, summary } from '../../factories/mail.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, stubChat, test } from '../../fixtures/mobile.fixture'

/** 메일 화면·탭 배지에 필요한 API 를 모킹한다. */
async function stubMail(page: Page) {
  await stubChat(page)
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
  await mockApi(page, 'GET', '/api/v1/mail/unread-summary', { workUnread: 2 })
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/needs-reply-count', { count: 0 })
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/unread-counts', {
    classificationActive: true, inbox: 4, byCategory: { 업무: 2, 개인: 1, 알림: 1, 프로모션: 0, 뉴스레터: 0 }, needsReply: 0,
  })
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/messages', [summary({ id: 10 })])
}

test('헤더 제목 = 업무(글자만), ☰ 시트에 하위 분류와 안 읽은 수', async ({ authenticatedPage: page }) => {
  await stubMail(page)
  await page.goto('/mail/1')
  const h1 = page.getByTestId('page-header').locator('h1')
  await expect(h1).toHaveText('업무')
  await expect(h1.locator('button, a, svg')).toHaveCount(0)
  await page.getByTestId('mobile-sidebar-trigger').click()
  const sheet = page.getByTestId('mobile-sidebar-sheet')
  await expect(sheet.getByTestId('mail-filter-category-업무')).toHaveAttribute('aria-current', 'page')
  await expect(sheet.getByTestId('mail-count-category-업무')).toHaveText('2')
})

test('메일 탭 배지 = 업무 안 읽은 수 합', async ({ authenticatedPage: page }) => {
  await stubMail(page)
  await page.goto('/')
  await expect(page.getByTestId('mobile-tab-badge-mail')).toHaveText('2')
})
