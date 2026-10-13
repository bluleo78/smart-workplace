// WP-139 모바일 AI 시트의 빈 대화 추천 — 행 높이 44px 이상, 탭하면 전송.
import { mockStarterSuggestions } from '../../fixtures/ai-suggestions-mock'
import { type HomeChatStartBody, mockHomeChatGeneration } from '../../fixtures/home-chat-mock'
import { expect, expectNoHorizontalOverflow, stubChat, test } from '../../fixtures/mobile.fixture'

test('시트의 빈 대화에 추천이 보이고 행은 44px 이상, 탭하면 그 문구로 보낸다', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await mockStarterSuggestions(page, { replies: [{ items: [], enabled: true }] })
  const chat = await mockHomeChatGeneration(page, { frames: [{ event: 'done', data: { sessionId: 's-m' } }] })
  await page.goto('/chat')
  await page.getByTestId('mobile-tab-ai').click()
  const rows = page.getByTestId('starter-suggestion')
  await expect(rows).toHaveCount(4)
  for (const box of await Promise.all((await rows.all()).map((r) => r.boundingBox()))) {
    expect(box!.height).toBeGreaterThanOrEqual(44)
  }
  await expectNoHorizontalOverflow(page)
  await rows.first().tap()
  await expect.poll(chat.count).toBe(1)
  expect(chat.lastBody<HomeChatStartBody>()).toMatchObject({ query: '오늘 일정 요약해줘' })
})
