// 공용 대화상자 닫기(X) 버튼 클릭 영역 E2E(#706) — 실제 크기라 브라우저에서 잰다(@layout).
// 닫았다 다시 열면 입력·오류가 남지 않음(#178)은 화면 테스트가 지킨다(WP-971) — 이슈 만들기는
// src/pages/projects/issueCreateValidation.test.tsx, 프로젝트 만들기는 src/pages/projects/projectCreateValidation.test.tsx,
// 역할 추가는 src/components/dialogForms.test.tsx.

import { expect, test } from '../fixtures/auth.fixture'
import { mockApi } from '../fixtures/api-mock'
import { createIssueSearchResponse, createIssue } from '../factories/issue.factory'
import { createProject } from '../factories/project.factory'
import { systemTypes } from '../factories/issueType.factory'

const PROJECT_KEY = 'WP'

// IssueCreateDialog — 프로젝트 상세 + 이슈 목록 + 이슈 유형 공통 스텁.
async function stubProjectPage(page: import('@playwright/test').Page) {
  await mockApi(page, 'GET', `/api/v1/projects/${PROJECT_KEY}`, createProject())
  await mockApi(
    page,
    'GET',
    `/api/v1/projects/${PROJECT_KEY}/issues`,
    createIssueSearchResponse([createIssue({ title: '기존 이슈' })]),
  )
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/types`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(systemTypes()),
      }),
  )
  // 라벨 / 스프린트 등 기타 GET 은 빈 목록으로 처리.
  await page.route(`**/api/v1/projects/${PROJECT_KEY}/**`, (route) => {
    if (route.request().method() === 'GET' && !route.request().url().includes('/issues')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
    return route.fallback()
  })
}

// 공용 DialogContent 닫기(X) 버튼 클릭 영역 — WCAG 2.5.8 최소 24x24px (#706).
test('Dialog 닫기 버튼 클릭 영역이 24x24px 이상이다 (#706)', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await stubProjectPage(page)
  await page.goto(`/projects/${PROJECT_KEY}`)

  await page.getByRole('button', { name: '+ 새 태스크' }).click()
  const dialog = page.getByRole('dialog', { name: '새 이슈' })
  await expect(dialog).toBeVisible()

  const closeBtn = dialog.locator('[data-slot="dialog-close"]')
  const box = await closeBtn.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.width).toBeGreaterThanOrEqual(24)
  expect(box!.height).toBeGreaterThanOrEqual(24)
})

// WP-1443 — Radix 닫기 이벤트·오버레이 입력은 실제 브라우저에서 네 경로를 함께 확인한다.
test('이슈 초안을 닫는 모든 경로에서 계속 작성하거나 버릴 수 있다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  await stubProjectPage(page)
  await page.goto(`/projects/${PROJECT_KEY}`)
  const openButton = page.getByRole('button', { name: '+ 새 태스크' })
  const dialog = page.getByRole('dialog', { name: '새 이슈' })
  const confirmation = page.getByRole('alertdialog', { name: '작성 중인 내용을 버릴까요?' })
  await openButton.click()

  const closeRequests = [
    { name: 'Escape', close: () => page.keyboard.press('Escape') },
    // 화면 모서리는 가운데 대화상자 바깥의 오버레이에 해당한다.
    { name: '바깥 클릭', close: () => page.mouse.click(5, 5) },
    { name: '닫기(X)', close: () => dialog.locator('[data-slot="dialog-close"]').click() },
    { name: '취소', close: () => dialog.getByRole('button', { name: '취소', exact: true }).click() },
  ]
  for (const request of closeRequests) {
    await test.step(request.name, async () => {
      await dialog.getByLabel(/^제목/).fill('작성 중인 제목')
      await dialog.getByLabel('본문', { exact: true }).fill('작성 중인 본문')
      await request.close()
      await expect(confirmation).toBeVisible()
      await confirmation.getByRole('button', { name: '계속 작성' }).click()
      await expect(confirmation).toBeHidden()
      await expect(dialog).toBeVisible()
      await expect(dialog.getByLabel(/^제목/)).toHaveValue('작성 중인 제목')
      await expect(dialog.getByLabel('본문', { exact: true })).toHaveValue('작성 중인 본문')
      await request.close()
      await expect(confirmation).toBeVisible()
      await confirmation.getByRole('button', { name: '버리기' }).click()
      await expect(confirmation).toBeHidden()
      await expect(dialog).toBeHidden()
      await openButton.click()
      await expect(dialog.getByLabel(/^제목/)).toHaveValue('')
      await expect(dialog.getByLabel('본문', { exact: true })).toHaveValue('')
    })
  }
})
