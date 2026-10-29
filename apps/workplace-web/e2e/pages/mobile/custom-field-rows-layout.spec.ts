// 모바일 프로젝트 설정 「프로젝트 필드」 목록의 줄 배치(WP-1124) — 이름·타입·버튼이 첫 줄, 옵션 칩은 그 아래 줄에서 화면 안에 줄바꿈된다.
// 데스크톱은 pages/projects/custom-field-rows-layout.spec.ts.
import { LONG_FIELD_ID, LONG_FIELD_NAME, MANY_OPTIONS_ID, mockCustomFieldRows } from '../../fixtures/customFieldRowsMock'
import { boxOf } from '../../fixtures/layout'
import { expect, expectNoHorizontalOverflow, test } from '../../fixtures/mobile.fixture'
import { mockProjectSettings } from '../../fixtures/project-settings-mocks'

test('옵션이 많거나 긴 필드도 이름이 한 줄이고 옵션은 아래 줄, 편집 버튼이 화면 안에 있다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await mockProjectSettings(page)
  await mockCustomFieldRows(page)
  await page.goto('/projects/WP/settings')
  const width = page.viewportSize()!.width
  for (const [id, fieldName] of [[MANY_OPTIONS_ID, '담당 팀'], [LONG_FIELD_ID, LONG_FIELD_NAME]] as const) {
    const row = page.getByTestId(`custom-field-row-${id}`)
    await row.scrollIntoViewIfNeeded()
    // 고치기 전엔 「담당 팀」 높이 72px(한 글자씩), 40자 이름 960px 이었다.
    const name = await boxOf(row.getByText(fieldName, { exact: true }))
    expect(name.height).toBeLessThanOrEqual(24)
    const options = await boxOf(row.getByTestId(`custom-field-options-${id}`))
    expect(options.y).toBeGreaterThanOrEqual(name.y + name.height - 1)
    expect(options.x + options.width).toBeLessThanOrEqual(width)
    const edit = await boxOf(row.getByTestId(`custom-field-edit-${id}`))
    expect(edit.x + edit.width).toBeLessThanOrEqual(width)
  }
  await expectNoHorizontalOverflow(page)
})
