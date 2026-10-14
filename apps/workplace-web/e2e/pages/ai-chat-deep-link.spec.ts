// WP-384 대화 딥링크(데스크톱) — /?chat=<id> 로 사이드 패널을 열고 대화를 복원한 뒤 파라미터를 지운다. 없는 대화는 토스트, 모양이 틀린 id 는
// 서버에 묻지 않는다. AI 답 안 내부 링크는 같은 탭(라우터)으로 다른 대화를 열고 외부 링크는 새 탭. 검색 도구 단계 라벨.
import type { Page } from '@playwright/test'

import { expect, test } from '../fixtures/auth.fixture'
import { mockApi } from '../fixtures/api-mock'
import { mockHomeChatGeneration } from '../fixtures/home-chat-mock'
import { trackRequests } from '../fixtures/requests'
import { stableBox } from '../fixtures/wait'
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

test('딥링크로 연 대화가 첫 30개 목록 밖이어도 헤더에 그 대화 제목(첫 질문)이 보인다', async ({ authenticatedPage: page }) => {
  await mockSession(page, ID, turn('지난번 고양이 사진 얘기 찾아 줘', `[고양이 사진 정리](/?chat=${OTHER}) 에서 얘기했어요.`))
  await mockSession(page, OTHER, turn('  고양이 사진은 어디에 모아 두면 좋을까? 폴더 이름도 같이 정해 줘  ', '사진/고양이 폴더에 모으세요'))
  await page.goto(`/?chat=${ID}`)
  const title = page.getByTestId('chat-session-title')
  await expect(title).toHaveText('지난번 고양이 사진 얘기 찾아 줘')
  // 답 안 대화 링크로 다른 대화를 열면 그 대화의 첫 질문(앞뒤 공백 없이 40자)으로 바뀐다 — 링크 글자가 아니다.
  await page.getByTestId('markdown-internal-link').click()
  await expect(page.getByTestId('chat-panel')).toContainText('사진/고양이 폴더에 모으세요')
  await expect(title).toHaveText('고양이 사진은 어디에 모아 두면 좋을까? 폴더 이름도 같이 정해 줘'.slice(0, 40))
})

test('대화 링크는 지금 화면의 다른 쿼리를 지우지 않고 히스토리를 늘리지 않는다', async ({ authenticatedPage: page }) => {
  await mockSession(page, ID, turn('지난번 고양이 얘기 찾아 줘', `[고양이 사진 정리](/?chat=${OTHER}) 에서 얘기했어요.`))
  await mockSession(page, OTHER, turn('고양이 사진 어디 둘까', '사진/고양이 폴더에 모으세요'))
  await page.goto(`/settings/profile?keep=1&chat=${ID}`)
  await expect(page.getByTestId('markdown-internal-link')).toBeVisible()
  await expect(page).toHaveURL(/\/settings\/profile\?keep=1$/)
  const before = await page.evaluate(() => history.length)
  await page.getByTestId('markdown-internal-link').click()
  await expect(page.getByTestId('chat-panel')).toContainText('사진/고양이 폴더에 모으세요')
  await expect(page).toHaveURL(/\/settings\/profile\?keep=1$/)
  expect(await page.evaluate(() => history.length)).toBe(before)
})

test('전체 화면에서 답 안 화면 링크를 누르면 사이드로 내려 그 화면이 보인다 — 뒤로 가면 전체 화면으로 돌아온다', async ({ authenticatedPage: page }) => {
  await mockSession(page, ID, turn('프로필 어디서 바꿔', '[프로필 설정](/settings/profile) 에서 바꿀 수 있어요.'))
  await page.goto(`/?chat=${ID}`)
  await expect(page.getByTestId('ai-side-panel')).toBeVisible()
  await page.getByTestId('chat-launcher').click() // side → fullscreen
  const fs = page.getByTestId('ai-fullscreen')
  await expect(fs).toBeVisible()
  await fs.getByTestId('markdown-internal-link').click()
  await expect(page).toHaveURL(/\/settings\/profile$/)
  await expect(fs).toHaveCount(0)
  await expect(page.getByTestId('ai-side-panel')).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByTestId('ai-fullscreen')).toBeVisible()
})

test('말풍선 안 단계 줄은 본문 왼쪽 선에 맞고 ✓ 는 라벨 바로 뒤에 붙는다', async ({ authenticatedPage: page }) => {
  // 본문이 길어 말풍선이 패널 폭까지 넓어진 경우 — 상태가 행 끝으로 밀리면 라벨과 멀어진다.
  const messages = turn('지난번 고양이 얘기 찾아 줘', '고양이 사진은 앨범에 모으기로 했어요. 폴더 이름은 사진/고양이로 정했고 매달 정리하기로 했습니다.')
  messages[1].toolCalls = [
    { kind: 'tool', seq: 1, toolName: 'search_conversations', args: { query: '고양이' }, status: 'done' },
  ]
  await mockSession(page, ID, messages)
  await page.goto(`/?chat=${ID}`)
  const row = page.getByTestId('tool-step-tool')
  await expect(row).toContainText('지난 대화 찾기')
  const body = await stableBox(page.getByTestId('chat-panel').getByTestId('markdown-content'))
  // 행의 첫 글자(아이콘)가 본문 왼쪽 선에 있다 — 위임 없이 부른 도구는 들여 쓰지 않는다.
  const icon = await stableBox(row.locator('span').first())
  expect(Math.abs(icon.x - body.x)).toBeLessThanOrEqual(1)
  const label = await stableBox(row.getByText('지난 대화 찾기'))
  const check = await stableBox(row.getByText('✓'))
  // 넓은 패널에서도 상태가 라벨 곁에 있다(행 끝으로 밀리지 않는다).
  expect(check.x).toBeGreaterThan(label.x + label.width)
  expect(check.x - (label.x + label.width)).toBeLessThan(120)
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
