// 위키 노트→이슈 cross-app E2E — 선택 블록 → "이슈로 만들기" → 다이얼로그 → /api/v1/actions/confirm → 이슈 칩 삽입.
import type { WikiPageDetail, WikiPageSummary, WikiRole, WikiSpace } from '../../../src/types/wiki'
import { expect, test } from '../../fixtures/auth.fixture'

const SPACE_ID = 1
const PAGE_ID = 400

function space(role: WikiRole): WikiSpace {
  return { id: SPACE_ID, type: 'TEAM', name: '팀 위키', ownerId: 1, role, createdAt: '2026-06-01T00:00:00Z' }
}
function pageDetail(): WikiPageDetail {
  return { id: PAGE_ID, spaceId: SPACE_ID, parentId: null, title: '노트', body: '', version: 1, updatedBy: 1, updatedAt: '2026-06-01T00:00:00Z', aiLastUsedAt: null, aiLastAction: null }
}

async function setup(page: import('@playwright/test').Page) {
  await page.route((u) => u.pathname === '/api/v1/wiki/spaces', (r) =>
    r.request().method() === 'GET'
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([space('EDITOR')]) })
      : r.fallback())
  await page.route((u) => u.pathname === `/api/v1/wiki/spaces/${SPACE_ID}/pages`, (r) =>
    r.request().method() === 'GET'
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: PAGE_ID, parentId: null, title: '노트', position: 0, aiLastUsedAt: null } as WikiPageSummary]) })
      : r.fallback())
  await page.route((u) => u.pathname === `/api/v1/wiki/spaces/${SPACE_ID}/members`, (r) =>
    r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }) : r.fallback())
  let version = 1
  await page.route((u) => u.pathname === `/api/v1/wiki/pages/${PAGE_ID}`, (r) => {
    const m = r.request().method()
    if (m === 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pageDetail()) })
    if (m === 'PUT') { version += 1; return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...pageDetail(), version }) }) }
    return r.fallback()
  })
  // 프로젝트 목록(피커) — 개인(PERSONAL,isDefault) + 팀.
  await page.route((u) => u.pathname === '/api/v1/projects', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      content: [
        { id: 9, key: 'ME', name: '내 프로젝트', type: 'PERSONAL', isDefault: true, ownerId: 1 },
        { id: 2, key: 'TEAM', name: '팀 프로젝트', type: 'TEAM', isDefault: false, ownerId: 1 },
      ], page: 0, size: 20, totalElements: 2, totalPages: 1,
    }) }))
}

test('위키 노트→이슈 — 선택 후 "이슈로 만들기" → confirm payload + 이슈 칩 삽입', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  await setup(page)
  let confirmBody: { actionType: string; params: Record<string, unknown> } | null = null
  await page.route('**/api/v1/actions/confirm', (r) => {
    confirmBody = r.request().postDataJSON() as typeof confirmBody
    return r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 77, projectKey: 'ME', number: 12, title: '회의 준비' }) })
  })

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()
  await page.locator('.ProseMirror').click()
  await page.keyboard.type('회의 준비')
  await page.keyboard.press('ControlOrMeta+a')

  // 변형 툴바에 "이슈로 만들기" 노출 → 클릭 → 다이얼로그.
  await page.getByTestId('wiki-ai-tb-create-issue').click()
  const dialog = page.getByTestId('wiki-create-issue-dialog')
  await expect(dialog).toBeVisible()
  // 제목 프리필 = 선택 첫 줄.
  await expect(dialog.getByTestId('issue-draft-title')).toHaveValue('회의 준비')
  // 담당(assignee) 피커는 위키 이슈 다이얼로그에서 노출되지 않아야 한다.
  await expect(dialog.getByTestId('issue-draft-assignee')).toHaveCount(0)
  // 확인.
  await page.getByTestId('wiki-create-issue-confirm').click()

  // payload: actionType=issue.create, params.projectKey=기본 개인(ME), title/body.
  await expect.poll(() => confirmBody?.actionType).toBe('issue.create')
  expect((confirmBody!.params as { projectKey: string }).projectKey).toBe('ME')
  expect((confirmBody!.params as { title: string }).title).toBe('회의 준비')

  // 이슈 칩(wikiMention ISSUE)이 본문에 삽입되고 클릭 가능.
  const chip = page.locator('.ProseMirror [data-mtype="ISSUE"]')
  await expect(chip).toBeVisible()
})

test('위키 노트→이슈 — VIEWER 는 "이슈로 만들기" 미노출', async ({ authenticatedPage: page }) => {
  await page.route((u) => u.pathname === '/api/v1/wiki/spaces', (r) =>
    r.request().method() === 'GET'
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([space('VIEWER')]) }) : r.fallback())
  await page.route((u) => u.pathname === `/api/v1/wiki/spaces/${SPACE_ID}/pages`, (r) =>
    r.request().method() === 'GET'
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: PAGE_ID, parentId: null, title: '노트', position: 0, aiLastUsedAt: null } as WikiPageSummary]) }) : r.fallback())
  await page.route((u) => u.pathname === `/api/v1/wiki/pages/${PAGE_ID}`, (r) =>
    r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pageDetail()) }) : r.fallback())
  await page.route((u) => u.pathname === `/api/v1/wiki/spaces/${SPACE_ID}/members`, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()
  await page.locator('.ProseMirror').click()
  await page.keyboard.type('내용')
  await page.keyboard.press('ControlOrMeta+a')
  await page.waitForTimeout(400)
  await expect(page.getByTestId('wiki-ai-tb-create-issue')).toHaveCount(0)
})
