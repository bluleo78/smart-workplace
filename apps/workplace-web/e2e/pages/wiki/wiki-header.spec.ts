// 노트 페이지 헤더 — 브레드크럼 경로 렌더 + 조상 클릭 내비게이션, 헤더 ⋯ 삭제 플로우.
import type { Page } from '@playwright/test'

import type { WikiPageDetail, WikiPageSummary, WikiSpace } from '../../../src/types/wiki'
import { expect, test } from '../../fixtures/auth.fixture'

const SPACE_ID = 1
const space: WikiSpace = {
  id: SPACE_ID,
  type: 'PERSONAL',
  name: '내 노트',
  ownerId: 1,
  role: 'OWNER',
  createdAt: '2026-06-01T00:00:00Z',
}
const TREE: WikiPageSummary[] = [
  { id: 1, parentId: null, title: '제품 문서', position: 0, aiLastUsedAt: null },
  { id: 2, parentId: 1, title: '기획', position: 0, aiLastUsedAt: null },
]
function detail(id: number, title: string): WikiPageDetail {
  return {
    id,
    spaceId: SPACE_ID,
    parentId: id === 2 ? 1 : null,
    title,
    body: '',
    version: 1,
    updatedBy: 1,
    updatedAt: '2026-06-01T00:00:00Z',
    aiLastUsedAt: null,
    aiLastAction: null,
  }
}

// 공통 모킹 — 스페이스/트리/백링크/멘션 + 페이지 GET·DELETE. onDelete 로 삭제 호출을 관찰한다.
async function setupRoutes(page: Page, onDelete?: () => void) {
  await page.route('**/api/v1/wiki/spaces', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([space]) }),
  )
  await page.route(`**/api/v1/wiki/spaces/${SPACE_ID}/pages`, (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TREE) }),
  )
  await page.route('**/api/v1/wiki/pages/*/backlinks', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  await page.route('**/api/v1/wiki/pages/*/mentions', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  await page.route('**/api/v1/wiki/pages/*', (r) => {
    // DELETE → 호출 관찰 후 204. 그 외(GET 등) → 페이지 상세.
    if (r.request().method() === 'DELETE') {
      onDelete?.()
      return r.fulfill({ status: 204, body: '' })
    }
    const id = Number(new URL(r.request().url()).pathname.split('/').pop())
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(detail(id, id === 2 ? '기획' : '제품 문서')),
    })
  })
}

test(
  '노트 헤더 — 브레드크럼 경로 + 조상 클릭 내비게이션',
  { tag: '@smoke' },
  async ({ authenticatedPage: page }) => {
    await setupRoutes(page)

    await page.goto(`/wiki/spaces/${SPACE_ID}/pages/2`)
    const header = page.getByTestId('wiki-page-header')
    await expect(header.getByRole('button', { name: '제품 문서' })).toBeVisible()
    await expect(header).toContainText('기획')

    await header.getByRole('button', { name: '제품 문서' }).click()
    await expect(page).toHaveURL(new RegExp(`/wiki/spaces/${SPACE_ID}/pages/1$`))
  },
)

test('노트 헤더 — ⋯ 메뉴 → 페이지 삭제 확인 → DELETE 호출 + 스페이스 루트로 이동', async ({
  authenticatedPage: page,
}) => {
  let deleteCalled = false
  await setupRoutes(page, () => {
    deleteCalled = true
  })

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/2`)
  // 헤더 ⋯ 메뉴 → 페이지 삭제 → 확인 다이얼로그.
  await page.getByTestId('wiki-page-header').getByRole('button', { name: '페이지 메뉴' }).click()
  await page.getByRole('menuitem', { name: '페이지 삭제' }).click()
  await expect(page.getByTestId('wiki-delete-dialog')).toBeVisible()

  await page
    .getByTestId('wiki-delete-dialog')
    .getByRole('button', { name: '삭제', exact: true })
    .click()

  await expect.poll(() => deleteCalled).toBe(true)
  await expect(page).toHaveURL(/\/wiki\/spaces\/1$/)
})

// #736: AI 생성 attribution 배지 — 헤더 좌측(브레드크럼 옆)에 AiSignalBadge 노출.
test('노트 헤더 — AI 생성 이력이 있는 페이지는 브레드크럼 옆에 attribution 배지가 뜬다 (#736)', async ({
  authenticatedPage: page,
}) => {
  await page.route('**/api/v1/wiki/spaces', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([space]) }),
  )
  await page.route(`**/api/v1/wiki/spaces/${SPACE_ID}/pages`, (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TREE) }),
  )
  await page.route('**/api/v1/wiki/pages/*/backlinks', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  await page.route('**/api/v1/wiki/pages/*/mentions', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  await page.route('**/api/v1/wiki/pages/*', (r) => {
    if (r.request().method() === 'DELETE') return r.fulfill({ status: 204, body: '' })
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...detail(1, '제품 문서'),
        aiLastUsedAt: '2026-07-20T00:00:00Z',
        aiLastAction: 'draft',
      }),
    })
  })

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/1`)
  await expect(page.getByTestId('wiki-page-ai-attribution-badge')).toBeVisible()
  await expect(page.getByTestId('wiki-page-ai-attribution-badge')).toContainText('AI 생성 포함')
})

test('노트 헤더 — AI 이력이 없는 페이지는 attribution 배지가 뜨지 않는다 (#736)', async ({
  authenticatedPage: page,
}) => {
  await setupRoutes(page)

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/1`)
  await expect(page.getByTestId('wiki-page-header')).toBeVisible()
  await expect(page.getByTestId('wiki-page-ai-attribution-badge')).toHaveCount(0)
})
