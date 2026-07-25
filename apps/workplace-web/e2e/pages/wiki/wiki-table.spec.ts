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
