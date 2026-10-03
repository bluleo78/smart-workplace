// 모바일 뒤로가기 히스토리 — 연락처 상세(?contact=member:<id>|external:<id>)(WP-206).
import type { Page } from '@playwright/test'

import { external, externalDetail, member, memberDetail, page as makePage } from '../../factories/contacts.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/mobile.fixture'

const LONG_ORG = '글로벌 클라우드 인프라 운영 및 보안 컨설팅 그룹 아시아태평양 지역 본부'

async function stubContacts(page: Page) {
  await page.route((u) => u.pathname === '/api/v1/contacts', (r) =>
    r.fulfill({ json: makePage([member(), external({ organization: LONG_ORG })]) }))
  await mockApi(page, 'GET', '/api/v1/contacts/members/1', memberDetail())
  await mockApi(page, 'GET', '/api/v1/contacts/external/100', externalDetail({ organization: LONG_ORG }))
  await mockApi(page, 'GET', '/api/v1/contacts/members/999', { message: 'not found' }, { status: 404 })
}

test('goBack 은 상세만 닫고 연락처 목록에 남는다 — ‹ 도 같은 결과', async ({ authenticatedPage: page }) => {
  await stubContacts(page)
  await page.goto('/contacts')
  await page.getByTestId('contact-row-MEMBER-1').getByRole('button').first().click()
  await expect(page).toHaveURL(/\/contacts\?contact=member%3A1$/)
  await expect(page.getByTestId('contact-detail-member')).toBeVisible()

  await page.goBack()
  await expect(page).toHaveURL(/\/contacts$/)
  await expect(page.getByTestId('contact-list')).toBeVisible()

  await page.getByTestId('contact-row-EXTERNAL-100').getByRole('button').first().click()
  await expect(page.getByTestId('contact-detail-external')).toBeVisible()
  await page.getByTestId('contact-back').click()
  await expect(page).toHaveURL(/\/contacts$/)
  await expect(page.getByTestId('contact-list')).toBeVisible()
})

test('딥링크(?contact) 진입 후 ‹ → 연락처 목록', async ({ authenticatedPage: page }) => {
  await stubContacts(page)
  await page.goto('/contacts?contact=external:100')
  await expect(page.getByTestId('contact-detail-external')).toBeVisible()
  await page.getByTestId('contact-back').click()
  await expect(page).toHaveURL(/\/contacts$/)
  await expect(page.getByTestId('contact-list')).toBeVisible()
})

test('없는 연락처 딥링크는 찾을 수 없음 상태를 보이고 ‹ 로 닫힌다', async ({ authenticatedPage: page }) => {
  await stubContacts(page)
  await page.goto('/contacts?contact=member:999')
  await expect(page.getByText('연락처를 찾을 수 없습니다')).toBeVisible()
  await page.getByTestId('contact-back').click()
  await expect(page).toHaveURL(/\/contacts$/)
})

test('데스크톱 2단: 같은 행 재클릭·행 전환 후 goBack 1회로 선택 해제', async ({ authenticatedPage: page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await stubContacts(page)
  await page.goto('/contacts')
  await page.getByTestId('contact-row-MEMBER-1').getByRole('button').first().click()
  await page.getByTestId('contact-row-MEMBER-1').getByRole('button').first().click()
  await page.getByTestId('contact-row-EXTERNAL-100').getByRole('button').first().click()
  await expect(page).toHaveURL(/contact=external%3A100$/)
  await page.goBack()
  await expect(page).toHaveURL(/\/contacts$/)
  await expect(page.getByTestId('contact-detail-empty')).toBeVisible()
})

test('딥링크 상세에서 필터를 바꾸면 contact 키가 함께 지워진다', async ({ authenticatedPage: page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await stubContacts(page)
  await page.goto('/contacts?contact=member:1')
  await expect(page.getByTestId('contact-detail-member')).toBeVisible()
  await page.getByTestId('contact-filter-EXTERNAL').click()
  await expect(page).toHaveURL(/\/contacts\?type=EXTERNAL$/)
  await expect(page.getByTestId('contact-detail-empty')).toBeVisible()
})
