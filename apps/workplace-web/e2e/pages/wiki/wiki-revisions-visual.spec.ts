import type { Page } from '@playwright/test'

import { expect, test } from '../../fixtures/auth.fixture'
import { leaveAllCollabPeers } from '../../fixtures/collab'
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

// 노트 버전 기록(WP-298) 디자이너 게이트 — 실데이터(2,000자+ 회의록·판 12개) 시각 검증 스크린샷 전용.
// REVISION_SHOTS(절대 경로)가 있을 때만 돈다 — 회귀 단언은 wiki-revisions.spec.ts 가 맡고, 이 파일은 사람이 볼 화면만 남긴다.
test.use({ timezoneId: 'Asia/Seoul' })
test.skip(!process.env.REVISION_SHOTS, '시각 검증 스크린샷 전용 — REVISION_SHOTS 가 있을 때만')

test.afterEach(() => leaveAllCollabPeers())

/** 실데이터 노트를 열고 ⋯ → 버전 기록. */
async function openLongHistory(p: Page, scheme: 'light' | 'dark') {
  await p.emulateMedia({ colorScheme: scheme })
  await mockWikiPageEditor(p, { spaceId: REVISION_SPACE_ID, pageId: LONG_PAGE_ID, title: LONG_TITLE, body: LONG_LIVE })
  await mockWikiRevisions(p, { pageId: LONG_PAGE_ID, list: LONG_LIST, details: LONG_DETAILS })
  await mockLongNoteExtras(p)
  await p.clock.install({ time: REVISION_NOW })
  await p.goto(longPagePath)
  await expect(p.getByTestId('wiki-image').first()).toBeVisible()
  await p.getByTestId('wiki-page-header').getByRole('button', { name: '페이지 메뉴' }).click()
  await p.getByTestId('wiki-menu-history').click()
  await expect(p.getByTestId('wiki-revision-list')).toBeVisible()
}

/** 미리보기 스크롤 칸을 그 안 요소가 위쪽에 오게 내린다. */
async function scrollPreviewTo(p: Page, selector: string) {
  await p.getByTestId('wiki-revision-preview').locator(selector).first().evaluate((el) => el.scrollIntoView({ block: 'start' }))
}

for (const [w, h] of [
  [1440, 900],
  [1024, 768],
] as const) {
  for (const scheme of ['light', 'dark'] as const) {
    test.describe(`버전 기록 실데이터 ${w}px ${scheme}`, () => {
      test.use({ viewport: { width: w, height: h } })

      test('패널 목록 · AI 판 미리보기(변경 표시 켬/끔) · 어제 판', async ({ authenticatedPage: a }) => {
        const tag = `desktop-${w}-${scheme}`
        await openLongHistory(a, scheme)
        await shot(a, `${tag}-01-panel-list`)
        // 목록 자체가 스크롤 칸(overflow-y-auto) — 맨 아래(지난 날짜 판)까지 내린다.
        await a.getByTestId('wiki-revision-list').evaluate((el) => el.scrollTo(0, el.scrollHeight))
        await shot(a, `${tag}-02-panel-list-bottom`)
        await a.getByTestId('wiki-revision-list').evaluate((el) => el.scrollTo(0, 0))

        // AI 적용 직전 판 — 라이브 대비 AI 가 바꾼 내용(문단 낱말·표 행·이미지·코드 줄·목록 항목).
        await a.getByTestId('wiki-revision-item-12').click()
        await expect(a.getByTestId('wiki-revision-preview').locator('.wiki-diff-added').first()).toBeVisible()
        await shot(a, `${tag}-03-preview-diff-top`)
        await scrollPreviewTo(a, 'table')
        await shot(a, `${tag}-04-preview-diff-table`)
        await scrollPreviewTo(a, 'pre')
        await shot(a, `${tag}-05-preview-diff-code`)
        await a.getByTestId('wiki-revision-diff-toggle').click()
        await expect(a.getByTestId('wiki-revision-preview').locator('.wiki-diff-added')).toHaveCount(0)
        await a.getByTestId('wiki-revision-preview-scroll').evaluate((el) => el.scrollTo(0, 0))
        await shot(a, `${tag}-06-preview-nodiff`)

        // 어제 판 — 바 문구의 날짜.
        await a.getByTestId('wiki-revision-diff-toggle').click()
        await a.getByTestId('wiki-revision-item-7').click()
        await expect(a.getByTestId('wiki-revision-bar-label')).toContainText('17:48')
        await shot(a, `${tag}-07-preview-yesterday`)
        // 복원 버튼 포커스 링.
        await a.getByTestId('wiki-revision-restore').focus()
        await a.keyboard.press('Shift+Tab')
        await a.keyboard.press('Tab')
        await shot(a, `${tag}-08-restore-focus`)
      })
    })
  }
}
