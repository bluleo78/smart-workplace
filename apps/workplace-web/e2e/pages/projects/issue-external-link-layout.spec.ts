// 이슈 「관계」 외부 링크 줄의 폭(WP-1108) — 키가 길어도 제목이 읽히고 줄이 카드 안에 머문다.
// 브라우저가 있어야 판정되는 기하만 본다(@layout). 데스크톱 레일은 여기, 모바일 「속성」 시트는 mobile/issue-relations.spec.ts.
import { IssueRelationServer, seedLongKeyLinks } from '../../fixtures/issueRelationServer'
import { expect, test } from '../../fixtures/auth.fixture'
import { boxOf } from '../../fixtures/layout'

const KEY = 'WP'

test('긴 키의 외부 링크 줄 — 제목이 보이고 키·제목·↗ 가 레일 카드 안에 있다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const server = new IssueRelationServer()
  seedLongKeyLinks(server)
  await server.install(page)

  await page.goto(`/projects/${KEY}/issues/7`)
  const group = page.getByTestId('property-group-relations')
  await group.getByRole('button', { name: /^관계(\s*\d+)?$/ }).click()
  for (const id of [1, 2]) {
    const row = group.getByTestId(`issue-external-link-row-${id}`)
    await expect(row).toBeVisible()
    const rowBox = await boxOf(row)
    const title = await boxOf(row.getByTestId(`issue-external-link-title-${id}`))
    const arrow = await boxOf(row.getByLabel('새 탭에서 열기'))
    // 제목은 몇 글자는 읽힐 만큼(80px 이상) 남고, ↗ 까지 줄 안에 머문다.
    expect(title.width).toBeGreaterThanOrEqual(80)
    expect(arrow.x + arrow.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 1)
  }
})
