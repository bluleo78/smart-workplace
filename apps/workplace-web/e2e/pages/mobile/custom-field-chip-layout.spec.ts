// 모바일 「＋ 속성」 시트의 복수 선택 커스텀 필드 칩 폭(WP-1122) — 띄어쓰기 없는 긴 옵션도 칩이 시트 안에 머문다.
// 데스크톱 레일은 pages/projects/custom-field-chip-layout.spec.ts.
import { IssueRelationServer } from '../../fixtures/issueRelationServer'
import { expect, expectNoHorizontalOverflow, stubChat, test } from '../../fixtures/mobile.fixture'
import { boxOf } from '../../fixtures/layout'
import { LONG_OPTION, stubMultiSelectField } from '../../fixtures/customFieldMock'

const KEY = 'WP'

test('긴 영문 옵션 칩 — 속성 시트 「커스텀 필드」에서 화면 밖으로 넘치지 않는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  const server = new IssueRelationServer()
  server.addIssue('WP-7', '칩 폭')
  await stubChat(page)
  await server.install(page)
  const fieldId = await stubMultiSelectField(page, KEY)

  await page.goto(`/projects/${KEY}/issues/7`)
  await page.getByTestId('mobile-prop-more').click()
  const sheet = page.getByTestId('issue-more-props-sheet')
  await sheet.getByTestId('property-group-custom-fields').getByRole('button', { name: /커스텀 필드/ }).click()
  const group = sheet.getByTestId(`field-input-${fieldId}`)
  const chip = group.getByRole('button', { name: LONG_OPTION })
  const [groupBox, chipBox] = await Promise.all([boxOf(group), boxOf(chip)])
  // 고치기 전엔 칩 오른쪽 끝이 그룹(357px)·화면(390px)을 넘어 531px 이었다.
  expect(chipBox.x + chipBox.width).toBeLessThanOrEqual(groupBox.x + groupBox.width + 1)
  await expectNoHorizontalOverflow(page)
})
