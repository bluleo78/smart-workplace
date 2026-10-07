// 노트 에디터 표 조작 UI E2E — 툴바/우클릭/단축키 세 경로와 마크다운 라운드트립.
// 요소 존재만 보는 단언으로는 "눌리는데 저장이 안 되는" 결함을 못 잡으므로,
// 저장 payload 의 GFM 표를 직접 단언한다.
import type { Page } from '@playwright/test'

import type { WikiRole } from '../../../src/types/wiki'
import { expect, test } from '../../fixtures/auth.fixture'
import { mockWikiPageEditor, savedMarkdown } from '../../fixtures/wiki-mock'

const SPACE_ID = 1
const PAGE_ID = 300
const TABLE_MD = [
  '| 항목 | 담당 |',
  '| --- | --- |',
  '| API 설계 | 김 |',
  '| 배포 | 이 |',
].join('\n')

const setup = (page: Page, body: string, role: WikiRole = 'OWNER') =>
  mockWikiPageEditor(page, { spaceId: SPACE_ID, pageId: PAGE_ID, title: '표', body, role })

/** 마크다운에서 파이프로 시작하는 줄(표)만 뽑는다. */
const tableLines = (md: string) => md.split('\n').filter((l) => l.trim().startsWith('|'))

/**
 * 동기화 저장본(WP-172)의 표 줄 — 마지막 입력(until)이 저장본에 닿을 때까지 기다린 뒤 읽는다.
 * 편집은 순서대로 동기화되므로 마지막 입력이 보이면 그 앞의 표 조작(열 추가·행 삭제)도 반영돼 있다.
 */
async function savedTableLines(page: Page, until: string): Promise<string[]> {
  await expect.poll(() => savedMarkdown(page, PAGE_ID)).toContain(until)
  return tableLines(await savedMarkdown(page, PAGE_ID))
}

test('툴바 — 커서가 표 안에 있을 때만 뜨고, 열 추가가 마크다운까지 반영된다', async ({
  authenticatedPage: page,
}) => {
  await setup(page, TABLE_MD)
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror table')).toBeVisible()

  // 표 밖(제목 입력 전 본문 끝)에서는 툴바가 없다.
  await expect(page.getByTestId('wiki-table-toolbar')).toHaveCount(0)

  // 본문 셀에 커서를 두면 툴바가 뜬다.
  await page.locator('.ProseMirror td').first().click()
  const toolbar = page.getByTestId('wiki-table-toolbar')
  await expect(toolbar).toBeVisible()

  // 툴바는 셀이 아니라 표 상단에 앵커된다 — 툴바 하단이 표 상단보다 위여야 한다.
  const tableBox = (await page.locator('.ProseMirror table').boundingBox())!
  const barBox = (await toolbar.boundingBox())!
  expect(barBox.y + barBox.height).toBeLessThanOrEqual(tableBox.y + 1)

  // 오른쪽에 열 삽입 → 3열
  await toolbar.getByTestId('wiki-table-cmd-addColumnAfter').click()
  await expect(page.locator('.ProseMirror table th')).toHaveCount(3)

  // 저장본이 3열 GFM 표인가 — 구분 행의 --- 개수로 판정한다.
  await page.locator('.ProseMirror td').first().click()
  await page.keyboard.type('!')
  const lines = await savedTableLines(page, '!')
  const delimiter = lines.find((l) => l.includes('---'))!
  expect(delimiter.split('---')).toHaveLength(4) // 3열 → --- 3개 → split 결과 4조각
  expect(lines).toHaveLength(4) // 헤더 + 구분 + 본문 2
})

test('툴바 — 헤더 행에서는 행 삭제가 비활성, 본문 행에서는 활성', async ({
  authenticatedPage: page,
}) => {
  await setup(page, TABLE_MD)
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror table')).toBeVisible()

  await page.locator('.ProseMirror th').first().click()
  await expect(page.getByTestId('wiki-table-cmd-deleteRow')).toBeDisabled()

  await page.locator('.ProseMirror td').first().click()
  await expect(page.getByTestId('wiki-table-cmd-deleteRow')).toBeEnabled()
})

test('툴바 — 행 삭제가 마크다운에서도 사라진다', async ({ authenticatedPage: page }) => {
  await setup(page, TABLE_MD)
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror table')).toBeVisible()

  await page.locator('.ProseMirror td').filter({ hasText: 'API 설계' }).click()
  await page.getByTestId('wiki-table-cmd-deleteRow').click()
  await expect(page.locator('.ProseMirror table tr')).toHaveCount(2) // 헤더 + 본문 1

  await page.locator('.ProseMirror td').first().click()
  await page.keyboard.type('!')
  const lines = await savedTableLines(page, '!')
  expect(lines).toHaveLength(3)
  expect(lines.join('\n')).not.toContain('API 설계')
})

test('넓은 표는 본문을 밀지 않고 래퍼 안에서 가로 스크롤된다 (#754)', async ({
  authenticatedPage: page,
}) => {
  const cols = Array.from({ length: 8 }, (_, i) => `항목 ${i + 1} 상세 설명`)
  const wide = [
    `| ${cols.join(' | ')} |`,
    `| ${cols.map(() => '---').join(' | ')} |`,
    `| ${cols.map((_, i) => `${i + 1}행 내용이 제법 긴 한글 문장입니다`).join(' | ')} |`,
  ].join('\n')
  await setup(page, wide)
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror table')).toBeVisible()

  // 래퍼가 실제로 렌더되고 스크롤 컨테이너가 된다.
  const wrapper = page.locator('.ProseMirror .tableWrapper')
  await expect(wrapper).toHaveCount(1)
  const metrics = await wrapper.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }))
  expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth)
  // 표가 페이지 자체를 가로로 밀어내면 안 된다.
  expect(metrics.docOverflow).toBeLessThanOrEqual(1)

  // 오른쪽 끝까지 스크롤해도 툴바는 화면 안에 있다(표가 아니라 래퍼에 앵커되므로).
  await wrapper.evaluate((el) => el.scrollTo({ left: el.scrollWidth }))
  await page.locator('.ProseMirror td').last().click()
  const bar = page.getByTestId('wiki-table-toolbar')
  await expect(bar).toBeVisible()
  const box = (await bar.boundingBox())!
  const vw = page.viewportSize()!.width
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(vw)
})

test('셀에 파이프를 입력해도 셀이 쪼개지지 않는다 (#755)', async ({ authenticatedPage: page }) => {
  await setup(page, TABLE_MD)
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror table')).toBeVisible()

  await page.locator('.ProseMirror td').filter({ hasText: '배포' }).click()
  await page.keyboard.press('End')
  await page.keyboard.type('|긴급')

  const lines = await savedTableLines(page, '긴급')
  // 이스케이프되지 않으면 이 행만 3칸이 되어 열 수가 어긋난다.
  expect(lines[3]).toBe('| 배포\\|긴급 | 이 |')
  expect(lines.join('\n')).not.toContain('<table')
})

test('단축키 — Ctrl+Alt+아래로 행이 추가되고, 표 밖에서는 아무 일도 없다', async ({
  authenticatedPage: page,
}) => {
  await setup(page, `${TABLE_MD}\n\n표 아래 문단.`)
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror table')).toBeVisible()

  await page.locator('.ProseMirror td').first().click()
  await page.keyboard.press('Control+Alt+ArrowDown')
  await expect(page.locator('.ProseMirror table tr')).toHaveCount(4)

  await page.keyboard.press('Control+Alt+ArrowRight')
  await expect(page.locator('.ProseMirror table th')).toHaveCount(3)

  // 표 밖에서는 가로채지 않는다 — 행 수가 그대로여야 한다.
  await page.locator('.ProseMirror p').filter({ hasText: '표 아래 문단' }).click()
  await expect(page.getByTestId('wiki-table-toolbar')).toHaveCount(0)
  await page.keyboard.press('Control+Alt+ArrowDown')
  await expect(page.locator('.ProseMirror table tr')).toHaveCount(4)
})

test('우클릭 메뉴 — 셀에서 열리고 표 밖에서는 열리지 않는다', async ({
  authenticatedPage: page,
}) => {
  await setup(page, `${TABLE_MD}\n\n표 아래 문단.`)
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror table')).toBeVisible()

  await page.locator('.ProseMirror td').filter({ hasText: '배포' }).click({ button: 'right' })
  const menu = page.getByTestId('wiki-table-context-menu')
  await expect(menu).toBeVisible()

  // 우클릭한 셀 기준으로 동작한다 — 그 행이 지워져야 한다.
  await menu.getByTestId('wiki-table-ctx-deleteRow').click()
  await expect(page.locator('.ProseMirror table tr')).toHaveCount(2)
  await expect(page.locator('.ProseMirror table')).not.toContainText('배포')

  // 표 밖 우클릭은 우리 메뉴를 열지 않는다(브라우저 기본 메뉴 유지).
  await page.locator('.ProseMirror p').filter({ hasText: '표 아래 문단' }).click({ button: 'right' })
  await expect(page.getByTestId('wiki-table-context-menu')).toHaveCount(0)
})

test('삽입 → 열 추가 → 저장 → 새로고침해 저장본을 다시 받아도 표가 보존된다', async ({
  authenticatedPage: page,
}) => {
  await setup(page, '')
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()

  // 1) 그리드 피커로 4열 × 2행 삽입
  await page.locator('.ProseMirror').click()
  await page.keyboard.type('/')
  await page.getByTestId('wiki-slash-option-table').click()
  await page.getByTestId('wiki-table-size-cell-2-4').click()
  await expect(page.locator('.ProseMirror table th')).toHaveCount(4)

  // 2) 셀에 값을 넣고 툴바로 열 추가 → 5열
  await page.locator('.ProseMirror th').first().click()
  await page.keyboard.type('항목')
  await page.getByTestId('wiki-table-cmd-addColumnAfter').click()
  await expect(page.locator('.ProseMirror table th')).toHaveCount(5)

  // 3) 저장본이 5열 GFM 표인가 — 마지막 입력 'A' 가 저장본에 닿으면 앞선 삽입·열 추가도 반영돼 있다.
  await page.locator('.ProseMirror td').first().click()
  await page.keyboard.type('A')
  const lines = await savedTableLines(page, '| A')
  const delimiter = lines.find((l) => l.includes('---'))!
  expect(delimiter.split('---')).toHaveLength(6) // 5열
  expect(lines).toHaveLength(3) // 헤더 + 구분 + 본문 1
  expect(lines[0]).toContain('항목')
  // HTML 폴백으로 새지 않았는지 — <table 이 있으면 GFM 직렬화가 깨진 것이다.
  expect(await savedMarkdown(page, PAGE_ID)).not.toContain('<table')

  // 4) 새로고침 — 에디터가 동기화 서버의 저장본을 다시 받아 오므로 셀 단위로 그대로 보여야 한다.
  await page.reload()
  const t = page.locator('.ProseMirror table')
  await expect(t.locator('th')).toHaveCount(5)
  await expect(t.locator('th').first()).toHaveText('항목')
  await expect(t.locator('td')).toHaveCount(5)
  await expect(t.locator('td').first()).toHaveText('A')
})

test('뷰어 권한 — 툴바·우클릭 메뉴·단축키 모두 비활성 (스펙 §5)', async ({
  authenticatedPage: page,
}) => {
  await setup(page, TABLE_MD, 'VIEWER')
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror table')).toBeVisible()

  // 셀 클릭해도 표 툴바가 뜨지 않는다.
  await page.locator('.ProseMirror td').first().click()
  await expect(page.getByTestId('wiki-table-toolbar')).toHaveCount(0)

  // 셀 우클릭해도 우리 컨텍스트 메뉴가 뜨지 않는다(브라우저 기본 메뉴 유지).
  await page.locator('.ProseMirror td').first().click({ button: 'right' })
  await expect(page.getByTestId('wiki-table-context-menu')).toHaveCount(0)

  // 단축키도 막힌다 — 행 수가 그대로여야 한다(수정 2 의 회귀 테스트).
  await page.locator('.ProseMirror td').first().click()
  await page.keyboard.press('Control+Alt+ArrowDown')
  await expect(page.locator('.ProseMirror table tr')).toHaveCount(3) // 헤더 + 본문 2, 불변
})

test('셀 안에서는 슬래시 메뉴에 표 항목이 없다 (중첩 표 직렬화 붕괴 회귀)', async ({
  authenticatedPage: page,
}) => {
  // 재현: 셀 안 → '/' → 그리드로 표 삽입 → 타이핑 → 저장 payload 에 <table 이 섞여 바깥 표까지
  // raw HTML 로 새는 걸 확인했다(스키마상 tableCell.content='block+' 라 중첩 표 자체는 유효하지만
  // tiptap-markdown 이 중첩 table 을 GFM 으로 못 씀). 가장 단순한 차단책으로 셀 안에서는 '표'
  // 슬래시 항목 자체를 숨긴다(wikiSlashSuggestion.ts items()). 이 테스트는 그 차단이 유지되는지
  // 지키는 회귀 테스트다.
  await setup(page, `${TABLE_MD}\n\n표 아래 문단.`)
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror table')).toBeVisible()

  // 셀 안에 커서 → '/' — 메뉴는 뜨지만 표 항목이 없다.
  await page.locator('.ProseMirror td').first().click()
  await page.keyboard.type('/')
  await expect(page.getByTestId('wiki-slash-popover')).toBeVisible()
  await expect(page.getByTestId('wiki-slash-option-table')).toHaveCount(0)
  // Escape 는 팝업을 숨길 뿐 suggestion 상태를 완전히 종료하지 않는다(그리드 모드 복귀 지원 때문).
  // '/' 를 지워 확실히 트리거를 종료한다.
  await page.keyboard.press('Backspace')

  // 셀 밖(표 아래 문단)에서는 여전히 표 항목이 있다 — 차단이 표 안에서만 적용됨을 확인.
  await page.locator('.ProseMirror p').filter({ hasText: '표 아래 문단' }).click()
  await page.keyboard.press('End')
  await page.keyboard.type('/')
  await expect(page.getByTestId('wiki-slash-option-table')).toBeVisible()
})
