// #739: 드라이브 원본 유실(blob missing) 파일 가시화 E2E.
// 브라우저가 있어야 판정되는 「원본 유실」 배지 글자 대비(@layout)만 남긴다.
// 배지·클릭 차단·인라인/⋯ 비활성은 src/pages/drive/driveRows.test.tsx, 판정 규칙의 경우의 수는 src/lib/driveRowActions.test.ts 가 지킨다(WP-413, WP-984).
import type { Page } from '@playwright/test'

import { createFile, createSpace, personalSpace } from '../../factories/drive.factory'
import { expect, test } from '../../fixtures/auth.fixture'
import { expectTheme, textContrast, withTheme } from '../../fixtures/contrast'

const SPACE_ID = 1

// 공간 목록 — DriveSidebar 가 마운트 시 페치한다(drive.spec.ts 패턴 동일).
async function stubSpaces(page: Page) {
  await page.route(
    (url) => url.pathname === '/api/v1/drive/spaces',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([personalSpace(), createSpace()]),
          })
        : route.fallback(),
  )
}

function stubItems(page: Page, files: unknown[]) {
  return page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ folders: [], files }),
          })
        : route.fallback(),
  )
}

// WP-303: 경고 배지(Badge warning) 글자가 옅은 앰버 배경 위 앰버 글자라 라이트에서 1.5:1 이던 회귀.
// 작은 글자(text-xs)이므로 WCAG AA 4.5:1 이상을 라이트·다크 모두에서 실측으로 지킨다.
for (const theme of ['light', 'dark'] as const) {
  test(`"원본 유실" 경고 배지 글자 대비가 AA(4.5:1) 이상이다 — ${theme} (WP-303)`, { tag: '@layout' }, async ({
    authenticatedPage: page,
  }) => {
    await withTheme(page, theme)
    const file = createFile({ id: 22, name: 'lost.txt', category: 'TEXT', available: false })
    await stubSpaces(page)
    await stubItems(page, [file])

    await page.goto(`/drive/spaces/${SPACE_ID}`)
    const badge = page.getByTestId('missing-blob-badge')
    await expect(badge).toBeVisible()
    await expectTheme(page, theme)
    // 배지는 color 트랜지션이 있어 테마 적용 직후 값이 중간색일 수 있다 — 조건 대기로 잰다.
    await expect.poll(() => textContrast(badge)).toBeGreaterThanOrEqual(4.5)
  })
}
