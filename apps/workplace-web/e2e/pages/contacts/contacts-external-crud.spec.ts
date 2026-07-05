// 외부 연락처 CRUD E2E — 생성·편집·삭제 (page.route 모킹). 입력→payload→UI 반영 검증.
import type { Page } from '@playwright/test'

import { external, externalDetail, page as makePage } from '../../factories/contacts.factory'
import { expect, test } from '../../fixtures/auth.fixture'

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
  // 버튼을 좌측에 배치해 중앙 고정 AI 칩과 겹치지 않으므로 일반 클릭으로 동작해야 한다
  await page.getByTestId('contact-create').click()
  await expect(page.getByTestId('external-contact-dialog')).toBeVisible()
  await page.getByTestId('c-name').fill('신규연락처')
  await page.getByTestId('c-email').fill('new@corp.com')

  // 저장 직전, 목록을 신규 행 포함으로 재라우팅 (Playwright 는 마지막 등록 라우트 우선).
  // 생성 mutation 이 contactKeys.all 을 무효화해 재요청 시 신규 행을 받게 한다.
  await page.route(
    (url) => url.pathname === '/api/v1/contacts',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(makePage([external(), external({ id: 200, name: '신규연락처' })])),
      }),
  )
  await page.getByTestId('c-save').click()

  // payload 검증
  await expect.poll(() => posted).not.toBeNull()
  expect(posted!.name).toBe('신규연락처')
  expect(posted!.email).toBe('new@corp.com')
  expect(posted!.visibility).toBe('PERSONAL')
  // 다이얼로그 닫힘
  await expect(page.getByTestId('external-contact-dialog')).toHaveCount(0)
  // UI 반영 — 신규 행이 목록에 노출된다
  await expect(page.getByTestId('contact-row-EXTERNAL-200')).toBeVisible()
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

  // 저장 직전, 상세 GET 을 수정된 값으로 재라우팅 (마지막 등록 우선).
  // PATCH 후 mutation 무효화로 재요청되는 상세가 '수정됨' 을 반환하게 한다.
  // PATCH 는 method 체크로 위 라우트가 처리하도록 fallback.
  await page.route(
    (url) => url.pathname === '/api/v1/contacts/external/100',
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(externalDetail({ name: '수정됨' })),
      })
    },
  )
  await page.getByTestId('c-save').click()

  await expect.poll(() => patched).not.toBeNull()
  expect(patched!.name).toBe('수정됨')
  // UI 반영 — 상세 패널이 수정된 이름을 보여준다
  await expect(page.getByTestId('contact-detail-external')).toContainText('수정됨')
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

  // 삭제 확정 직전, 목록을 빈 페이지로 재라우팅 (Playwright 는 마지막 등록 라우트 우선).
  // 삭제 mutation 이 contactKeys.all 을 무효화해 재요청 시 빈 목록을 받게 한다.
  await page.route(
    (url) => url.pathname === '/api/v1/contacts',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(makePage([])),
      }),
  )

  // DeleteConfirmDialog 확인 — AlertDialogAction "삭제"
  await page.getByRole('button', { name: '삭제' }).last().click()

  await expect.poll(() => deleted).toBe(true)
  // 선택 해제 → empty 상태
  await expect(page.getByTestId('contact-detail-empty')).toBeVisible()
  // 목록에서 제거됨 — 재요청 후 행이 사라진다
  await expect(page.getByTestId('contact-row-EXTERNAL-100')).toHaveCount(0)
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
