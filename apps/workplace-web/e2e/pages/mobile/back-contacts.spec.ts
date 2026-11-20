// 모바일 뒤로가기 히스토리 — 연락처 상세(?contact=member:<id>|external:<id>)(WP-206).
// 브라우저 뒤로가기(goBack)가 상세만 닫는지(@platform)만 남긴다. 딥링크 → ‹ 닫기·404 안내·필터 변경 시 contact 키 삭제는
// 페이지 테스트 src/pages/mobile/backContacts.test.tsx·backContactsDesktop.test.tsx 가 지킨다(WP-971).
import type { Page } from '@playwright/test'

import { external, externalDetail, member, memberDetail, page as makePage } from '../../factories/contacts.factory'
import { mailAccount } from '../../factories/mail.factory'
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

// WP-1769: 구성원 상세의 메시지·메일 쓰기·일정 잡기 단추가 390px 에서 한 줄로 들어가고 가로로 넘치지 않는다.
test('390px 구성원 상세의 사람 단추 셋이 한 줄에 들어간다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await stubContacts(page)
  // 메일 계정이 있어야 「메일 쓰기」 가 정상(활성)으로 그려진다.
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
  // 로그인 사용자(id 1)는 「내 프로필」 단추 하나만 받으므로 다른 구성원(id 7)을 연다.
  await page.route((u) => u.pathname === '/api/v1/contacts', (r) =>
    r.fulfill({ json: makePage([member({ id: 7, name: '이동료' })]) }))
  await mockApi(page, 'GET', '/api/v1/contacts/members/7', memberDetail({ id: 7, username: 'lee', name: '이동료', email: 'lee@example.com' }))
  await page.goto('/contacts')
  await page.getByTestId('contact-row-MEMBER-7').getByRole('button').first().click()

  const buttons = page.getByTestId('contact-detail-actions').getByRole('button')
  await expect(buttons).toHaveCount(3)
  // 메일 계정 응답 전에는 「메일 쓰기」가 막힌 모양(aria-disabled·툴팁 래퍼)이다 — 활성이 된 뒤의 모양을 잰다.
  await expect(buttons.filter({ hasText: '메일 쓰기' })).not.toHaveAttribute('aria-disabled', 'true')
  const boxes = []
  for (let i = 0; i < 3; i++) {
    const box = await buttons.nth(i).boundingBox()
    expect(box).not.toBeNull()
    boxes.push(box!)
  }
  // 세 단추의 y 가 같다(한 줄), 마지막 단추 오른쪽 끝이 화면 안
  expect(boxes[1].y).toBe(boxes[0].y)
  expect(boxes[2].y).toBe(boxes[0].y)
  expect(boxes[2].x + boxes[2].width).toBeLessThanOrEqual(390)
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(scrollWidth).toBeLessThanOrEqual(390)
})
