// 노트 에디터 권한 게이트 E2E (#756) — VIEWER 는 본문을 입력할 수 없어야 한다.
// contenteditable 속성만 보면 "속성은 false 인데 실제로는 입력되는" 경우를 놓치므로,
// 실제로 타이핑을 시도한 뒤 본문이 그대로인지까지 확인한다.
import type { Page } from '@playwright/test'

import type { WikiPageDetail, WikiRole } from '../../../src/types/wiki'
import { expect, test } from '../../fixtures/auth.fixture'

const SPACE_ID = 1
const PAGE_ID = 310
const BODY = '원본 문장'

async function setup(page: Page, role: WikiRole) {
  await page.route((u) => u.pathname === '/api/v1/wiki/spaces', (r) =>
    r.request().method() === 'GET'
      ? r.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            { id: SPACE_ID, type: 'TEAM', name: '팀 노트', ownerId: 9, role, createdAt: '2026-06-01T00:00:00Z' },
          ]),
        })
      : r.fallback(),
  )
  await page.route((u) => u.pathname === `/api/v1/wiki/spaces/${SPACE_ID}/pages`, (r) =>
    r.request().method() === 'GET'
      ? r.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([{ id: PAGE_ID, parentId: null, title: '문서', position: 0, aiLastUsedAt: null }]),
        })
      : r.fallback(),
  )
  await page.route((u) => u.pathname === `/api/v1/wiki/spaces/${SPACE_ID}/members`, (r) =>
    r.request().method() === 'GET'
      ? r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
      : r.fallback(),
  )
  await page.route((u) => u.pathname === `/api/v1/wiki/pages/${PAGE_ID}`, (r) => {
    const d: WikiPageDetail = {
      id: PAGE_ID,
      spaceId: SPACE_ID,
      parentId: null,
      title: '문서',
      body: BODY,
      version: 1,
      updatedBy: 1,
      updatedAt: '2026-06-01T00:00:00Z',
      aiLastUsedAt: null,
      aiLastAction: null,
    }
    return r.request().method() === 'GET'
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(d) })
      : r.fallback()
  })
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toContainText(BODY)
}

test('VIEWER 는 본문을 편집할 수 없다', async ({ authenticatedPage: page }) => {
  await setup(page, 'VIEWER')

  const body = page.locator('.ProseMirror')
  await expect(body).toHaveAttribute('contenteditable', 'false')

  // 실제 입력 시도 — 한 글자도 들어가면 안 된다.
  await body.click()
  await page.keyboard.type('침입')
  await expect(body).toHaveText(BODY)
})

test('EDITOR 는 본문을 편집할 수 있다', async ({ authenticatedPage: page }) => {
  await setup(page, 'EDITOR')

  const body = page.locator('.ProseMirror')
  // 스페이스 목록이 도착하기 전에는 fail-closed(false)이므로 확정될 때까지 기다린다.
  await expect(body).toHaveAttribute('contenteditable', 'true')

  await body.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' 추가')
  await expect(body).toContainText('원본 문장 추가')
})
