// 모바일 노트·드라이브 목록 정리(WP-143) — 노트 공간 0개 빈 상태(+공간 만들기), 드라이브 공간 행 아이콘 통일, 사용량 맨 아래 고정.
import { createSpace, personalSpace } from '../../factories/drive.factory'
import { expect, expectNoHorizontalOverflow, test } from '../../fixtures/mobile.fixture'
import { mockWikiNoSpaces } from '../../fixtures/wiki-mock'

const NEW_SPACE_ID = 5

test('노트: 공간이 없으면 빈 선택 상자 대신 빈 상태가 보이고, [공간 만들기]로 만든 공간으로 이동한다', async ({ authenticatedPage: page }) => {
  const state = await mockWikiNoSpaces(page, NEW_SPACE_ID)
  await page.goto('/wiki')

  const empty = page.getByTestId('wiki-no-spaces')
  await expect(empty).toBeVisible()
  await expect(empty).toContainText('노트 공간이 없습니다')
  // 빈 선택 상자·"페이지" 머리말·새 페이지 ＋ 는 그리지 않는다.
  await expect(page.getByRole('combobox')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '새 페이지' })).toHaveCount(0)
  await expectNoHorizontalOverflow(page)

  // 빈 상태 안내 문구는 목록 영역 세로 가운데 부근(위쪽에 붙지 않음) — 목록 높이를 채우는지 확인.
  const list = (await page.getByTestId('mobile-module-list').boundingBox())!
  const title = (await empty.getByText('노트 공간이 없습니다').boundingBox())!
  expect(title.y - list.y).toBeGreaterThan(list.height / 4)

  // 공간 만들기 → 이름 입력 → POST {name} → 새 공간으로 이동.
  await page.getByTestId('wiki-no-spaces-create').tap()
  await expect(page.getByTestId('wiki-space-create-dialog')).toBeVisible()
  await page.getByTestId('wiki-space-create-input').fill('제품팀 노트')
  await page.getByTestId('wiki-space-create-confirm').tap()
  await expect.poll(() => state.postBody).toEqual({ name: '제품팀 노트' })
  await expect(page).toHaveURL(new RegExp(`/wiki/spaces/${NEW_SPACE_ID}$`))
  await expect(page.getByTestId('wiki-no-spaces')).toHaveCount(0)
})

test('드라이브: 모든 공간 행에 아이콘이 있고, 사용량은 목록 맨 아래에 붙는다', async ({ authenticatedPage: page }) => {
  await page.route((u) => u.pathname === '/api/v1/drive/spaces', (r) => r.fulfill({
    json: [personalSpace({ id: 1 }), createSpace({ id: 2, name: '디자인팀 공유 자료' }), createSpace({ id: 3, name: '2026 하반기 영업 제안서 모음' })],
  }))
  await page.route((u) => u.pathname === '/api/v1/drive/quota', (r) => r.fulfill({ json: { usedBytes: 58_000_000, quotaBytes: 10_000_000_000 } }))
  await page.goto('/drive')

  // 공간 행 3개 모두 아이콘 1개씩 — 이름 순서·문구는 그대로.
  const rows = page.getByTestId('drive-space-list').getByRole('link')
  await expect(rows).toHaveCount(3)
  for (const [i, name] of ['내 드라이브', '디자인팀 공유 자료', '2026 하반기 영업 제안서 모음'].entries()) {
    await expect(rows.nth(i)).toHaveText(name)
    await expect(rows.nth(i).getByTestId('drive-space-icon')).toHaveCount(1)
  }

  // 사용량 바는 공간이 3개뿐이어도 목록 영역 맨 아래(하단 패딩 12px 이내)에 붙는다.
  const usage = page.getByTestId('drive-usage-bar')
  await expect(usage).toBeVisible()
  const list = (await page.getByTestId('mobile-module-list').boundingBox())!
  const bar = (await usage.boundingBox())!
  expect(list.y + list.height - (bar.y + bar.height)).toBeLessThanOrEqual(12)
  await expectNoHorizontalOverflow(page)
})
