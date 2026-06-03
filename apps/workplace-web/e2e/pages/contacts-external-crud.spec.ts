// 외부 연락처 CRUD E2E — 생성·편집·삭제 (page.route 모킹). 입력→payload→UI 반영 검증.
import type { Page } from '@playwright/test'

import { external, externalDetail, page as makePage } from '../factories/contacts.factory'
import { expect, test } from '../fixtures/auth.fixture'

// 목록: 항상 외부 1건 노출.
async function stubList(page: Page) {
  await page.route(
    (url) => url.pathname === '/api/v1/contacts',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(makePage([external()])),
      }),
  )
}

async function stubDetail(page: Page, over = {}) {
  await page.route(
    (url) => url.pathname === '/api/v1/contacts/external/100',
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(externalDetail(over)),
      })
    },
  )
}

test('외부 연락처 생성', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  await stubList(page)
  let posted: Record<string, unknown> | null = null
  await page.route(
    (url) => url.pathname === '/api/v1/contacts/external',
    (route) => {
      posted = route.request().postDataJSON()
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(externalDetail({ id: 200, name: '신규연락처' })),
      })
    },
  )

  await page.goto('/contacts')
  // 상단 고정 AI 런처가 버튼 영역과 겹칠 수 있어 JavaScript click
  await page.getByTestId('contact-create').dispatchEvent('click')
  await expect(page.getByTestId('external-contact-dialog')).toBeVisible()
  await page.getByTestId('c-name').fill('신규연락처')
  await page.getByTestId('c-email').fill('new@corp.com')
  await page.getByTestId('c-save').click()

  // payload 검증
  await expect.poll(() => posted).not.toBeNull()
  expect(posted!.name).toBe('신규연락처')
  expect(posted!.email).toBe('new@corp.com')
  expect(posted!.visibility).toBe('PERSONAL')
  // 다이얼로그 닫힘
  await expect(page.getByTestId('external-contact-dialog')).toHaveCount(0)
})

test('외부 연락처 편집', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  await stubList(page)
  await stubDetail(page)
  let patched: Record<string, unknown> | null = null
  await page.route(
    (url) => url.pathname === '/api/v1/contacts/external/100',
    (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback()
      patched = route.request().postDataJSON()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(externalDetail({ name: '수정됨' })),
      })
    },
  )

  await page.goto('/contacts')
  await page.getByTestId('contact-row-EXTERNAL-100').click()
  await expect(page.getByTestId('contact-detail-external')).toContainText('박외부')
  await page.getByTestId('contact-edit').click()
  await page.getByTestId('c-name').fill('수정됨')
  await page.getByTestId('c-save').click()

  await expect.poll(() => patched).not.toBeNull()
  expect(patched!.name).toBe('수정됨')
})

test('외부 연락처 삭제', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  await stubList(page)
  await stubDetail(page)
  let deleted = false
  await page.route(
    (url) => url.pathname === '/api/v1/contacts/external/100',
    (route) => {
      if (route.request().method() !== 'DELETE') return route.fallback()
      deleted = true
      return route.fulfill({ status: 204, body: '' })
    },
  )

  await page.goto('/contacts')
  await page.getByTestId('contact-row-EXTERNAL-100').click()
  await page.getByTestId('contact-delete').click()
  // DeleteConfirmDialog 확인 — AlertDialogAction "삭제"
  await page.getByRole('button', { name: '삭제' }).last().click()

  await expect.poll(() => deleted).toBe(true)
  // 선택 해제 → empty 상태
  await expect(page.getByTestId('contact-detail-empty')).toBeVisible()
})

test('editable=false 면 수정/삭제 미노출', async ({ authenticatedPage: page }) => {
  await stubList(page)
  await stubDetail(page, { editable: false })
  await page.goto('/contacts')
  await page.getByTestId('contact-row-EXTERNAL-100').click()
  await expect(page.getByTestId('contact-detail-external')).toContainText('박외부')
  await expect(page.getByTestId('contact-edit')).toHaveCount(0)
  await expect(page.getByTestId('contact-delete')).toHaveCount(0)
})
