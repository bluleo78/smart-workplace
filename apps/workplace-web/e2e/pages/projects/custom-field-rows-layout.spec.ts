// 프로젝트 설정 「프로젝트 필드」 목록의 줄 배치(WP-1124) — 옵션이 많거나 길어도 이름·타입이 한 줄로 읽히고 줄이 넘치지 않는다.
// 브라우저가 있어야 판정되는 기하만 본다(@layout). 모바일은 mobile/custom-field-rows-layout.spec.ts.
import { expect, test } from '../../fixtures/auth.fixture'
import { LONG_FIELD_ID, LONG_FIELD_NAME, MANY_OPTIONS_ID, mockCustomFieldRows } from '../../fixtures/customFieldRowsMock'
import { boxOf } from '../../fixtures/layout'
import { mockProjectSettings } from '../../fixtures/project-settings-mocks'

test('옵션이 많거나 긴 필드도 이름·타입이 한 줄이고 옵션·버튼이 줄 안에 있다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockProjectSettings(page)
  await mockCustomFieldRows(page)
  await page.goto('/projects/WP/settings')
  for (const [id, fieldName] of [[MANY_OPTIONS_ID, '담당 팀'], [LONG_FIELD_ID, LONG_FIELD_NAME]] as const) {
    const row = page.getByTestId(`custom-field-row-${id}`)
    await row.scrollIntoViewIfNeeded()
    const rowBox = await boxOf(row)
    // 이름·타입은 한 줄 높이(text-sm·xs 줄 높이 ≤ 24px) — 고치기 전엔 「담당 팀」 두 줄, 「선택」 세로 두 줄이었다.
    const name = await boxOf(row.getByText(fieldName, { exact: true }))
    const type = await boxOf(row.getByText(/^(선택|복수 선택)$/))
    expect(name.height).toBeLessThanOrEqual(24)
    expect(type.height).toBeLessThanOrEqual(20)
    const options = await boxOf(row.getByTestId(`custom-field-options-${id}`))
    const edit = await boxOf(row.getByTestId(`custom-field-edit-${id}`))
    expect(options.x + options.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 1)
    expect(edit.x + edit.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 1)
  }
})
