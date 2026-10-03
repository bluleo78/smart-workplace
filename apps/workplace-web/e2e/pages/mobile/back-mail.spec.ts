// 모바일 뒤로가기 히스토리 — 메일 상세(?messageId)(WP-206).
// 시스템 뒤로가기·‹ 가 상세만 닫고 받은편지함에 남는다. 딥링크 ‹ 는 앱 밖으로 나가지 않고, 홈 위젯에서 들어오면 홈으로 돌아간다.
import type { Page } from '@playwright/test'

import type { DashboardLayout, MailSummary } from '../../../src/types/dashboard'
import { detail, mailAccount, summary } from '../../factories/mail.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/mobile.fixture'

// 실데이터 폭 검증용 긴 제목.
const LONG_SUBJECT = '2026년 4분기 제품 로드맵 검토 회의 — 모바일 앱 출시 일정과 결제 모듈 리팩터링 우선순위 재조정 안건'

async function stubMail(page: Page, extraRows = 0) {
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
  const filler = Array.from({ length: extraRows }, (_, i) =>
    summary({ id: 100 + i, subject: `${LONG_SUBJECT} #${i}`, snippet: '스크롤 확인용 메일', seen: true }),
  )
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/messages', [
    summary(),
    summary({ id: 11, subject: LONG_SUBJECT, snippet: '안건 정리본을 공유드립니다', seen: true }),
    ...filler,
  ])
  await mockApi(page, 'GET', '/api/v1/mail/messages/10', detail())
  await mockApi(page, 'GET', '/api/v1/mail/messages/11', detail({ id: 11, subject: LONG_SUBJECT }))
  for (const m of filler) await mockApi(page, 'GET', `/api/v1/mail/messages/${m.id}`, detail({ id: m.id, subject: m.subject }))
}

test('goBack 은 상세만 닫고 받은편지함에 남는다 — ‹ 도 같은 결과', async ({ authenticatedPage: page }) => {
  await stubMail(page)
  await page.goto('/mail/1')
  await page.getByTestId('mail-row-10').click()
  await expect(page).toHaveURL(/\/mail\/1\?messageId=10$/)
  await expect(page.getByTestId('mail-detail')).toBeVisible()

  await page.goBack()
  await expect(page).toHaveURL(/\/mail\/1$/)
  await expect(page.getByTestId('mail-list')).toBeVisible()
  await expect(page.getByTestId('mail-detail-pane')).toBeHidden()

  await page.getByTestId('mail-row-10').click()
  await expect(page.getByTestId('mail-detail')).toBeVisible()
  await page.getByTestId('mail-back').click()
  await expect(page).toHaveURL(/\/mail\/1$/)
  await expect(page.getByTestId('mail-list')).toBeVisible()
  await expect(page.getByTestId('mobile-tabbar')).toBeVisible()
})

test('‹ 를 같은 틱에 두 번 눌러도 한 번만 닫힌다(앱 밖으로 빠지지 않음)', async ({ authenticatedPage: page }) => {
  await stubMail(page)
  await page.goto('/mail/1')
  await page.getByTestId('mail-row-10').click()
  await expect(page.getByTestId('mail-detail')).toBeVisible()
  // popstate 가 오기 전에 두 번 — 가드가 없으면 두 번째 navigate(-1) 이 about:blank 로 빠진다.
  await page.getByTestId('mail-back').evaluate((el: HTMLElement) => {
    el.click()
    el.click()
  })
  await expect(page).toHaveURL(/\/mail\/1$/)
  await expect(page.getByTestId('mail-list')).toBeVisible()
})

test('딥링크(?messageId) 진입 후 ‹ → 같은 모듈 목록(앱 밖으로 나가지 않음)', async ({ authenticatedPage: page }) => {
  await stubMail(page)
  await page.goto('/mail/1?messageId=11')
  await expect(page.getByTestId('mail-detail')).toContainText(LONG_SUBJECT)
  await page.getByTestId('mail-back').click()
  await expect(page).toHaveURL(/\/mail\/1$/)
  await expect(page.getByTestId('mail-list')).toBeVisible()
})

test('홈 위젯 → 메일: ‹ 와 goBack 이 모두 홈으로 돌아간다', async ({ authenticatedPage: page }) => {
  await stubMail(page)
  // unread_mail 은 본문형 위젯 — collapsed:false 면 행(dash-mail-row)이 보인다.
  const layout: DashboardLayout = { widgets: [{ id: 'unread_mail', type: 'unread_mail', count: 3, hidden: false, collapsed: false }] }
  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout)
  const mail: MailSummary = { unreadCount: 1, needsReplyCount: 0, classificationActive: false, recent: [summary()] }
  await mockApi(page, 'GET', '/api/v1/me/mail-summary', mail)

  await page.goto('/')
  await page.getByTestId('dash-mail-row').first().click()
  await expect(page).toHaveURL(/\/mail\/1\?messageId=10$/)
  await page.getByTestId('mail-back').click()
  await expect.poll(() => new URL(page.url()).pathname).toBe('/')

  await page.getByTestId('dash-mail-row').first().click()
  await expect(page).toHaveURL(/\/mail\/1\?messageId=10$/)
  await page.goBack()
  await expect.poll(() => new URL(page.url()).pathname).toBe('/')
})

test('데스크톱 2단: 같은 행 재클릭·행 전환 후 goBack 1회로 선택 해제', async ({ authenticatedPage: page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await stubMail(page)
  await page.goto('/mail/1')
  await page.getByTestId('mail-row-10').click()
  await page.getByTestId('mail-row-10').click()
  await page.getByTestId('mail-row-11').click()
  await expect(page).toHaveURL(/\/mail\/1\?messageId=11$/)
  await page.goBack()
  await expect(page).toHaveURL(/\/mail\/1$/)
  await expect(page.getByTestId('mail-detail-empty')).toBeVisible()
})

test('상세를 닫으면 목록 스크롤 위치가 유지된다', async ({ authenticatedPage: page }) => {
  await stubMail(page, 40)
  await page.goto('/mail/1')
  const scroller = page.getByTestId('mail-list-scroll')
  await page.getByTestId('mail-row-130').scrollIntoViewIfNeeded()
  const before = await scroller.evaluate((el) => el.scrollTop)
  expect(before).toBeGreaterThan(200)
  await page.getByTestId('mail-row-130').click()
  await expect(page.getByTestId('mail-detail')).toBeVisible()
  await page.goBack()
  await expect(page.getByTestId('mail-list')).toBeVisible()
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(before - 5)
})
