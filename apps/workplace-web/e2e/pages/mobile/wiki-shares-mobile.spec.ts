// 모바일 설정 › 내 공유 · 앱 설정 › 노트 — 제목이 긴 공유 페이지가 하나라도 있으면 페이지 칸이 280px 로 늘어 표가 화면보다
// 넓어지고, 행마다 링크 복사·열기·「해제」가 화면 밖으로 밀리던 문제(WP-1127). 휴대폰에서는 제목 칸을 화면 폭에 맞춰 줄이고
// 범위는 제목 아래로 옮겨, 표가 가로로 넘치지 않고 「해제」가 화면 안에 보인다.
import type { Page } from '@playwright/test'

import type { WikiShareListItem } from '../../../src/types/wiki'
import { expect, expectBodyNoHorizontalOverflow, test } from '../../fixtures/mobile.fixture'

/** 실제처럼 긴 제목 — 짧은 목데이터로는 폭 넘침이 드러나지 않는다. */
const LONG_TITLE = '2026년 하반기 제품 로드맵 및 분기별 출시 계획 — 플랫폼·모바일·AI 기능 우선순위 정리'

function share(over: Partial<WikiShareListItem> & Pick<WikiShareListItem, 'pageId' | 'title'>): WikiShareListItem {
  return {
    audience: 'WORKSPACE',
    permission: 'EDIT',
    includeChildren: true,
    peopleCount: 0,
    groupCount: 0,
    createdBy: { userId: 1, name: '나' },
    updatedAt: '2026-10-20T00:00:00Z',
    expiresAt: null,
    lastAccessedAt: null,
    viewCount: 0,
    spaceId: 1,
    spaceName: '내 노트',
    token: `wsh_${over.pageId}`,
    ...over,
  }
}

const SHARES: WikiShareListItem[] = [
  share({ pageId: 11, title: LONG_TITLE }),
  // 가장 긴 범위 글자 — 사람·부서를 함께 고른 공유.
  share({ pageId: 12, title: '온보딩', audience: 'PEOPLE', peopleCount: 12, groupCount: 3 }),
  share({ pageId: 13, title: '공개 안내', audience: 'PUBLIC', permission: 'VIEW' }),
]

/** 표가 가로로 넘치지 않고, 행마다 「해제」와 제목 아래 범위가 화면 안에 보인다. */
async function expectFits(page: Page) {
  const row = page.getByTestId('wiki-share-row-11')
  await expect(row).toContainText(LONG_TITLE.slice(0, 10))
  // 범위는 제목 아래에(넓은 화면의 범위 열은 숨김).
  // 숨긴 열 머리는 접근성 트리에 없어 역할로는 못 찾는다 — th 로 찾아 「있지만 숨김」을 본다.
  const scopeHeader = page.locator('thead th', { hasText: /^범위$/ })
  await expect(scopeHeader).toHaveCount(1)
  await expect(scopeHeader).toBeHidden()
  await expect(row.getByTestId('wiki-share-scope-mobile')).toHaveText('워크스페이스 전체 · 편집')
  // 가로로만 본다 — 관리자 화면은 표 위에 정책 칸이 있어 아래 행이 세로로 화면 밖일 수 있다.
  const viewportWidth = page.viewportSize()!.width
  for (const id of [11, 12, 13]) {
    const r = page.getByTestId(`wiki-share-row-${id}`)
    const box = (await r.getByRole('button', { name: '해제' }).boundingBox())!
    expect(box.x, `행 ${id} 해제 왼쪽 ${box.x}`).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width, `행 ${id} 해제 오른쪽 ${box.x + box.width} vs 화면 ${viewportWidth}`).toBeLessThanOrEqual(viewportWidth)
    // 범위 줄은 잘리지 않고 다 보인다(권한 「편집」·「보기」까지).
    const scope = r.getByTestId('wiki-share-scope-mobile')
    const clipped = await scope.evaluate((el) => el.scrollWidth > el.clientWidth + 1)
    expect(clipped, `행 ${id} 범위 줄이 잘림`).toBe(false)
  }
  const { scrollWidth, clientWidth } = await page.getByRole('table').evaluate((el) => {
    const scroller = (el as HTMLElement).parentElement!
    return { scrollWidth: scroller.scrollWidth, clientWidth: scroller.clientWidth }
  })
  expect(scrollWidth, `표 scrollWidth ${scrollWidth} vs clientWidth ${clientWidth}`).toBeLessThanOrEqual(clientWidth + 1)
  await expectBodyNoHorizontalOverflow(page)
}

// 가장 좁은 휴대폰(360px)에서도 본다 — 고르기 칸이 있는 관리자 표는 좁을수록 넘치기 쉽다.
for (const width of [390, 360]) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: 800 } })

    test('내 공유 — 긴 제목이 있어도 표가 화면 안에, 「해제」가 밀지 않고 보인다 (WP-1127)', { tag: '@layout' }, async ({
      authenticatedPage: page,
    }) => {
      await page.route((u) => u.pathname === '/api/v1/wiki/shares/mine', (r) => r.fulfill({ json: SHARES }))
      await page.goto('/settings/my-shares')
      await expectFits(page)
    })

    test('앱 설정 › 노트(관리자, 고르기 칸 포함) — 긴 제목이 있어도 표가 화면 안에 (WP-1127)', { tag: '@layout' }, async ({
      adminPage: page,
    }) => {
      await page.route((u) => u.pathname === '/api/v1/admin/wiki/shares', (r) => r.fulfill({ json: SHARES }))
      await page.route((u) => u.pathname === '/api/v1/admin/wiki/share-policy', (r) => r.fulfill({ json: { externalShareEnabled: true } }))
      await page.goto('/settings/apps/wiki')
      await expectFits(page)
    })
  })
}
