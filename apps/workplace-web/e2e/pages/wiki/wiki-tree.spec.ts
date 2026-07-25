// 노트 사이드바 트리 — 하위 페이지 생성(parentId payload) + 접기/펼치기 + 삭제 다이얼로그.
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
function detail(id: number, title: string, parentId: number | null): WikiPageDetail {
  return {
    id,
    spaceId: SPACE_ID,
    parentId,
    title,
    body: '',
    version: 1,
    updatedBy: 1,
    updatedAt: '2026-06-01T00:00:00Z',
    aiLastUsedAt: null,
    aiLastAction: null,
  }
}

async function routeCommon(page: Page) {
  await page.route('**/api/v1/wiki/spaces', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([space]) }),
  )
  await page.route('**/api/v1/wiki/pages/*/backlinks', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  await page.route('**/api/v1/wiki/pages/*/mentions', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
}

test('하위 페이지 생성 — ＋ 클릭 시 parentId payload + 트리/내비 반영', async ({ authenticatedPage: page }) => {
  await routeCommon(page)
  const state = { created: false }
  let postBody: { parentId: number | null; title: string } | null = null

  await page.route(`**/api/v1/wiki/spaces/${SPACE_ID}/pages`, (r) => {
    const method = r.request().method()
    if (method === 'GET') {
      const tree: WikiPageSummary[] = [
        { id: 1, parentId: null, title: '제품 문서', position: 0, aiLastUsedAt: null },
      ]
      if (state.created)
        tree.push({ id: 2, parentId: 1, title: '제목 없음', position: 0, aiLastUsedAt: null })
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tree) })
    }
    if (method === 'POST') {
      postBody = r.request().postDataJSON()
      state.created = true
      return r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(detail(2, '제목 없음', 1)) })
    }
    return r.fallback()
  })
  await page.route('**/api/v1/wiki/pages/*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail(1, '제품 문서', null)) }),
  )

  await page.goto(`/wiki/spaces/${SPACE_ID}`)
  const row = page.getByTestId('wiki-tree-row-1')
  await row.hover()
  await row.getByRole('button', { name: '하위 페이지' }).click()

  await expect.poll(() => postBody).not.toBeNull()
  expect(postBody!.parentId).toBe(1)
  // 실제 저장 title 은 빈 문자열이어야 한다 — "제목 없음"은 표시용 폴백일 뿐 초기 상태 값이 아니다(#596).
  expect(postBody!.title).toBe('')
  await expect(page).toHaveURL(new RegExp(`/wiki/spaces/${SPACE_ID}/pages/2$`))
  await expect(page.getByTestId('wiki-tree-row-2')).toBeVisible()
})

test('새 페이지 생성 직후 제목 입력 — placeholder 위에 이어붙지 않고 입력값만 저장(#596)', async ({
  authenticatedPage: page,
}) => {
  await routeCommon(page)
  let postBody: { parentId: number | null; title: string } | null = null

  await page.route(`**/api/v1/wiki/spaces/${SPACE_ID}/pages`, (r) => {
    if (r.request().method() === 'POST') {
      postBody = r.request().postDataJSON()
      return r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(detail(2, '', null)) })
    }
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ id: 1, parentId: null, title: '제품 문서', position: 0 }]),
    })
  })
  await page.route('**/api/v1/wiki/pages/*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail(2, '', null)) }),
  )

  await page.goto(`/wiki/spaces/${SPACE_ID}`)
  await page.getByRole('button', { name: '새 페이지', exact: true }).click()

  await expect.poll(() => postBody).not.toBeNull()
  // 생성 요청 자체가 빈 문자열 title 이어야 한다(리터럴 "제목 없음" 전송 금지).
  expect(postBody!.title).toBe('')

  // 새 페이지 진입 시 제목 input 은 실제 값이 비어 있어 placeholder 만 노출되고,
  // 클릭 후 바로 입력하면 접합 없이 입력값만 남아야 한다.
  const titleInput = page.locator('input[placeholder="제목 없음"]')
  await expect(titleInput).toHaveValue('')
  await titleInput.click()
  await titleInput.pressSequentially('탐색 테스트 문서')
  await expect(titleInput).toHaveValue('탐색 테스트 문서')
})

test('접기/펼치기 — 부모 토글 시 자손 숨김/노출', async ({ authenticatedPage: page }) => {
  await routeCommon(page)
  const tree: WikiPageSummary[] = [
    { id: 1, parentId: null, title: '제품 문서', position: 0, aiLastUsedAt: null },
    { id: 2, parentId: 1, title: '기획', position: 0, aiLastUsedAt: null },
  ]
  await page.route(`**/api/v1/wiki/spaces/${SPACE_ID}/pages`, (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tree) }),
  )
  await page.route('**/api/v1/wiki/pages/*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail(1, '제품 문서', null)) }),
  )

  await page.goto(`/wiki/spaces/${SPACE_ID}`)
  await expect(page.getByTestId('wiki-tree-row-2')).toBeVisible()
  await page.getByTestId('wiki-tree-row-1').getByRole('button', { name: '접기' }).click()
  await expect(page.getByTestId('wiki-tree-row-2')).toBeHidden()
  await page.getByTestId('wiki-tree-row-1').getByRole('button', { name: '펼치기' }).click()
  await expect(page.getByTestId('wiki-tree-row-2')).toBeVisible()
})

test('인라인 액션 버튼 — WCAG 2.5.8 최소 24×24px 충족', async ({ authenticatedPage: page }) => {
  await routeCommon(page)
  const tree: WikiPageSummary[] = [
    { id: 1, parentId: null, title: '제품 문서', position: 0, aiLastUsedAt: null },
    { id: 2, parentId: 1, title: '기획', position: 0, aiLastUsedAt: null },
  ]
  await page.route(`**/api/v1/wiki/spaces/${SPACE_ID}/pages`, (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tree) }),
  )
  await page.route('**/api/v1/wiki/pages/*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail(1, '제품 문서', null)) }),
  )

  await page.goto(`/wiki/spaces/${SPACE_ID}`)
  const row = page.getByTestId('wiki-tree-row-1')
  await row.hover()

  // 접기 토글, 하위 페이지, 페이지 메뉴 버튼 각각 24px 이상 확인
  for (const label of ['접기', '하위 페이지', '페이지 메뉴']) {
    const btn = row.getByRole('button', { name: label })
    const box = await btn.boundingBox()
    expect(box, `${label} 버튼의 boundingBox가 null`).not.toBeNull()
    expect(box!.width, `${label} 버튼 너비 < 24px`).toBeGreaterThanOrEqual(24)
    expect(box!.height, `${label} 버튼 높이 < 24px`).toBeGreaterThanOrEqual(24)
  }
})

test('삭제 — ⋯ 메뉴 → 다이얼로그 확인 시 DELETE, 취소 시 미호출', async ({ authenticatedPage: page }) => {
  await routeCommon(page)
  let deleteCalled = false
  await page.route(`**/api/v1/wiki/spaces/${SPACE_ID}/pages`, (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ id: 1, parentId: null, title: '제품 문서', position: 0 }]),
    }),
  )
  await page.route('**/api/v1/wiki/pages/*', (r) => {
    if (r.request().method() === 'DELETE') {
      deleteCalled = true
      return r.fulfill({ status: 204, body: '' })
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail(1, '제품 문서', null)) })
  })

  await page.goto(`/wiki/spaces/${SPACE_ID}`)
  const row = page.getByTestId('wiki-tree-row-1')
  await row.hover()
  await row.getByRole('button', { name: '페이지 메뉴' }).click()
  await page.getByRole('menuitem', { name: '삭제' }).click()
  await expect(page.getByTestId('wiki-delete-dialog')).toBeVisible()
  await page.getByRole('button', { name: '취소' }).click()
  expect(deleteCalled).toBe(false)
  await row.hover()
  await row.getByRole('button', { name: '페이지 메뉴' }).click()
  await page.getByRole('menuitem', { name: '삭제' }).click()
  await page.getByTestId('wiki-delete-dialog').getByRole('button', { name: '삭제' }).click()
  await expect.poll(() => deleteCalled).toBe(true)
})

test('삭제 다이얼로그 — 리프 페이지(하위 없음)에서는 하위 페이지 경고 미표시', async ({ authenticatedPage: page }) => {
  // 하위 없는 리프 페이지만 존재하는 트리 — hasChildren=false 케이스.
  await routeCommon(page)
  await page.route(`**/api/v1/wiki/spaces/${SPACE_ID}/pages`, (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ id: 1, parentId: null, title: '리프 페이지', position: 0 }]),
    }),
  )
  await page.route('**/api/v1/wiki/pages/*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail(1, '리프 페이지', null)) }),
  )

  await page.goto(`/wiki/spaces/${SPACE_ID}`)
  const row = page.getByTestId('wiki-tree-row-1')
  await row.hover()
  await row.getByRole('button', { name: '페이지 메뉴' }).click()
  await page.getByRole('menuitem', { name: '삭제' }).click()
  await expect(page.getByTestId('wiki-delete-dialog')).toBeVisible()
  // 하위 페이지가 없으므로 "하위 페이지도 함께 삭제되며" 문구는 표시되지 않아야 한다.
  await expect(page.getByTestId('wiki-delete-dialog')).not.toContainText('하위 페이지도 함께 삭제되며')
  await expect(page.getByTestId('wiki-delete-dialog')).toContainText('되돌릴 수 없습니다')
})

test('삭제 다이얼로그 — 하위 페이지가 있는 부모 페이지에서는 경고 표시', async ({ authenticatedPage: page }) => {
  // 부모-자식 구조 — 부모(id=1)를 삭제할 때 hasChildren=true 경고가 나타나야 한다.
  await routeCommon(page)
  await page.route(`**/api/v1/wiki/spaces/${SPACE_ID}/pages`, (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: 1, parentId: null, title: '부모 페이지', position: 0 },
        { id: 2, parentId: 1, title: '자식 페이지', position: 0 },
      ]),
    }),
  )
  await page.route('**/api/v1/wiki/pages/*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail(1, '부모 페이지', null)) }),
  )

  await page.goto(`/wiki/spaces/${SPACE_ID}`)
  const row = page.getByTestId('wiki-tree-row-1')
  await row.hover()
  await row.getByRole('button', { name: '페이지 메뉴' }).click()
  await page.getByRole('menuitem', { name: '삭제' }).click()
  await expect(page.getByTestId('wiki-delete-dialog')).toBeVisible()
  // 하위 페이지가 있으므로 동반 삭제 경고가 표시되어야 한다.
  await expect(page.getByTestId('wiki-delete-dialog')).toContainText('하위 페이지도 함께 삭제되며')
})

// #736: AI 생성 attribution 배지 — 사이드바 트리 제목 옆 AiSignalBadge 노출.
test('사이드바 트리 — AI 생성 이력이 있는 페이지만 제목 옆에 attribution 배지가 뜬다 (#736)', async ({
  authenticatedPage: page,
}) => {
  await routeCommon(page)
  await page.route(`**/api/v1/wiki/spaces/${SPACE_ID}/pages`, (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: 1, parentId: null, title: 'AI 이력 있음', position: 0, aiLastUsedAt: '2026-07-20T00:00:00Z' },
        { id: 2, parentId: null, title: 'AI 이력 없음', position: 1, aiLastUsedAt: null },
      ] satisfies WikiPageSummary[]),
    }),
  )
  await page.route('**/api/v1/wiki/pages/*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail(1, 'AI 이력 있음', null)) }),
  )

  await page.goto(`/wiki/spaces/${SPACE_ID}`)
  await expect(page.getByTestId('wiki-tree-ai-badge-1')).toBeVisible()
  await expect(page.getByTestId('wiki-tree-row-2').getByTestId('wiki-tree-ai-badge-2')).toHaveCount(0)
})
