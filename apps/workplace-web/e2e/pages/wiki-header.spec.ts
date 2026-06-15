// 노트 페이지 헤더 — 브레드크럼 경로 렌더 + 조상 클릭 내비게이션, 저장상태 헤더 표시.
import type { WikiPageDetail, WikiPageSummary, WikiSpace } from '../../src/types/wiki'
import { expect, test } from '../fixtures/auth.fixture'

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
  { id: 1, parentId: null, title: '제품 문서', position: 0 },
  { id: 2, parentId: 1, title: '기획', position: 0 },
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
  }
}

test('노트 헤더 — 브레드크럼 경로 + 조상 클릭 내비게이션', async ({ authenticatedPage: page }) => {
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
    const id = Number(new URL(r.request().url()).pathname.split('/').pop())
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(detail(id, id === 2 ? '기획' : '제품 문서')),
    })
  })

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/2`)
  const header = page.getByTestId('wiki-page-header')
  await expect(header.getByRole('button', { name: '제품 문서' })).toBeVisible()
  await expect(header).toContainText('기획')

  await header.getByRole('button', { name: '제품 문서' }).click()
  await expect(page).toHaveURL(new RegExp(`/wiki/spaces/${SPACE_ID}/pages/1$`))
})
