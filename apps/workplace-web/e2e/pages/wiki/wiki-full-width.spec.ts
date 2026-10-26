// 노트 「전체 폭」(WP-793) — ⋯ 메뉴 스위치로 본문을 읽기 폭(가운데 768px) 대신 화면 폭 전체로 펼치고, 페이지에 저장한다.
// 누구에게 항목이 보이는지(권한·접근 상실)는 WikiPageHeader.test.tsx 가 보고, 여기선 저장 요청 → 본문 폭 반영 배선을 본다.
// 저장 거절 → 켜짐 되돌림·사유 안내는 src/pages/wiki/wikiPage.test.tsx 가 지킨다(WP-983). 여기엔 실제 폭(@layout)만 남는다.
import type { Page } from '@playwright/test'

import type { WikiPageDetail } from '../../../src/types/wiki'
import { expect, test } from '../../fixtures/auth.fixture'
import { columnGaps as gapsOf, expectStartAligned } from '../../fixtures/layout'
import { mockWikiPageEditor, wikiEditorOpener } from '../../fixtures/wiki-mock'

const SPACE_ID = 1
const PAGE_ID = 793
const TITLE = '업무 진행 현황'
const BODY = '- 자율 결함 탐색 및 등록 (진행중~12/31, 3/4) - 동시 요청 충돌, 보이지 않는 글자 이름, 반복 일정 과부하, 드라이브 폴더 순환 점검'

const open = wikiEditorOpener(SPACE_ID, PAGE_ID)

/**
 * 에디터 화면 모킹 + 「전체 폭」 값을 들고 있는 상세 GET·PUT(mockWikiPageEditor 뒤에 등록 — 나중 라우트가 먼저 받는다).
 * putStatus 가 200 이 아니면 PUT 을 그 상태로 거절한다(값은 바뀌지 않음). mockWikiPageEditor 의 PUT 기록을 돌려준다.
 */
async function setup(page: Page, { fullWidth = false, putStatus = 200 }: { fullWidth?: boolean; putStatus?: number } = {}) {
  const puts = await mockWikiPageEditor(page, { spaceId: SPACE_ID, pageId: PAGE_ID, title: TITLE, body: BODY })
  const state = { fullWidth }
  const detail = (): WikiPageDetail => ({
    id: PAGE_ID, spaceId: SPACE_ID, parentId: null, title: TITLE, body: BODY, version: 1, updatedBy: 1,
    updatedAt: '2026-10-22T00:00:00Z', aiLastUsedAt: null, aiLastAction: null, fullWidth: state.fullWidth,
  })
  await page.route((u) => u.pathname === `/api/v1/wiki/pages/${PAGE_ID}`, (r) => {
    if (r.request().method() === 'PUT') {
      if (putStatus !== 200) return r.fulfill({ status: putStatus, json: { message: '편집 권한이 없습니다' } })
      state.fullWidth = (r.request().postDataJSON() as { fullWidth: boolean }).fullWidth
    }
    return r.fulfill({ json: detail() })
  })
  return puts
}

/** 본문 칼럼과 스크롤 영역의 좌우 여백. */
const columnGaps = (page: Page) => gapsOf(page.getByTestId('page-body-content'), page.getByTestId('wiki-editor-scroll'))

test.use({ viewport: { width: 1600, height: 900 } })

test('⋯ 「전체 폭」을 켜면 저장되고 본문이 화면 폭으로 펼쳐지며, 다시 열어도 유지된다 @smoke', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  const puts = await setup(page)
  await open(page)

  // 기본 — 읽기 폭(≤768)이 가운데. 좌우 여백 차이는 세로 스크롤바 폭 이내.
  const before = await columnGaps(page)
  expect(before.width).toBeLessThanOrEqual(768)
  expect(Math.abs(before.left - before.right)).toBeLessThanOrEqual(16)

  await page.getByTestId('wiki-page-menu').click()
  const item = page.getByRole('menuitemcheckbox', { name: '전체 폭' })
  await expect(item).toHaveAttribute('aria-checked', 'false')
  await item.click()

  // 저장 요청 — 제목·본문은 건드리지 않는다(null = 유지).
  await expect.poll(() => puts.count()).toBe(1)
  expect(puts.lastBody()).toEqual({ title: null, body: null, fullWidth: true })
  // 메뉴는 열린 채 켜짐으로 바뀌고, 뒤에서 본문이 넓어진다.
  await expect(item).toHaveAttribute('aria-checked', 'true')
  await expect.poll(async () => (await columnGaps(page)).width).toBeGreaterThan(1000)

  await page.keyboard.press('Escape')
  // 전체 폭이면 본문 시작선이 헤더 경로와 같은 축으로 돌아온다.
  await expectStartAligned(page.getByTestId('wiki-breadcrumb-current'), page.getByPlaceholder('제목 없음'))

  // 다시 열어도(서버 값) 넓게 그린다.
  await open(page, { reload: true })
  expect((await columnGaps(page)).width).toBeGreaterThan(1000)
})

test('「전체 폭」 페이지에서 끄면 가운데 읽기 폭으로 돌아온다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  const puts = await setup(page, { fullWidth: true })
  await open(page)
  expect((await columnGaps(page)).width).toBeGreaterThan(1000)

  await page.getByTestId('wiki-page-menu').click()
  const item = page.getByRole('menuitemcheckbox', { name: '전체 폭' })
  await expect(item).toHaveAttribute('aria-checked', 'true')
  await item.click()

  await expect.poll(() => puts.count()).toBe(1)
  expect(puts.lastBody()).toEqual({ title: null, body: null, fullWidth: false })
  await expect.poll(async () => (await columnGaps(page)).width).toBeLessThanOrEqual(768)
})

