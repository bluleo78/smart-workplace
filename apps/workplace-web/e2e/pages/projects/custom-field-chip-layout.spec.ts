// 이슈 상세 복수 선택 커스텀 필드 칩의 폭(WP-1122) — 띄어쓰기 없는 긴 옵션도 칩이 「커스텀 필드」 카드 안에 머문다.
// 브라우저가 있어야 판정되는 기하만 본다(@layout). 데스크톱 레일은 여기, 모바일 「속성」 시트는 mobile/custom-field-chip-layout.spec.ts.
import { IssueRelationServer } from '../../fixtures/issueRelationServer'
import { expect, test } from '../../fixtures/auth.fixture'
import { boxOf } from '../../fixtures/layout'
import { LONG_OPTION, stubMultiSelectField } from '../../fixtures/customFieldMock'

const KEY = 'WP'

test('긴 영문 옵션 칩 — 레일 「커스텀 필드」 카드 밖으로 넘치지 않고 전체 이름이 보인다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const server = new IssueRelationServer()
  server.addIssue('WP-7', '칩 폭')
  await server.install(page)
  const fieldId = await stubMultiSelectField(page, KEY)

  await page.goto(`/projects/${KEY}/issues/7`)
  const card = page.getByTestId('property-group-custom-fields')
  await card.getByRole('button', { name: /커스텀 필드/ }).click()
  const group = card.getByTestId(`field-input-${fieldId}`)
  const chip = group.getByRole('button', { name: LONG_OPTION })
  const [groupBox, chipBox] = await Promise.all([boxOf(group), boxOf(chip)])
  // 칩 오른쪽 끝이 그룹(카드 안 칸) 오른쪽 끝을 넘지 않는다 — 고치기 전엔 252px 넘쳤다.
  expect(chipBox.x + chipBox.width).toBeLessThanOrEqual(groupBox.x + groupBox.width + 1)
  // 잘라 숨기지 않고 줄바꿈한다 — 칩 안 글자가 칩보다 넓지 않다.
  expect(await chip.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0)
})
