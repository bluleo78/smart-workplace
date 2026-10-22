// 노트 에디터 권한 게이트 E2E (#756) — VIEWER 는 본문을 입력할 수 없어야 한다.
// contenteditable 속성만 보면 "속성은 false 인데 실제로는 입력되는" 경우를 놓치므로,
// 실제로 타이핑을 시도한 뒤 본문이 그대로인지까지 확인한다.
import type { Page } from '@playwright/test'

import type { WikiPageDetail, WikiRole } from '../../../src/types/wiki'
import { expect, test } from '../../fixtures/auth.fixture'
import { seedCollabFor } from '../../fixtures/collab'
import { openWikiEditor } from '../../fixtures/wiki-mock'

const SPACE_ID = 1
const PAGE_ID = 310
const BODY = '원본 문장'

async function setup(page: Page, role: WikiRole) {
  // 에디터 본문·역할은 동기화 서버 문서에서 온다(WP-172) — 모킹한 상세 본문·스페이스 역할과 같게 시드한다.
  await seedCollabFor(page, PAGE_ID, BODY, role)
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
  await openWikiEditor(page, { spaceId: SPACE_ID, pageId: PAGE_ID, readOnly: role === 'VIEWER' })
  await expect(page.locator('.ProseMirror')).toContainText(BODY)
}

// VIEWER 읽기 전용(contenteditable=false + 실제 타이핑이 본문을 바꾸지 않음)은 wiki-collab.spec.ts 「보기 권한은 읽기 전용 칩…」이 맡는다.

test('EDITOR 는 본문을 편집할 수 있다', async ({ authenticatedPage: page }) => {
  await setup(page, 'EDITOR')

  const body = page.locator('.ProseMirror')
  // 스페이스 목록이 도착하기 전에는 fail-closed(false)이므로 확정될 때까지 기다린다.
  await expect(body).toHaveAttribute('contenteditable', 'true')

  await body.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' 추가')
  await expect(body).toContainText('원본 문장 추가')
  // 편집 역할은 새 페이지·삭제가 그대로 보인다(WP-602 VIEWER 게이트의 반대쪽).
  await expect(page.getByRole('button', { name: '새 페이지' })).toBeVisible()
  await page.getByTestId('wiki-page-menu').click()
  await expect(page.getByTestId('wiki-menu-history')).toBeVisible()
  await expect(page.getByTestId('wiki-menu-delete')).toBeVisible()
})

// WP-602 — 팀 노트 VIEWER 에게는 만들기·삭제·끌어 옮기기를 보여 주지 않는다(눌러도 403 이었다). 읽기 메뉴(버전 기록)는 남는다.
test('VIEWER 는 새 페이지·하위 페이지·삭제 버튼이 보이지 않는다', async ({ authenticatedPage: page }) => {
  await setup(page, 'VIEWER')
  await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'false')
  await expect(page.getByRole('button', { name: '새 페이지' })).toHaveCount(0)
  // 트리 행 — 하위 페이지 ＋ 와 ⋯(삭제) 가 없다.
  const row = page.getByTestId(`wiki-tree-row-${PAGE_ID}`)
  await row.hover()
  await expect(row.getByRole('button', { name: '하위 페이지' })).toHaveCount(0)
  await expect(row.getByRole('button', { name: '페이지 메뉴' })).toHaveCount(0)
  // WP-713 — 끌 수 없을 뿐 페이지는 열 수 있다: dnd-kit 의 aria-disabled 가 행·열기 버튼을 「사용 불가」로 만들지 않는다.
  await expect(row).toHaveAttribute('role', 'group')
  await expect(row).not.toHaveAttribute('aria-disabled', /.+/)
  await expect(row.getByRole('button').last()).toBeEnabled()
  // 머리말 ⋯ — 버전 기록은 있고 「페이지 삭제」는 없다.
  await page.getByTestId('wiki-page-menu').click()
  await expect(page.getByTestId('wiki-menu-history')).toBeVisible()
  await expect(page.getByTestId('wiki-menu-delete')).toHaveCount(0)
})
