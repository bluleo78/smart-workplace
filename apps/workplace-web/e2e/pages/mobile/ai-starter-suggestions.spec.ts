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

// UI 리뷰 #2 — 390px 시트에서도 40자 문구가 말줄임 없이 두 줄로 감겨 끝까지 보이고, 행은 44px 이상을 지킨다.
const LONG40 = '지난주 디자인 리뷰 회의록에서 결정된 사항과 담당자별 할일 모두 정리해줘'

test('시트에서 40자 추천은 두 줄로 감겨 끝까지 보인다', async ({ authenticatedPage: page }) => {
  expect([...LONG40].length).toBe(40)
  await stubChat(page)
  await mockStarterSuggestions(page, { replies: [{ items: [LONG40, '오늘 일정 알려줘', '내 이슈 알려줘', '안 읽은 메일 알려줘'], enabled: true }] })
  await page.goto('/chat')
  await page.getByTestId('mobile-tab-ai').click()
  const row = page.getByTestId('starter-suggestion').first()
  await expect(row).toHaveText(LONG40)
  const m = await row.locator('span').evaluate((el) => ({
    lines: Math.round(el.clientHeight / parseFloat(getComputedStyle(el).lineHeight)),
    clippedY: el.scrollHeight > el.clientHeight,
    clippedX: el.scrollWidth > el.clientWidth,
  }))
  expect(m).toEqual({ lines: 2, clippedY: false, clippedX: false })
  // 한 줄 행은 정확히 44px(가운데 정렬), 두 줄 행은 그보다 높다.
  expect(Math.round((await page.getByTestId('starter-suggestion').nth(1).boundingBox())!.height)).toBe(44)
  expect((await row.boundingBox())!.height).toBeGreaterThan(44)
  await expectNoHorizontalOverflow(page)
})
