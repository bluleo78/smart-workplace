import type { Page } from '@playwright/test'

import { leaveAllCollabPeers } from '../../fixtures/collab'
import { expect, test } from '../../fixtures/mobile.fixture'
import { mockWikiPageEditor, mockWikiRevisions } from '../../fixtures/wiki-mock'
import {
  LONG_DETAILS,
  LONG_LIST,
  LONG_LIVE,
  LONG_PAGE_ID,
  LONG_TITLE,
  longPagePath,
  mockLongNoteExtras,
  REVISION_NOW,
  REVISION_SPACE_ID,
  revisionShot as shot,
} from '../../fixtures/wiki-revisions'

// 모바일(390px) 노트 버전 기록(WP-298) 디자이너 게이트 — 실데이터 시각 검증 스크린샷 전용.
// REVISION_SHOTS(절대 경로)가 있을 때만 돈다 — 회귀 단언은 wiki-revisions.spec.ts 가 맡는다.
test.use({ timezoneId: 'Asia/Seoul' })
test.skip(!process.env.REVISION_SHOTS, '시각 검증 스크린샷 전용 — REVISION_SHOTS 가 있을 때만')

test.afterEach(() => leaveAllCollabPeers())

const previewLayer = (p: Page) => p.getByTestId('wiki-revision-mobile-preview')

for (const scheme of ['light', 'dark'] as const) {
  test(`모바일 버전 기록 실데이터 ${scheme} — 목록 · 미리보기(변경 표시 켬/끔) · 어제 판 · 하단 복원`, async ({ authenticatedPage: a }) => {
    const tag = `mobile-390-${scheme}`
    await a.emulateMedia({ colorScheme: scheme })
    await mockWikiPageEditor(a, { spaceId: REVISION_SPACE_ID, pageId: LONG_PAGE_ID, title: LONG_TITLE, body: LONG_LIVE })
    await mockWikiRevisions(a, { pageId: LONG_PAGE_ID, list: LONG_LIST, details: LONG_DETAILS })
    await mockLongNoteExtras(a)
    await a.clock.install({ time: REVISION_NOW })
    await a.goto(longPagePath)
    await expect(a.getByTestId('wiki-image').first()).toBeVisible()
    await a.getByTestId('wiki-page-header').getByRole('button', { name: '페이지 메뉴' }).tap()
    await a.getByTestId('wiki-menu-history').tap()
    await expect(a.getByTestId('wiki-revision-list')).toBeVisible()
    await shot(a, `${tag}-01-list`)
    await a.getByTestId('wiki-revision-list').evaluate((el) => el.scrollTo(0, el.scrollHeight))
    await shot(a, `${tag}-02-list-bottom`)
    await a.getByTestId('wiki-revision-list').evaluate((el) => el.scrollTo(0, 0))

    // AI 적용 직전 판 — 변경 표시 켬(기본) → 표·코드까지 내려 본다 → 끔.
    await a.getByTestId('wiki-revision-item-12').tap()
    await expect(previewLayer(a).locator('.wiki-diff-added').first()).toBeVisible()
    await shot(a, `${tag}-03-preview-diff-top`)
    await previewLayer(a).locator('table').first().evaluate((el) => el.scrollIntoView({ block: 'start' }))
    await shot(a, `${tag}-04-preview-diff-table`)
    await previewLayer(a).locator('pre').first().evaluate((el) => el.scrollIntoView({ block: 'center' }))
    await shot(a, `${tag}-05-preview-diff-code`)
    await previewLayer(a).getByTestId('wiki-revision-diff-toggle').tap()
    await expect(previewLayer(a).locator('.wiki-diff-added')).toHaveCount(0)
    await shot(a, `${tag}-06-preview-nodiff`)

    // 어제 판 — 제목에 날짜 말("어제")이 붙는다.
    await a.goBack()
    await a.getByTestId('wiki-revision-item-7').tap()
    await expect(previewLayer(a).getByTestId('mobile-back-title')).toHaveText('어제 17:48 버전')
    await shot(a, `${tag}-07-preview-yesterday`)
  })
}
