// WP-379 — 홈 채팅 요청에 지금 화면 앱(app)을 싣는다: 화면 참고(screenContext)와 별도 필드이고, 화면 참고를 × 로 빼도 app 은 보낸다.
import { expect, test } from '../fixtures/auth.fixture'
import { type HomeChatStartBody, mockHomeChatGeneration } from '../fixtures/home-chat-mock'
import { mockIssueDetail } from '../fixtures/issue-detail-mock'

type Page = Parameters<typeof mockIssueDetail>[0]

// 채팅 응답을 목하고 전송 요청 기록을 돌려준다(ai-screen-context.spec 과 같은 방식).
async function captureChat(page: Page) {
  return mockHomeChatGeneration(page, { frames: [{ event: 'done', data: { sessionId: 's-app' } }] })
}

test('이슈 상세에서 보내면 app 은 ISSUE 이고 화면 참고에는 app 이 실리지 않는다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  const chat = await captureChat(page)
  await mockIssueDetail(page)
  await page.goto('/projects/WP/issues/12')
  await page.getByTestId('chat-launcher').click()
  await expect(page.getByTestId('chat-context-chip')).toBeVisible()
  await page.getByTestId('chat-input').fill('이거 요약해줘')
  await page.getByRole('button', { name: '보내기' }).click()

  await expect.poll(chat.count).toBe(1)
  const body = chat.bodies<HomeChatStartBody>()[0]
  expect(body.app).toBe('ISSUE')
  expect(body.screenContext).toBeDefined()
  expect(body.screenContext).not.toHaveProperty('app')
})

// 화면 참고 × 는 화면 내용만 뺀다 — 내 선호 범위(app)는 그대로 보낸다.
test('화면 정보를 빼고 보내도 app 은 실린다', async ({ authenticatedPage: page }) => {
  const chat = await captureChat(page)
  await mockIssueDetail(page)
  await page.goto('/projects/WP/issues/12')
  await page.getByTestId('chat-launcher').click()
  await page.getByTestId('chat-context-remove').click()
  await expect(page.getByTestId('chat-context-chip-excluded')).toBeVisible()
  await page.getByTestId('chat-input').fill('첫 질문')
  await page.getByRole('button', { name: '보내기' }).click()

  await expect.poll(chat.count).toBe(1)
  const body = chat.bodies<HomeChatStartBody>()[0]
  expect(body).not.toHaveProperty('screenContext')
  expect(body.app).toBe('ISSUE')
})
