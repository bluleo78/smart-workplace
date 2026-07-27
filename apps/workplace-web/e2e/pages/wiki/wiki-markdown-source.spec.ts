// 노트 마크다운 소스 보기·내보내기 E2E (#753).
import type { Page } from '@playwright/test'

import type { WikiPageDetail } from '../../../src/types/wiki'
import { expect, test } from '../../fixtures/auth.fixture'

const SPACE_ID = 1
const PAGE_ID = 320
const BODY = ['# 문서 제목', '', '본문 한 줄.', '', '| 항목 | 값 |', '| --- | --- |', '| 활성 | 1,850 |'].join('\n')

async function setup(page: Page, opts: { role?: 'OWNER' | 'VIEWER'; title?: string } = {}) {
  const role = opts.role ?? 'OWNER'
  const title = opts.title ?? '문서 제목'
  await page.route((u) => u.pathname === '/api/v1/wiki/spaces', (r) =>
    r.request().method() === 'GET'
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: SPACE_ID, type: 'PERSONAL', name: '내 노트', ownerId: 1, role, createdAt: '2026-06-01T00:00:00Z' }]) })
      : r.fallback())
  await page.route((u) => u.pathname === `/api/v1/wiki/spaces/${SPACE_ID}/pages`, (r) =>
    r.request().method() === 'GET'
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: PAGE_ID, parentId: null, title, position: 0, aiLastUsedAt: null }]) })
      : r.fallback())
  await page.route((u) => u.pathname === `/api/v1/wiki/spaces/${SPACE_ID}/members`, (r) =>
    r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }) : r.fallback())
  await page.route((u) => u.pathname === `/api/v1/wiki/pages/${PAGE_ID}`, (r) => {
    const d: WikiPageDetail = { id: PAGE_ID, spaceId: SPACE_ID, parentId: null, title, body: BODY, version: 1, updatedBy: 1, updatedAt: '2026-06-01T00:00:00Z', aiLastUsedAt: null, aiLastAction: null }
    const m = r.request().method()
    if (m === 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(d) })
    if (m === 'PUT') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...d, version: 2 }) })
    return r.fallback()
  })
}

test('메뉴에서 마크다운 소스를 열면 현재 본문 원문이 보인다', async ({ authenticatedPage: page }) => {
  await setup(page)
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()

  // 모달을 열기 전에 에디터를 직접 편집해 "저장된 page.body" 와 "현재 에디터 상태" 를
  // 구분할 수 있는 고유 텍스트를 만든다. 이게 없으면 목이 준 BODY 의 부분 문자열만
  // 확인하게 되어, onViewSource 가 editor.storage.markdown.getMarkdown() 대신
  // setSourceMarkdown(page.body) 로 "단순화"돼 미저장 편집분이 사라져도 이 테스트는
  // 여전히 통과한다 — 그게 바로 §4.2 설계 결정("현재 에디터 상태")이 지켜지는지 보는 지점.
  const UNSAVED_MARK = '미저장 편집분 확인용 문장'
  await page.locator('.ProseMirror').click()
  await page.keyboard.press('End')
  await page.keyboard.type(UNSAVED_MARK)
  await expect(page.locator('.ProseMirror')).toContainText(UNSAVED_MARK)

  await page.getByTestId('wiki-page-header').getByRole('button', { name: '페이지 메뉴' }).click()
  await page.getByTestId('wiki-menu-source').click()

  const dialog = page.getByTestId('wiki-source-dialog')
  await expect(dialog).toBeVisible()

  // 저장된 body 가 아니라 에디터가 직렬화한 현재 상태다 — 구조(제목·표)가 보존되는지 확인.
  const src = await page.getByTestId('wiki-source-pre').innerText()
  expect(src).toContain('# 문서 제목')
  expect(src).toContain('본문 한 줄.')
  expect(src).toContain('| 활성 | 1,850 |')
  // 미저장 편집분까지 보인다 — page.body(목이 준 BODY 그대로)를 표시하는 구현으로
  // 바뀌면 이 단언만 실패한다.
  expect(src).toContain(UNSAVED_MARK)

  // 읽기 전용 — pre 안에 편집 가능한 요소가 없어야 한다.
  await expect(dialog.locator('textarea, input, [contenteditable="true"]')).toHaveCount(0)
})

test('복사 버튼이 마크다운을 클립보드에 넣는다', async ({ authenticatedPage: page }) => {
  // page.context() 로 잡는다 — authenticatedPage 가 어느 컨텍스트에 속하는지에 의존하지 않는다.
  // (auth.fixture 는 현재 기본 page 픽스처를 그대로 쓰지만, 나중에 newContext 로 바뀌어도 안전하다.)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await setup(page)
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()

  await page.getByTestId('wiki-page-header').getByRole('button', { name: '페이지 메뉴' }).click()
  await page.getByTestId('wiki-menu-source').click()
  await page.getByTestId('wiki-source-copy').click()

  await expect(page.getByText('마크다운을 복사했습니다')).toBeVisible()
  const clip = await page.evaluate(() => navigator.clipboard.readText())
  expect(clip).toContain('# 문서 제목')
})

test('.md 다운로드가 새니타이즈된 파일명으로 저장된다', async ({ authenticatedPage: page }) => {
  await setup(page, { title: '2026/1분기 지표' })
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()

  await page.getByTestId('wiki-page-header').getByRole('button', { name: '페이지 메뉴' }).click()
  await page.getByTestId('wiki-menu-source').click()

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('wiki-source-download').click(),
  ])
  // 경로 구분자가 _ 로 치환돼야 한다 — 아니면 저장이 실패하거나 엉뚱한 경로로 간다.
  expect(download.suggestedFilename()).toBe('2026_1분기 지표.md')
})

test('편집 권한이 없어도 소스 보기가 노출된다', async ({ authenticatedPage: page }) => {
  await setup(page, { role: 'VIEWER' })
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()

  // 대조군 — VIEWER 목킹이 실제로 WikiEditor 의 role 판정까지 도달했는지 먼저 증명한다.
  // 이게 없으면 오버플로 메뉴가 원래 무조건 렌더되기 때문에 아래 단언이 항상 통과하는
  // 무의미한 테스트가 된다(권한과 무관하게 참).
  const ai = page.getByTestId('wiki-ai-header-button')
  await expect(ai).toHaveAttribute('aria-disabled', 'true')
  await ai.hover()
  // 'denied' 사유여야 한다 — 'loading'(권한 확인 중) 과 구분되어야 role 이 반영된 것이다.
  // Radix Tooltip 이 텍스트 노드를 중복 렌더링하는 특성 때문에 toHaveText 대신
  // toContainText 사용 — wiki-ai.spec.ts 의 동일 locator 검증과 같은 패턴.
  await expect(page.getByTestId('wiki-ai-header-reason')).toContainText(
    '읽기 전용 권한이라 AI 작성을 사용할 수 없습니다',
  )

  // 본단언 — 그 상태에서도 소스 보기는 노출된다.
  // 주의(범위): 이 테스트가 보장하는 건 "마크다운 소스" 항목 한정이다. 같은 오버플로
  // 메뉴의 페이지 삭제 항목도 VIEWER 에게 노출되는데, 그건 이 스펙 범위 밖의 별개
  // 선행 결함(권한 갭)이다 — 나중에 그 갭을 고치면서 "소스 보기까지 게이팅해야 하나"로
  // 오판하지 않도록 여기 명시해 둔다. 삭제 항목에 대한 단언은 의도적으로 없다.
  await page.getByTestId('wiki-page-header').getByRole('button', { name: '페이지 메뉴' }).click()
  await expect(page.getByTestId('wiki-menu-source')).toBeVisible()
})
