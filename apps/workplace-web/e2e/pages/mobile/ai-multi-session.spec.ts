// 모바일 AI 시트 멀티 세션(WP-190) — 시트의 대화 목록 버튼 점·목록 상태 문구·상한 안내의 [대화 목록 보기].
import { ask, sessionItem, setupLiveChat, summary, TITLE_A, TITLE_B, TITLE_C } from '../../fixtures/ai-live-chat'
import { expect, expectNoHorizontalOverflow, stubChat, test } from '../../fixtures/mobile.fixture'

test('시트: 다른 대화가 답변 중이면 대화 목록 버튼에 점, 목록엔 상태 문구 (WP-190)', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  live.setSessions([summary('s-a', TITLE_A, 1)])
  await page.goto('/chat')
  await page.getByTestId('mobile-tab-ai').click()
  await ask(page, live, TITLE_A)
  await page.getByTestId('ai-sheet-new-session').click()
  const trigger = page.getByTestId('ai-sheet-session-switcher')
  await expect(trigger.getByTestId('chat-session-switcher-dot')).toBeVisible()
  await expect(trigger).toHaveAttribute('aria-label', '대화 목록, 다른 대화 답변 중')
  await trigger.click()
  await expect(sessionItem(page, TITLE_A).getByTestId('chat-session-status')).toHaveText('답변 생성 중…')
  await expectNoHorizontalOverflow(page)
})

test('시트: 다른 대화에 새 답변이 도착하면 점·aria-label·목록 문구가 바뀐다 (WP-190)', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  live.setSessions([summary('s-a', TITLE_A, 1)])
  await page.goto('/chat')
  await page.getByTestId('mobile-tab-ai').click()
  await ask(page, live, TITLE_A)
  await page.getByTestId('ai-sheet-new-session').click()
  const trigger = page.getByTestId('ai-sheet-session-switcher')
  await live.push('done', { correlationId: 'corr-a', sessionId: 's-a', widgets: null })
  await expect(trigger).toHaveAttribute('aria-label', '대화 목록, 다른 대화에 새 답변')
  await expect(trigger.getByTestId('chat-session-switcher-dot')).toBeVisible()
  await trigger.click()
  await expect(sessionItem(page, TITLE_A).getByTestId('chat-session-status')).toHaveText('새 답변')
  await expectNoHorizontalOverflow(page)
})

test('시트: 상한 안내의 [대화 목록 보기]가 시트 목록을 연다 (WP-190)', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  live.queueStart({ correlationId: 'corr-b', sessionId: 's-b' })
  live.queueStart({ correlationId: 'corr-c', sessionId: 's-c' })
  live.setSessions([summary('s-c', TITLE_C, 1), summary('s-b', TITLE_B, 2), summary('s-a', TITLE_A, 3)])
  await page.goto('/chat')
  await page.getByTestId('mobile-tab-ai').click()
  for (const t of [TITLE_A, TITLE_B, TITLE_C]) {
    await ask(page, live, t)
    await page.getByTestId('ai-sheet-new-session').click()
  }
  const notice = page.getByTestId('chat-limit-notice')
  await expect(notice).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await notice.getByRole('button', { name: '대화 목록 보기' }).click()
  await expect(sessionItem(page, TITLE_B)).toBeVisible()
})
