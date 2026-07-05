// WikiEditor 헤딩 타이포그래피 회귀 테스트 (refs #300)
// Tailwind v4 preflight 가 h1~h3 기본 스타일을 리셋하므로,
// .ProseMirror 내 h1/h2/h3 에 명시적 font-size / font-weight 가 적용되는지 검증한다.
// 입력 → 마크다운 변환 → getComputedStyle 검증 파이프라인 전체를 커버한다.
import type { WikiPageDetail, WikiPageSummary, WikiSpace } from '../../../src/types/wiki'
import { expect, test } from '../../fixtures/auth.fixture'

const SPACE_ID = 1
const PAGE_ID = 1

const space: WikiSpace = {
  id: SPACE_ID,
  type: 'PERSONAL',
  name: '내 노트',
  ownerId: 1,
  role: 'OWNER',
  createdAt: '2026-06-01T00:00:00Z',
}

const pageDetail: WikiPageDetail = {
  id: PAGE_ID,
  spaceId: SPACE_ID,
  parentId: null,
  title: '헤딩 테스트 페이지',
  body: '',
  version: 1,
  updatedBy: 1,
  updatedAt: '2026-06-01T00:00:00Z',
}

const tree: WikiPageSummary[] = [{ id: PAGE_ID, parentId: null, title: '헤딩 테스트 페이지', position: 0 }]

async function setupRoutes(page: import('@playwright/test').Page) {
  await page.route('**/api/v1/wiki/spaces', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([space]) }),
  )
  await page.route(`**/api/v1/wiki/spaces/${SPACE_ID}/pages`, (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tree) }),
  )
  await page.route('**/api/v1/wiki/pages/*/backlinks', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  await page.route('**/api/v1/wiki/pages/*/mentions', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  await page.route('**/api/v1/wiki/pages/*', (r) => {
    if (r.request().method() === 'PUT') {
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pageDetail) })
    }
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(pageDetail),
    })
  })
}

// h1/h2/h3 각각 마크다운 입력 → Tiptap 헤딩 변환 → 스타일 검증
test(
  'WikiEditor — h1 마크다운 입력 후 28px/600 스타일 적용',
  { tag: '@smoke' },
  async ({ authenticatedPage: page }) => {
    await setupRoutes(page)
    await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)

    const editor = page.locator('.ProseMirror')
    await editor.waitFor({ state: 'visible' })
    await editor.click()

    // 마크다운 헤딩 입력: '# ' → Tiptap 이 h1 으로 변환
    await page.keyboard.press('Control+End')
    await page.keyboard.type('# H1 제목')
    await page.keyboard.press('Space')

    const h1 = editor.locator('h1').first()
    await expect(h1).toBeVisible()

    // 폰트 크기와 굵기 검증
    const fontSize = await h1.evaluate((el) => window.getComputedStyle(el).fontSize)
    const fontWeight = await h1.evaluate((el) => window.getComputedStyle(el).fontWeight)

    expect(fontSize).toBe('28px')
    expect(fontWeight).toBe('600')
  },
)

test('WikiEditor — h2 마크다운 입력 후 24px/600 스타일 적용', async ({ authenticatedPage: page }) => {
  await setupRoutes(page)
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)

  const editor = page.locator('.ProseMirror')
  await editor.waitFor({ state: 'visible' })
  await editor.click()

  await page.keyboard.press('Control+End')
  await page.keyboard.type('## H2 섹션')
  await page.keyboard.press('Space')

  const h2 = editor.locator('h2').first()
  await expect(h2).toBeVisible()

  const fontSize = await h2.evaluate((el) => window.getComputedStyle(el).fontSize)
  const fontWeight = await h2.evaluate((el) => window.getComputedStyle(el).fontWeight)

  expect(fontSize).toBe('24px')
  expect(fontWeight).toBe('600')
})

test('WikiEditor — h3 마크다운 입력 후 18px/600 스타일 적용', async ({ authenticatedPage: page }) => {
  await setupRoutes(page)
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)

  const editor = page.locator('.ProseMirror')
  await editor.waitFor({ state: 'visible' })
  await editor.click()

  await page.keyboard.press('Control+End')
  await page.keyboard.type('### H3 소섹션')
  await page.keyboard.press('Space')

  const h3 = editor.locator('h3').first()
  await expect(h3).toBeVisible()

  const fontSize = await h3.evaluate((el) => window.getComputedStyle(el).fontSize)
  const fontWeight = await h3.evaluate((el) => window.getComputedStyle(el).fontWeight)

  expect(fontSize).toBe('18px')
  expect(fontWeight).toBe('600')
})
