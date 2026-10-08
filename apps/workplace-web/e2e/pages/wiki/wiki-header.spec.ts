// 노트 페이지 헤더 — 브레드크럼 경로 렌더 + 조상 클릭 내비게이션, 헤더 ⋯ 삭제 플로우.
import type { Page } from '@playwright/test'

import type { WikiPageDetail, WikiPageSummary, WikiSpace } from '../../../src/types/wiki'
import { expect, test } from '../../fixtures/auth.fixture'
import { trackRequests } from '../../fixtures/requests'
import { DESKTOP_WIDTHS, boxOf, expectHeaderBottomAt56, expectStartAligned } from '../../fixtures/layout'
import { measureBox } from '../../fixtures/wait'

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

// 공통 모킹 — 스페이스/트리/백링크/멘션 + 페이지 GET·DELETE.
async function setupRoutes(page: Page) {
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
    // DELETE → 204. 그 외(GET 등) → 페이지 상세.
    if (r.request().method() === 'DELETE') return r.fulfill({ status: 204, body: '' })
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
  const deletes = trackRequests(page, 'DELETE', /^\/api\/v1\/wiki\/pages\/[^/]+$/)
  await setupRoutes(page)

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/2`)
  // 헤더 ⋯ 메뉴 → 페이지 삭제 → 확인 다이얼로그.
  await page.getByTestId('wiki-page-header').getByRole('button', { name: '페이지 메뉴' }).click()
  await page.getByRole('menuitem', { name: '페이지 삭제' }).click()
  await expect(page.getByTestId('wiki-delete-dialog')).toBeVisible()

  await page
    .getByTestId('wiki-delete-dialog')
    .getByRole('button', { name: '삭제', exact: true })
    .click()

  await deletes.waitFor()
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

// #830: 제목이 길어 브레드크럼이 truncate 폭 전체를 채워도, 뷰포트 중앙에 fixed 로 떠 있는
// 전역 AI 어시스턴트 런처(AIChip)와 겹치지 않아야 한다 — Page.Header 좌측 그룹 공통 클램프(aiChipSafeLeftMaxW) 회귀 검증.
test('노트 헤더 — 긴 제목의 브레드크럼이 전역 AI 어시스턴트 런처와 겹치지 않는다 (#830)', async ({
  authenticatedPage: page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const longTitle = '가나다라마바사아자차카타파하'.repeat(15) // 210자
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
      body: JSON.stringify(detail(1, longTitle)),
    })
  })

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/1`)
  const nav = page.getByTestId('wiki-page-header').getByRole('navigation', { name: '페이지 경로' })
  const launcher = page.getByTestId('chat-launcher')
  await expect(nav).toBeVisible()
  await expect(launcher).toBeVisible()

  // 헤더·런처가 보인 직후엔 레이아웃(truncate 폭)이 자리 잡기 전일 수 있어 측정+단언을 재시도한다 (WP-225)
  await expect(async () => {
    const navBox = await measureBox(nav, 'nav')
    const launcherBox = await measureBox(launcher, 'launcher')
    // 브레드크럼 nav 의 우측 끝이 AI 런처의 좌측 끝을 넘지 않아야 한다(= 겹치지 않음).
    expect(navBox.x + navBox.width).toBeLessThanOrEqual(launcherBox.x)
  }).toPass()
})

// 페이지 틀(Page) 통합: 경로 nav 첫 크럼과 본문 제목이 같은 16px 축(왼쪽 정렬 reading 폭, 넓은 화면에서도 가운데로 몰리지 않음).
for (const width of DESKTOP_WIDTHS) {
  test(`노트 헤더 — 경로 첫 크럼과 본문 제목이 같은 x, 본문 폭 ≤ 768 @${width}px`, async ({
    authenticatedPage: page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await setupRoutes(page)

    await page.goto(`/wiki/spaces/${SPACE_ID}/pages/2`)
    const header = page.getByTestId('wiki-page-header')
    await expectHeaderBottomAt56(header)
    // 첫 크럼(조상 버튼) ↔ 본문 제목 입력. page-body-content 자신은 여백 포함이라 내용 요소로 비교한다.
    await expectStartAligned(
      header.getByRole('navigation', { name: '페이지 경로' }).getByRole('button', { name: '제품 문서' }),
      page.getByPlaceholder('제목 없음'),
    )
    expect((await boxOf(page.getByTestId('page-body-content'))).width).toBeLessThanOrEqual(768)
  })
}

// 긴 경로(크럼 6개)도 경로 nav 가 AI 칩 좌측 경계를 넘지 않는다 — Page.Header 공통 클램프(aiChipSafeLeftMaxW).
test('노트 헤더 — 크럼 6개인 긴 경로도 AI 어시스턴트 런처와 겹치지 않는다', async ({
  authenticatedPage: page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const deep: WikiPageSummary[] = Array.from({ length: 6 }, (_, i) => ({
    id: i + 1,
    parentId: i === 0 ? null : i,
    title: `아주 긴 단계 이름 ${i + 1} 번째 노트`,
    position: 0,
    aiLastUsedAt: null,
  }))
  await page.route('**/api/v1/wiki/spaces', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([space]) }),
  )
  await page.route(`**/api/v1/wiki/spaces/${SPACE_ID}/pages`, (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(deep) }),
  )
  await page.route('**/api/v1/wiki/pages/*/backlinks', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  await page.route('**/api/v1/wiki/pages/*/mentions', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  await page.route('**/api/v1/wiki/pages/*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...detail(6, deep[5].title), parentId: 5 }),
    }),
  )

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/6`)
  const nav = page.getByTestId('wiki-page-header').getByRole('navigation', { name: '페이지 경로' })
  const launcher = page.getByTestId('chat-launcher')
  await expect(nav.getByRole('button')).toHaveCount(5)
  await expect(launcher).toBeVisible()
  await expect(async () => {
    const navBox = await measureBox(nav, 'nav')
    const launcherBox = await measureBox(launcher, 'launcher')
    expect(navBox.x + navBox.width).toBeLessThanOrEqual(launcherBox.x)
  }).toPass()
})
