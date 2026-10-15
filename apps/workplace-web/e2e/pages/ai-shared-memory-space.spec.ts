// WP-386 — 홈 채팅 요청에 지금 화면의 공간(space)을 싣는다: 프로젝트 화면은 키, 노트 화면은 스페이스 id. 화면 참고를 × 로 빼도 보낸다(서버가 권한을 다시 확인한다).
import { expect, test } from '../fixtures/auth.fixture'
import { type HomeChatStartBody, mockHomeChatGeneration } from '../fixtures/home-chat-mock'
import { mockIssueDetail } from '../fixtures/issue-detail-mock'

type Page = Parameters<typeof mockIssueDetail>[0]

async function captureChat(page: Page) {
  return mockHomeChatGeneration(page, { frames: [{ event: 'done', data: { sessionId: 's-space' } }] })
}

async function send(page: Page, text: string) {
  await page.getByTestId('chat-input').fill(text)
  await page.getByRole('button', { name: '보내기' }).click()
}

test('이슈 상세에서 보내면 space 는 그 프로젝트 키다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  const chat = await captureChat(page)
  await mockIssueDetail(page)
  await page.goto('/projects/WP/issues/12')
  await page.getByTestId('chat-launcher').click()
  await send(page, '이건 팀 규칙으로 기억해')
  await expect.poll(chat.count).toBe(1)
  expect(chat.bodies<HomeChatStartBody>()[0].space).toEqual({ type: 'PROJECT', key: 'WP' })
})

test('화면 정보를 빼고 보내도 space 는 실린다', async ({ authenticatedPage: page }) => {
  const chat = await captureChat(page)
  await mockIssueDetail(page)
  await page.goto('/projects/WP/issues/12')
  await page.getByTestId('chat-launcher').click()
  await page.getByTestId('chat-context-remove').click()
  await send(page, '첫 질문')
  await expect.poll(chat.count).toBe(1)
  const body = chat.bodies<HomeChatStartBody>()[0]
  expect(body).not.toHaveProperty('screenContext')
  expect(body.space).toEqual({ type: 'PROJECT', key: 'WP' })
})

test('공간이 없는 화면(홈)에서는 space 키가 없다', async ({ authenticatedPage: page }) => {
  const chat = await captureChat(page)
  await page.goto('/')
  await page.getByTestId('chat-launcher').click()
  await send(page, '오늘 할 일')
  await expect.poll(chat.count).toBe(1)
  expect(chat.bodies<HomeChatStartBody>()[0]).not.toHaveProperty('space')
})
