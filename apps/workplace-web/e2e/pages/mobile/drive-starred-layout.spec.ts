// 휴대폰 폭(390px)의 「별표」 목록(WP-1698) — 긴 이름·경로도 행이 가로로 넘치지 않고 세 줄(이름 / 경로·크기 / 공간·날짜)로 접히며,
// 별표·⋯ 단추가 서로·이름 칸을 덮지 않고 각자 44px 로 눌리는지는 jsdom 이 폭·겹침을 잴 수 없어 브라우저에서 본다(@layout).
// 목록 동작(빼기·되돌리기·이동·보기 창)은 src/pages/drive/driveStarred.test.tsx 가 지킨다.
import { personalSpace } from '../../factories/drive.factory'
import { json } from '../../fixtures/mobile-chat'
import { expect, expectNoHorizontalOverflow, expectTouchTarget, test } from '../../fixtures/mobile.fixture'
import { boxOf } from '../../fixtures/layout'
import type { DriveStarredItem } from '../../../src/types/drive'

const LONG_NAME = '2026년 하반기 전사 사업계획 및 예산 편성안 최종 검토본(경영지원팀 취합).pdf'

const item: DriveStarredItem = {
  kind: 'FILE',
  id: 70,
  name: LONG_NAME,
  mimeType: 'application/pdf',
  sizeBytes: 4_404_019,
  fileId: 970,
  category: 'DOCUMENT',
  versionCount: 1,
  available: true,
  folderCount: null,
  fileCount: null,
  parentFolderId: 12,
  path: '경영지원/2026 사업계획/하반기/전사 취합본/최종 검토',
  spaceId: 3,
  spaceName: '경영지원 공유 드라이브(전사 사업계획)',
  updatedAt: '2026-11-12T03:00:00Z',
  starredAt: '2026-11-13T03:00:00Z',
}

test('휴대폰 폭에서 별표 행은 넘치지 않고 세 줄로 접히며 별표·⋯ 는 각자 44px 로 눌린다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.route((u) => u.pathname === '/api/v1/drive/spaces', (r) => r.fulfill(json([personalSpace()])))
  await page.route((u) => u.pathname === '/api/v1/drive/starred', (r) => r.fulfill(json({ items: [item], nextCursor: null })))
  await page.goto('/drive/starred')

  const row = page.getByTestId('drive-starred-row-file-70')
  const name = row.getByRole('button', { name: LONG_NAME, exact: true })
  const meta = row.getByTestId('drive-starred-meta-file-70')
  const third = row.getByText(/경영지원 공유 드라이브\(전사 사업계획\) · /)
  await expect(name).toBeVisible()
  await expectNoHorizontalOverflow(page)

  // 세 줄 — 이름 아래 경로·크기, 그 아래 공간·날짜(넓은 폭의 공간·날짜 칸은 숨는다).
  const [n, m, t] = [await boxOf(name), await boxOf(meta), await boxOf(third)]
  expect(m.y).toBeGreaterThanOrEqual(n.y + n.height - 1)
  expect(t.y).toBeGreaterThanOrEqual(m.y + m.height - 1)
  await expect(row.getByTestId('drive-starred-space-file-70')).toBeHidden()

  // 행이 화면 안 — 오른쪽 끝(⋯)이 뷰포트 안에 있다.
  const menu = row.getByTestId('drive-starred-menu-file-70')
  const star = row.getByTestId('drive-starred-star-file-70')
  const mb = await boxOf(menu)
  expect(mb.x + mb.width).toBeLessThanOrEqual(390)
  // 이름 칸이 단추 쪽으로 넘치지 않는다(말줄임).
  expect(n.x + n.width).toBeLessThanOrEqual((await boxOf(star)).x)

  await expectTouchTarget(star, 44)
  await expectTouchTarget(menu, 44)
})
