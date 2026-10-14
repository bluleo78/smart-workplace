// WP-384 대화 딥링크(데스크톱) — /?chat=<id> 로 사이드 패널을 열고 대화를 복원한 뒤 파라미터를 지운다. 없는 대화는 토스트, 모양이 틀린 id 는
// 서버에 묻지 않는다. AI 답 안 내부 링크는 같은 탭(라우터)으로 다른 대화를 열고 외부 링크는 새 탭. 검색 도구 단계 라벨.
import type { Page } from '@playwright/test'

import { expect, test } from '../fixtures/auth.fixture'
import { mockApi } from '../fixtures/api-mock'
import { mockHomeChatGeneration } from '../fixtures/home-chat-mock'
import { trackRequests } from '../fixtures/requests'
import type { HomeMessage } from '../../src/types/home'

const ID = '3f1c2a4e-8b7d-4c1e-9f2a-6d5b4c3a2e1f'
const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'

/** 질문·답 한 턴 이력. */
function turn(question: string, answer: string): HomeMessage[] {
  return [
    { id: 1, role: 'USER', content: question, widgets: null, toolCalls: null, createdAt: '2026-10-10T00:00:00Z' },
    { id: 2, role: 'ASSISTANT', content: answer, widgets: null, toolCalls: null, createdAt: '2026-10-10T00:00:01Z' },
  ]
}

async function mockSession(page: Page, id: string, messages: HomeMessage[]) {
  await mockApi(page, 'GET', `/api/v1/home/sessions/${id}/messages`, messages)
  await mockApi(page, 'GET', `/api/v1/home/sessions/${id}/proposals`, [])
}

test('딥링크로 들어오면 사이드 패널에 그 대화를 복원하고 주소의 chat 파라미터를 지운다', async ({ authenticatedPage: page }) => {
  await mockSession(page, ID, turn('고양이 사진 어디 둘까', '사진/고양이 폴더에 모으세요'))
  await page.goto(`/?chat=${ID}`)
  await expect(page.getByTestId('ai-side-panel')).toBeVisible()
  await expect(page.getByTestId('chat-panel')).toContainText('사진/고양이 폴더에 모으세요')
  await expect(page).not.toHaveURL(/chat=/)
})

test('없거나 남의 대화면 "대화를 찾을 수 없어요" 토스트를 띄우고 파라미터를 지운다', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', `/api/v1/home/sessions/${ID}/messages`, { status: 404, message: '대화를 찾을 수 없습니다' }, { status: 404 })
  await mockApi(page, 'GET', `/api/v1/home/sessions/${ID}/proposals`, [])
  await page.goto(`/?chat=${ID}`)
  await expect(page.getByText('대화를 찾을 수 없어요')).toBeVisible()
  await expect(page).not.toHaveURL(/chat=/)
})

test('모양이 틀린 id 는 서버에 묻지 않고 토스트만 띄운다', async ({ authenticatedPage: page }) => {
  const calls = trackRequests(page, 'GET', /^\/api\/v1\/home\/sessions\/[^/]+\/messages$/)
  await page.goto('/?chat=not-a-uuid')
  await expect(page.getByText('대화를 찾을 수 없어요')).toBeVisible()
  expect(calls.count()).toBe(0)
})

test('AI 답 안 대화 링크는 같은 탭에서 그 대화를 열고, 외부 링크는 새 탭 링크다', async ({ authenticatedPage: page }) => {
  await mockSession(page, ID, turn('지난번 고양이 얘기 찾아 줘', `[고양이 사진 정리](/?chat=${OTHER}) 에서 얘기했어요. [참고](https://example.com)`))
  await mockSession(page, OTHER, turn('고양이 사진 어디 둘까', '사진/고양이 폴더에 모으세요'))
  await page.goto(`/?chat=${ID}`)
  const panel = page.getByTestId('chat-panel')
  const internal = panel.getByTestId('markdown-internal-link')
  await expect(internal).toHaveText('고양이 사진 정리')
  await expect(internal).not.toHaveAttribute('target', '_blank')
  await expect(panel.getByRole('link', { name: '참고' })).toHaveAttribute('target', '_blank')

  const pagesBefore = page.context().pages().length
  await internal.click()
  await expect(panel).toContainText('사진/고양이 폴더에 모으세요')
  expect(page.context().pages()).toHaveLength(pagesBefore)
  await expect(page).not.toHaveURL(/chat=/)
})

test('검색 도구 단계는 "메모리 찾기"·"지난 대화 찾기"로 보인다', async ({ authenticatedPage: page }) => {
  await mockHomeChatGeneration(page, {
    frames: [
      { event: 'tool', data: { seq: 1, phase: 'start', toolName: 'search_memory', args: { query: '고양이' } } },
      { event: 'tool', data: { seq: 1, phase: 'result', toolName: 'search_memory', isError: false } },
      { event: 'tool', data: { seq: 2, phase: 'start', toolName: 'search_conversations', args: { query: '고양이' } } },
      { event: 'tool', data: { seq: 2, phase: 'result', toolName: 'search_conversations', isError: false } },
      { event: 'delta', data: { text: '찾았어요.' } },
      { event: 'done', data: { sessionId: 's-search-1' } },
    ],
  })
  await page.goto('/')
  await page.getByTestId('chat-launcher').click()
  await page.getByTestId('chat-input').fill('지난번 고양이 얘기')
  await page.getByRole('button', { name: '보내기' }).click()
  await expect(page.getByTestId('tool-step-tool')).toHaveCount(2)
  await expect(page.getByTestId('tool-step-tool').nth(0)).toContainText('메모리 찾기')
  await expect(page.getByTestId('tool-step-tool').nth(1)).toContainText('지난 대화 찾기')
})
