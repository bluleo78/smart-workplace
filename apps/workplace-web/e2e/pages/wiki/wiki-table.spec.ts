// 노트 에디터 표 렌더·마크다운 라운드트립 E2E (#742) — Table 확장 미도입으로 마크다운 표가
// 문단으로 합쳐져 깨지던 회귀를 막는다. AI 생성물(/ai 요약·초안)이 표를 자주 만들어 체감 결함이 컸다.
import type { Page } from '@playwright/test'
import type { WikiPageDetail } from '../../../src/types/wiki'
import { expect, test } from '../../fixtures/auth.fixture'

const SPACE_ID = 1
const PAGE_ID = 300
const TABLE_MD = [
  '# 분기 지표',
  '',
  '| 항목 | 3분기 | 4분기 |',
  '| --- | --- | --- |',
  '| 활성 사용자 | 1,200 | 1,850 |',
  '| 응답 지연(p95) | 420ms | 310ms |',
  '',
  '표 아래 문단.',
].join('\n')

const saved: string[] = []

async function setup(page: Page, body: string) {
  await page.route((u) => u.pathname === '/api/v1/wiki/spaces', (r) =>
    r.request().method() === 'GET'
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: SPACE_ID, type: 'PERSONAL', name: '내 노트', ownerId: 1, role: 'OWNER', createdAt: '2026-06-01T00:00:00Z' }]) })
      : r.fallback())
  await page.route((u) => u.pathname === `/api/v1/wiki/spaces/${SPACE_ID}/pages`, (r) =>
    r.request().method() === 'GET'
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: PAGE_ID, parentId: null, title: '분기 지표', position: 0, aiLastUsedAt: null }]) })
      : r.fallback())
  await page.route((u) => u.pathname === `/api/v1/wiki/spaces/${SPACE_ID}/members`, (r) =>
    r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }) : r.fallback())
  await page.route((u) => u.pathname === `/api/v1/wiki/pages/${PAGE_ID}`, (r) => {
    const d: WikiPageDetail = { id: PAGE_ID, spaceId: SPACE_ID, parentId: null, title: '분기 지표', body, version: 1, updatedBy: 1, updatedAt: '2026-06-01T00:00:00Z', aiLastUsedAt: null, aiLastAction: null }
    const m = r.request().method()
    if (m === 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(d) })
    if (m === 'PUT') {
      saved.push((r.request().postDataJSON() as { body: string }).body)
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...d, version: 2 }) })
    }
    return r.fallback()
  })
}

test('표 렌더 + 마크다운 라운드트립', async ({ authenticatedPage: page }) => {
  saved.length = 0
  await setup(page, TABLE_MD)
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()

  // 1) 실제 table 로 렌더되는가
  const t = page.locator('.ProseMirror table')
  await expect(t).toBeVisible()
  await expect(t.locator('th')).toHaveCount(3)
  await expect(t.locator('tr')).toHaveCount(3) // 헤더 1 + 본문 2
  await expect(t.locator('td')).toHaveCount(6)
  await expect(t.locator('td').first()).toHaveText('활성 사용자')

  // 셀 경계선이 실제로 보이는지 — preflight 리셋 복원 확인(border-collapse + th 보더).
  const style = await t.evaluate((el) => {
    const th = el.querySelector('th')!
    return {
      collapse: getComputedStyle(el).borderCollapse,
      thBorder: getComputedStyle(th).borderTopWidth,
    }
  })
  expect(style.collapse).toBe('collapse')
  expect(parseFloat(style.thBorder)).toBeGreaterThan(0)

  // 2) 편집 → 자동저장 payload 의 마크다운이 표를 보존하는가(라운드트립)
  await page.locator('.ProseMirror p').filter({ hasText: '표 아래 문단' }).click()
  await page.keyboard.type(' 수정')
  await expect.poll(() => saved.length, { timeout: 5000 }).toBeGreaterThan(0)
  const md = saved[saved.length - 1]
  expect(md).toContain('| 항목 |')
  expect(md).toContain('활성 사용자')
  expect(md).toMatch(/\|\s*---/)
  expect(md).toContain('표 아래 문단. 수정')

})

test('슬래시 메뉴에서 표 삽입 + 삽입 경로 마크다운 라운드트립 (#748)', async ({
  authenticatedPage: page,
}) => {
  saved.length = 0
  // 빈 본문에서 시작 — 삽입 결과만 검증하도록 기존 표와 섞이지 않게 한다.
  await setup(page, '')
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()

  await page.locator('.ProseMirror').click()
  await page.keyboard.type('/')
  await expect(page.getByTestId('wiki-slash-popover')).toBeVisible()

  // 표 항목이 AI 액션들과 한 메뉴에 공존하되, AI 마킹은 그룹 헤더에서 한 번만 한다
  // (07-iconography §7.2 — 메뉴가 AI 전용이 아니게 되면서 listbox aria-label 이 하던
  // 컨테이너 마킹을 group 으로 옮겼다). 표 행에는 AI 마커가 붙지 않아야 한다.
  const popover = page.getByTestId('wiki-slash-popover')
  await expect(popover.getByRole('group', { name: 'AI' })).toBeVisible()
  await expect(popover.getByRole('group', { name: 'AI' })).toContainText('AI 요약')
  await expect(popover.getByTestId('wiki-slash-option-table')).toHaveCount(1)
  await expect(popover.getByRole('group', { name: 'AI' }).getByTestId('wiki-slash-option-table')).toHaveCount(0)
  await expect(page.getByTestId('wiki-slash-option-summarize')).toBeVisible()
  await page.getByTestId('wiki-slash-option-table').click()

  // 목록이 같은 팝업 안에서 그리드로 바뀐다 — 새 팝오버 레이어가 생기지 않아야 한다.
  await expect(page.getByTestId('wiki-slash-popover')).toHaveCount(1)
  const grid = page.getByTestId('wiki-table-size-grid')
  await expect(grid).toBeVisible()
  await expect(page.getByTestId('wiki-table-size-label')).toHaveText('3 × 3')

  // 4열 × 2행 선택(라벨은 행 × 열 표기).
  await page.getByTestId('wiki-table-size-cell-2-4').hover()
  await expect(page.getByTestId('wiki-table-size-label')).toHaveText('2 × 4')
  await page.getByTestId('wiki-table-size-cell-2-4').click()

  // 헤더 행 포함 2행 × 4열 이 삽입되고 '/' 트리거는 남지 않는다.
  const t = page.locator('.ProseMirror table')
  await expect(t).toBeVisible()
  await expect(t.locator('th')).toHaveCount(4)
  await expect(t.locator('tr')).toHaveCount(2)
  await expect(t.locator('td')).toHaveCount(4)
  await expect(page.locator('.ProseMirror')).not.toContainText('/')

  await page.keyboard.type('항목')
  await expect.poll(() => saved.length, { timeout: 5000 }).toBeGreaterThan(0)
  const md = saved[saved.length - 1]
  expect(md).toContain('항목')
  const delimiter = md.split('\n').find((l) => l.includes('---'))!
  expect(delimiter.split('---')).toHaveLength(5) // 4열
})

test('그리드 피커 — 방향키로 크기를 바꾸고 Enter 로 삽입, Escape 로 목록 복귀', async ({
  authenticatedPage: page,
}) => {
  saved.length = 0
  await setup(page, '')
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()

  await page.locator('.ProseMirror').click()
  await page.keyboard.type('/')
  await page.getByTestId('wiki-slash-option-table').click()
  await expect(page.getByTestId('wiki-table-size-label')).toHaveText('3 × 3')

  // Escape 는 팝업을 닫지 않고 목록으로 되돌린다.
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('wiki-table-size-grid')).toHaveCount(0)
  await expect(page.getByTestId('wiki-slash-option-table')).toBeVisible()

  await page.getByTestId('wiki-slash-option-table').click()
  await page.keyboard.press('ArrowDown') // 4행
  await page.keyboard.press('ArrowRight') // 4열
  await expect(page.getByTestId('wiki-table-size-label')).toHaveText('4 × 4')
  await page.keyboard.press('Enter')

  const t = page.locator('.ProseMirror table')
  await expect(t.locator('th')).toHaveCount(4)
  await expect(t.locator('tr')).toHaveCount(4)
})
