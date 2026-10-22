// 노트 표 열 정렬 E2E(WP-584) — 툴바·우클릭 메뉴로 고른 정렬이 열 전체에 적용되고, GFM 정렬 마커로 저장돼
// 다시 열어도 유지되는지. 요소 존재가 아니라 저장된 마크다운의 구분 행과 셀의 실제 text-align 을 단언한다.
import type { Page } from '@playwright/test'

import { expect, test } from '../../fixtures/auth.fixture'
import { mockWikiPageEditor, openWikiEditor, savedMarkdown } from '../../fixtures/wiki-mock'

const SPACE_ID = 1
const PAGE_ID = 584
const TABLE_MD = ['| 서비스 | 상태 | 응답 |', '| --- | --- | --- |', '| API | 정상 | 128 |', '| 메일 | 점검 | 86 |'].join('\n')

const open = async (page: Page, body: string) => {
  await mockWikiPageEditor(page, { spaceId: SPACE_ID, pageId: PAGE_ID, title: '표 정렬', body })
  await openWikiEditor(page, { spaceId: SPACE_ID, pageId: PAGE_ID })
  await expect(page.locator('.ProseMirror table')).toBeVisible()
}

/** 표의 n번째 열(0부터) 셀 전부의 계산된 text-align. */
const columnAligns = (page: Page, col: number) =>
  page.locator('.ProseMirror tr').evaluateAll(
    (rows, c) => rows.map((r) => getComputedStyle(r.children[c] as HTMLElement).textAlign),
    col,
  )

/** 저장본의 표 구분 행. */
async function savedDelimiter(page: Page, expected: string): Promise<void> {
  await expect
    .poll(async () => (await savedMarkdown(page, PAGE_ID)).split('\n').find((l) => l.includes('---')))
    .toBe(expected)
}

test('툴바 — 가운데 정렬이 그 열 전체에 적용되고 :---: 로 저장된다', { tag: '@smoke' }, async ({
  authenticatedPage: page,
}) => {
  await open(page, TABLE_MD)
  // 상태 열 본문 셀에 커서 → 정렬 없음이라 「왼쪽」이 눌려 있다.
  await page.locator('.ProseMirror td').filter({ hasText: '정상' }).click()
  const toolbar = page.getByTestId('wiki-table-toolbar')
  await expect(toolbar.getByTestId('wiki-table-align-left')).toHaveAttribute('aria-pressed', 'true')

  await toolbar.getByTestId('wiki-table-align-center').click()
  await expect(toolbar.getByTestId('wiki-table-align-center')).toHaveAttribute('aria-pressed', 'true')
  // 헤더·본문 셀 모두 — 셀 하나가 아니라 열 단위.
  expect(await columnAligns(page, 1)).toEqual(['center', 'center', 'center'])
  // 다른 열은 그대로.
  expect(await columnAligns(page, 2)).toEqual(['left', 'left', 'left'])
  await savedDelimiter(page, '| --- | :---: | --- |')

  // 「왼쪽」으로 되돌리면 정렬 없음(---)으로 저장된다.
  await toolbar.getByTestId('wiki-table-align-left').click()
  await savedDelimiter(page, '| --- | --- | --- |')
})

test('저장된 정렬은 다시 열어도 셀과 툴바 표시에 그대로 남는다', async ({ authenticatedPage: page }) => {
  await open(page, TABLE_MD.replace('| --- | --- | --- |', '| --- | :---: | ---: |'))
  expect(await columnAligns(page, 1)).toEqual(['center', 'center', 'center'])
  expect(await columnAligns(page, 2)).toEqual(['right', 'right', 'right'])

  await page.locator('.ProseMirror td').filter({ hasText: '128' }).click()
  const toolbar = page.getByTestId('wiki-table-toolbar')
  await expect(toolbar.getByTestId('wiki-table-align-right')).toHaveAttribute('aria-pressed', 'true')
  await expect(toolbar.getByTestId('wiki-table-align-left')).toHaveAttribute('aria-pressed', 'false')
})

test('우클릭 — 여러 열에 걸쳐 고른 셀에 한 번에 오른쪽 정렬', async ({ authenticatedPage: page }) => {
  await open(page, TABLE_MD)
  // 서비스 열 → 상태 열로 드래그해 두 열에 걸친 셀 선택을 만든다.
  const from = (await page.locator('.ProseMirror td').filter({ hasText: 'API' }).boundingBox())!
  const to = (await page.locator('.ProseMirror td').filter({ hasText: '점검' }).boundingBox())!
  await page.mouse.move(from.x + 5, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 5 })
  await page.mouse.up()
  await expect(page.locator('.ProseMirror .selectedCell')).toHaveCount(4)

  await page.locator('.ProseMirror td').filter({ hasText: '점검' }).click({ button: 'right' })
  const menu = page.getByTestId('wiki-table-context-menu')
  await menu.getByTestId('wiki-table-ctx-align-right').click()

  expect(await columnAligns(page, 0)).toEqual(['right', 'right', 'right'])
  expect(await columnAligns(page, 1)).toEqual(['right', 'right', 'right'])
  expect(await columnAligns(page, 2)).toEqual(['left', 'left', 'left'])
  await savedDelimiter(page, '| ---: | ---: | --- |')
})
