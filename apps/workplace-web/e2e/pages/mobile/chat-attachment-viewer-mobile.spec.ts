// 채팅 3곳 첨부 → 통합 첨부 뷰어 모바일(WP-279) — iPhone 13 뷰포트 + chromium(coarse 포인터).
// 탭 = 전체 화면 뷰어, 길게 누르기 = 메시지 작업 시트(뷰어 아님). 뒤로가기는 뷰어만 닫고 스레드(?thread)·이슈 채팅 드로워(?chat=1)·AI 시트는 남는다.
// 뷰어가 시트·드로워 위 최상단 상호작용 레이어인지(‹ › ✕ ⬇ 조작)도 확인한다.
import type { Page } from '@playwright/test'

import { LINK_TEXT, stubHomeChatAttachments, stubIssueChatAttachments, stubTeamChatAttachments } from '../../fixtures/chat-viewer-mock'
import { KEY, longPress } from '../../fixtures/mobile-chat'
import { expect, expectOnTop, test } from '../../fixtures/mobile.fixture'
import { centerOf, touchDrag } from '../../fixtures/touch'

const VIEWER = '[data-testid="attachment-viewer"]'

/** 뷰어의 ‹ · › · ✕ · ⬇ 가 가려지지 않은 최상단인지 — 시트·드로워 위에 떠야 한다. */
async function expectViewerOnTop(page: Page) {
  const bar = page.getByTestId('viewer-action-bar')
  await expectOnTop(page, bar.getByTestId('preview-download'), VIEWER)
  await expectOnTop(page, page.getByTestId('viewer-top-bar').getByRole('button', { name: '닫기' }), VIEWER)
}

test('팀 채팅: 썸네일 탭 → 전체 화면 뷰어, 스와이프·‹ 로 넘기고 ⬇ 저장, 뒤로가기는 뷰어만 닫는다', async ({ authenticatedPage: page }) => {
  await stubTeamChatAttachments(page)
  await page.goto('/chat/channels/1')
  await page.getByTestId('attachment-image-open-801').tap()
  await expect(page.getByTestId('attachment-viewer')).toBeVisible()
  await expect(page.getByTestId('preview-meta')).toContainText('1 / 4')

  // 하단 4칸: 업로드라 드라이브 칸은 차 있고, 요약 칸은 비어 있다(위치 고정).
  const bar = page.getByTestId('viewer-action-bar')
  await expect(bar.locator('[data-slot-id="drive"]')).not.toHaveAttribute('data-state', 'empty')
  await expect(bar.locator('[data-slot-id="summary"]')).toHaveAttribute('data-state', 'empty')

  // 왼쪽으로 두 번 밀어 드라이브 링크(3 / 4) — 요약 칸이 찬다(드라이브 칸은 비고).
  const stage = page.getByTestId('viewer-stage')
  let c = await centerOf(stage)
  await touchDrag(page, c, { x: c.x - 180, y: c.y })
  await expect(page.getByTestId('preview-meta')).toContainText('2 / 4')
  await expect(page.getByTestId('pdf-page-1')).toBeVisible()
  c = await centerOf(stage)
  await touchDrag(page, c, { x: c.x - 180, y: c.y })
  await expect(page.getByTestId('preview-meta')).toContainText('3 / 4')
  await expect(page.getByTestId('preview-body')).toContainText(LINK_TEXT)
  await expect(bar.locator('[data-slot-id="summary"]')).not.toHaveAttribute('data-state', 'empty')
  await expect(bar.locator('[data-slot-id="drive"]')).toHaveAttribute('data-state', 'empty')

  const download = page.waitForEvent('download')
  await bar.getByTestId('preview-download').tap()
  expect((await download).suggestedFilename()).toBe('회의록.txt')

  await page.getByRole('button', { name: '이전 파일' }).tap()
  await expect(page.getByTestId('preview-meta')).toContainText('2 / 4')

  await page.goBack()
  await expect(page.getByTestId('attachment-viewer')).toHaveCount(0)
  await expect(page).toHaveURL(/\/chat\/channels\/1$/)
  await expect(page.getByTestId('message-list').first()).toBeVisible()
})

test('팀 채팅: 첨부 위에서 길게 누르면 작업 시트만 열리고 뷰어는 열리지 않는다(발동 뒤 click 억제)', async ({ authenticatedPage: page }) => {
  await stubTeamChatAttachments(page)
  await page.goto('/chat/channels/1')
  await longPress(page, page.getByTestId('attachment-image-open-801'))
  await expect(page.getByTestId('message-action-sheet')).toBeVisible()
  await expect(page.getByTestId('attachment-viewer')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('message-action-sheet')).toHaveCount(0)

  await longPress(page, page.getByTestId('attachment-card-802'))
  await expect(page.getByTestId('message-action-sheet')).toBeVisible()
  await expect(page.getByTestId('attachment-viewer')).toHaveCount(0)
})

test('팀 채팅 스레드: 스레드 안 카드 탭 → 뷰어 하나, 뒤로가기는 뷰어만 닫고 ?thread 는 남는다', async ({ authenticatedPage: page }) => {
  await stubTeamChatAttachments(page)
  await page.goto('/chat/channels/1')
  await page.getByTestId('message-thread-link-10').tap()
  const panel = page.getByTestId('thread-panel')
  await expect(panel).toBeVisible()
  await panel.getByTestId('attachment-card-802').tap()
  await expect(page.getByTestId('pdf-page-1')).toBeVisible()
  await expect(page.getByTestId('attachment-viewer')).toHaveCount(1)
  await expectViewerOnTop(page)

  await page.goBack()
  await expect(page.getByTestId('attachment-viewer')).toHaveCount(0)
  await expect(page).toHaveURL(/\/chat\/channels\/1\?thread=10$/)
  await expect(panel).toBeVisible()
})

test('이슈 채팅 드로워: 카드 탭 → 드로워 위 뷰어(‹ › ✕ ⬇ 조작), 뒤로가기는 뷰어만 닫고 ?chat=1 은 남는다', async ({ authenticatedPage: page }) => {
  await stubIssueChatAttachments(page)
  await page.goto(`/projects/${KEY}/issues/1`)
  await page.getByTestId('issue-chat-open').tap()
  await expect(page).toHaveURL(/[?&]chat=1$/)
  await page.getByTestId('attachment-card-802').tap()
  await expect(page.getByTestId('pdf-page-1')).toBeVisible()
  await expect(page.getByTestId('preview-meta')).toContainText('2 / 4')
  await expectViewerOnTop(page)

  await page.getByRole('button', { name: '다음 파일' }).tap()
  await expect(page.getByTestId('preview-body')).toContainText(LINK_TEXT)
  await page.getByRole('button', { name: '이전 파일' }).tap()
  await expect(page.getByTestId('preview-meta')).toContainText('2 / 4')
  const download = page.waitForEvent('download')
  await page.getByTestId('viewer-action-bar').getByTestId('preview-download').tap()
  expect((await download).suggestedFilename()).toBe('보고서.pdf')

  await page.goBack()
  await expect(page.getByTestId('attachment-viewer')).toHaveCount(0)
  await expect(page).toHaveURL(/[?&]chat=1$/)
  await expect(page.getByTestId('attachment-card-802')).toBeVisible()

  // ✕ 로 닫아도 같은 결과 — 열 때 쌓은 항목만 되돌린다.
  await page.getByTestId('attachment-card-802').tap()
  await expect(page.getByTestId('attachment-viewer')).toBeVisible()
  await page.getByTestId('viewer-top-bar').getByRole('button', { name: '닫기' }).tap()
  await expect(page.getByTestId('attachment-viewer')).toHaveCount(0)
  await expect(page).toHaveURL(/[?&]chat=1$/)
  // 닫으면 연 카드로 포커스가 돌아온다(터치로 열어도 같다).
  await expect(page.getByTestId('attachment-card-802')).toBeFocused()

  // 썸네일 탭으로도 열리고, 링크(3 / 4)로 넘기면 요약 칸이 찬다(드라이브 칸은 빈다).
  await page.getByTestId('attachment-image-open-801').tap()
  await expect(page.getByTestId('preview-meta')).toContainText('1 / 4')
  const bar = page.getByTestId('viewer-action-bar')
  await expect(bar.locator('[data-slot-id="summary"]')).toHaveAttribute('data-state', 'empty')
  await page.getByRole('button', { name: '다음 파일' }).tap()
  await page.getByRole('button', { name: '다음 파일' }).tap()
  await expect(page.getByTestId('preview-body')).toContainText(LINK_TEXT)
  await expect(bar.locator('[data-slot-id="summary"]')).not.toHaveAttribute('data-state', 'empty')
  await expect(bar.locator('[data-slot-id="drive"]')).toHaveAttribute('data-state', 'empty')
})

test('AI 시트: 복원한 대화 썸네일 탭 → 시트 위 뷰어, 뒤로가기는 뷰어만 닫고 시트는 남는다', async ({ authenticatedPage: page }) => {
  await stubHomeChatAttachments(page)
  await page.goto('/chat')
  await page.getByTestId('mobile-tab-ai').click()
  await expect(page.getByTestId('ai-sheet')).toBeVisible()
  await page.getByTestId('ai-sheet-session-switcher').click()
  await page.getByTestId('chat-session-select').first().click()
  const turn = page.getByTestId('chat-turn').first()
  await expect(turn.getByTestId('attachment-image-77')).toHaveAttribute('src', /^blob:/)

  await turn.getByTestId('attachment-image-open-77').tap()
  await expect(page.getByTestId('attachment-viewer')).toBeVisible()
  await expect(page.getByTestId('preview-meta')).toContainText('1 / 2')
  // 메인 AI 채팅은 ☁·✨ 칸이 비어 있다.
  const bar = page.getByTestId('viewer-action-bar')
  await expect(bar.locator('[data-slot-id="drive"]')).toHaveAttribute('data-state', 'empty')
  await expect(bar.locator('[data-slot-id="summary"]')).toHaveAttribute('data-state', 'empty')
  await expectViewerOnTop(page)
  await page.getByRole('button', { name: '다음 파일' }).tap()
  await expect(page.getByTestId('pdf-page-1')).toBeVisible()

  await page.goBack()
  await expect(page.getByTestId('attachment-viewer')).toHaveCount(0)
  await expect(page.getByTestId('ai-sheet')).toBeVisible()
  await expect(turn.getByTestId('attachment-image-77')).toBeVisible()

  // 문서 카드도 시트 위 뷰어로 열고 하단 ⬇ 로 받는다. ✕ 로 닫으면 카드로 포커스.
  await turn.getByTestId('attachment-card-78').tap()
  await expect(page.getByTestId('pdf-page-1')).toBeVisible()
  await expect(page.getByTestId('preview-meta')).toContainText('2 / 2')
  await expectViewerOnTop(page)
  const download = page.waitForEvent('download')
  await bar.getByTestId('preview-download').tap()
  expect((await download).suggestedFilename()).toBe('spec.pdf')
  await page.getByTestId('viewer-top-bar').getByRole('button', { name: '닫기' }).tap()
  await expect(page.getByTestId('attachment-viewer')).toHaveCount(0)
  await expect(page.getByTestId('ai-sheet')).toBeVisible()
  await expect(turn.getByTestId('attachment-card-78')).toBeFocused()
})
