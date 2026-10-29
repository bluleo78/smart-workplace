// 모바일 이슈 「관계」(WP-887) — 「＋ 속성」 시트 안에 데스크톱 레일과 같은 「관계」 그룹이 있고, 거기서 관계를 걸고(창은 같은 컴포넌트)
// 줄은 ⋯ 메뉴로 지운다. 데스크톱 상세 흐름은 pages/projects/issue-relations.spec.ts 가 본다.
import { makeTaskType } from '../../factories/issueType.factory'
import { IssueRelationServer, seedLongKeyLinks } from '../../fixtures/issueRelationServer'
import { expect, expectNoHorizontalOverflow, stubChat, test } from '../../fixtures/mobile.fixture'
import { trackRequests } from '../../fixtures/requests'
import { boxOf } from '../../fixtures/layout'

const KEY = 'WP'
const REL = `/api/v1/projects/${KEY}/issues/7/relations`

test('＋ 속성 시트의 「관계」 그룹 — 같은 그룹이 보이고, 추가하면 반영되고, ⋯ 메뉴로 지운다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  const server = new IssueRelationServer()
  server.addIssue('WP-7', '모바일 이슈')
  server.addIssue('WP-8', '후속 이슈')
  server.addIssue('WP-9', '원인 이슈')
  // 미리 걸려 있는 관계 — 「관련」 WP-9.
  server.relations.push({ id: 7, typeId: 2, source: { projectKey: KEY, number: 7 }, target: { projectKey: KEY, number: 9 } })
  server.lookupItems = [{ projectKey: KEY, number: 8, title: '후속 이슈', status: 'TODO', type: makeTaskType() }]
  await stubChat(page)
  await server.install(page)
  const posts = trackRequests(page, 'POST', REL)
  const deletes = trackRequests(page, 'DELETE', `${REL}/7`)

  await page.goto(`/projects/${KEY}/issues/7`)
  await expect(page.getByTestId('issue-title-heading')).toBeVisible()
  await expect(page.getByTestId('property-rail')).toHaveCount(0)
  await page.getByTestId('mobile-prop-more').click()
  const sheet = page.getByTestId('issue-more-props-sheet')
  await sheet.getByTestId('property-group-relations').getByRole('button', { name: /^관계(\s*\d+)?$/ }).click()
  await expect(sheet.getByTestId('issue-relation-row-7')).toContainText('#9')
  await expectNoHorizontalOverflow(page)

  // 추가 — 시트 안 「＋ 관계 추가」로 같은 창이 열린다.
  await sheet.getByTestId('issue-relation-add').click()
  const dialog = page.getByTestId('issue-relation-dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByTestId('issue-relation-search').fill('8')
  await dialog.getByTestId('issue-relation-result-WP-8').click()
  await dialog.getByTestId('issue-relation-submit').click()
  await expect.poll(() => posts.lastBody()).toEqual({ typeId: 2, side: 'source', target: { projectKey: KEY, number: 8 } })
  await expect(sheet.getByTestId('issue-relation-group-2-source')).toContainText('후속 이슈')

  // 제거 — 터치에선 ⋯ → 액션 시트.
  await sheet.getByTestId('issue-relation-more-7').tap()
  await page.getByTestId('issue-relation-sheet').getByTestId('mobile-action-remove').tap()
  await deletes.waitFor()
  await expect(sheet.getByTestId('issue-relation-row-7')).toHaveCount(0)
  await expect(sheet.getByTestId('issue-relation-group-2-source')).toContainText('후속 이슈')
})

test('긴 키의 외부 링크 줄 — 시트 「관계」에서도 제목이 보이고 ↗ 가 화면 안에 있다(WP-1108)', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  const server = new IssueRelationServer()
  seedLongKeyLinks(server)
  await stubChat(page)
  await server.install(page)

  await page.goto(`/projects/${KEY}/issues/7`)
  await page.getByTestId('mobile-prop-more').click()
  const sheet = page.getByTestId('issue-more-props-sheet')
  await sheet.getByTestId('property-group-relations').getByRole('button', { name: /^관계(\s*\d+)?$/ }).click()
  for (const id of [1, 2]) {
    const row = sheet.getByTestId(`issue-external-link-row-${id}`)
    await expect(row).toBeVisible()
    const rowBox = await boxOf(row)
    expect((await boxOf(row.getByTestId(`issue-external-link-title-${id}`))).width).toBeGreaterThanOrEqual(80)
    const arrow = await boxOf(row.getByLabel('새 탭에서 열기'))
    expect(arrow.x + arrow.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 1)
  }
  await expectNoHorizontalOverflow(page)
})
