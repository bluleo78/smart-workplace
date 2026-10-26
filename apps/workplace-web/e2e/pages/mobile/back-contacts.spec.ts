// 모바일 뒤로가기 히스토리 — 연락처 상세(?contact=member:<id>|external:<id>)(WP-206).
// 브라우저 뒤로가기(goBack)가 상세만 닫는지(@platform)만 남긴다. 딥링크 → ‹ 닫기·404 안내·필터 변경 시 contact 키 삭제는
// 페이지 테스트 src/pages/mobile/backContacts.test.tsx·backContactsDesktop.test.tsx 가 지킨다(WP-971).
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

test('goBack 은 상세만 닫고 연락처 목록에 남는다 — ‹ 도 같은 결과', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
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
  await page.getByTestId('contact-back').getByTestId('mobile-back').click()
  await expect(page).toHaveURL(/\/contacts$/)
  await expect(page.getByTestId('contact-list')).toBeVisible()
})

test('데스크톱 2단: 같은 행 재클릭·행 전환 후 goBack 1회로 선택 해제', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
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
