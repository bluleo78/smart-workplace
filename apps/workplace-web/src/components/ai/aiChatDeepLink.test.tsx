// AI 대화 딥링크(WP-384)·전송 앱(WP-379) — 페이지 테스트(WP-971).
// 없는 대화 토스트, 답 안 대화 링크(같은 탭·외부 새 탭), 첫 30개 밖 대화 제목, 다른 쿼리·히스토리 보존, 전체 화면에서 화면 링크 → 사이드·뒤로 가기,
// 이슈 상세에서 보낸 요청의 app 필드는 브라우저 없이 판정되므로 e2e/pages/ai-chat-deep-link.spec.ts·ai-memory-app.spec.ts 에서 옮겼다.
// 딥링크 대표 배선(@wiring)과 단계 줄 정렬(@layout)은 E2E 에 남는다.
// renderPage 인 이유: 딥링크 처리(AiChatDeepLink)·사이드 패널·전체 화면·AI 칩이 모두 앱 셸(AppLayout)에 있고, 화면 링크로 다른 라우트로 옮겨 간다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { beforeEach, expect, test } from 'vitest'

import { chatStreams } from '@/lib/ai/chatStreams'
import { issueDetailHandlers } from '@/test/kits/projects/issueDetailStubs'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import type { HomeMessage } from '@/types/home'

const API = '/api/v1'
const ID = '3f1c2a4e-8b7d-4c1e-9f2a-6d5b4c3a2e1f'
const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'

/** 질문·답 한 턴 이력. */
function turn(question: string, answer: string): HomeMessage[] {
  return [
    { id: 1, role: 'USER', content: question, widgets: null, toolCalls: null, createdAt: '2026-10-10T00:00:00Z' },
    { id: 2, role: 'ASSISTANT', content: answer, widgets: null, toolCalls: null, createdAt: '2026-10-10T00:00:01Z' },
  ]
}

/** 대화 하나의 이력·제안. */
function session(id: string, messages: HomeMessage[]): RequestHandler[] {
  return [
    http.get(`${API}/home/sessions/${id}/messages`, () => HttpResponse.json(messages)),
    http.get(`${API}/home/sessions/${id}/proposals`, () => HttpResponse.json([])),
  ]
}

// 홈(/) 대시보드가 데스크톱에서도 부르는 푸시 설정 — 화면 본문은 이 테스트의 관심사가 아니다.
const homeExtras = [http.get(`${API}/push/config`, () => HttpResponse.json({ enabled: false, vapidPublicKey: null }))]

beforeEach(() => {
  // 대화 저장소는 모듈 싱글턴 — 앞 테스트에서 연 대화가 남아 있으면 딥링크가 그 이력을 그대로 보여 준다.
  chatStreams.setOwner(null)
})

const panelText = async (text: string) =>
  expect(await within(await screen.findByTestId('chat-panel', {}, { timeout: PAGE_LOAD_TIMEOUT })).findByText(text, {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()

test('없거나 남의 대화면 "대화를 찾을 수 없어요" 토스트를 띄우고 파라미터를 지운다', async () => {
  const { location } = renderPage(`/?aiChat=${ID}`, {
    handlers: [
      ...homeExtras,
      http.get(`${API}/home/sessions/${ID}/messages`, () => HttpResponse.json({ status: 404, message: '대화를 찾을 수 없습니다' }, { status: 404 })),
      http.get(`${API}/home/sessions/${ID}/proposals`, () => HttpResponse.json([])),
    ],
  })
  expect(await screen.findByText('대화를 찾을 수 없어요', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
  expect(location()).not.toMatch(/aiChat=/)
})

// AI 답 안 내부 링크는 라우터로(같은 탭) 다른 대화를 열고, 외부 링크만 새 탭 링크다.
test('AI 답 안 대화 링크는 같은 탭에서 그 대화를 열고, 외부 링크는 새 탭 링크다', async () => {
  const { user, location } = renderPage(`/?aiChat=${ID}`, {
    handlers: [
      ...homeExtras,
      ...session(ID, turn('지난번 고양이 얘기 찾아 줘', `[고양이 사진 정리](/?aiChat=${OTHER}) 에서 얘기했어요. [참고](https://example.com)`)),
      ...session(OTHER, turn('고양이 사진 어디 둘까', '사진/고양이 폴더에 모으세요')),
    ],
  })
  const internal = await screen.findByTestId('markdown-internal-link', {}, { timeout: PAGE_LOAD_TIMEOUT })
  const panel = screen.getByTestId('chat-panel')
  expect(internal).toHaveTextContent('고양이 사진 정리')
  expect(internal).not.toHaveAttribute('target', '_blank')
  expect(within(panel).getByRole('link', { name: '참고' })).toHaveAttribute('target', '_blank')

  await user.click(internal)
  await panelText('사진/고양이 폴더에 모으세요')
  expect(location()).not.toMatch(/aiChat=/)
})

// 딥링크로 연 대화는 세션 목록(첫 30개)에 없어도 헤더 제목이 첫 질문으로 보인다(규칙 자체는 aiChatLink.test.ts).
test('딥링크로 연 대화가 첫 30개 목록 밖이어도 헤더에 그 대화 제목(첫 질문)이 보인다', async () => {
  renderPage(`/?aiChat=${ID}`, {
    handlers: [...homeExtras, ...session(ID, turn('지난번 고양이 사진 얘기 찾아 줘', '사진/고양이 폴더에 모으기로 했어요.'))],
  })
  await panelText('사진/고양이 폴더에 모으기로 했어요.')
  await waitFor(() => expect(screen.getByTestId('chat-session-title')).toHaveTextContent('지난번 고양이 사진 얘기 찾아 줘'))
})

// 대화 링크는 지금 화면에 머문 채 aiChat 만 더해 replace 한다 — 다른 쿼리를 지우거나 히스토리 항목을 늘리지 않는다.
test('대화 링크는 지금 화면의 다른 쿼리를 지우지 않고 히스토리를 늘리지 않는다', async () => {
  const { user, location } = renderPage(`/settings/profile?keep=1&aiChat=${ID}`, {
    handlers: [
      ...session(ID, turn('지난번 고양이 얘기 찾아 줘', `[고양이 사진 정리](/?aiChat=${OTHER}) 에서 얘기했어요.`)),
      ...session(OTHER, turn('고양이 사진 어디 둘까', '사진/고양이 폴더에 모으세요')),
    ],
  })
  const link = await screen.findByTestId('markdown-internal-link', {}, { timeout: PAGE_LOAD_TIMEOUT })
  await waitFor(() => expect(location()).toBe('/settings/profile?keep=1'))
  const before = window.history.length
  await user.click(link)
  await panelText('사진/고양이 폴더에 모으세요')
  await waitFor(() => expect(location()).toBe('/settings/profile?keep=1'))
  expect(window.history.length).toBe(before)
})

// 전체 화면은 본문을 덮으므로 답 안 화면 링크를 누르면 사이드로 내려 그 화면을 보인다. 뒤로 가면 전체 화면 항목으로 돌아온다(WP-209 히스토리 표식).
test('전체 화면에서 답 안 화면 링크를 누르면 사이드로 내려 그 화면이 보인다 — 뒤로 가면 전체 화면으로 돌아온다', async () => {
  const { user, location } = renderPage(`/?aiChat=${ID}`, {
    handlers: [...homeExtras, ...session(ID, turn('프로필 어디서 바꿔', '[프로필 설정](/settings/profile) 에서 바꿀 수 있어요.'))],
  })
  expect(await screen.findByTestId('ai-side-panel', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
  await user.click(screen.getByTestId('chat-launcher')) // side → fullscreen
  const fs = await screen.findByTestId('ai-fullscreen')
  await user.click(await within(fs).findByTestId('markdown-internal-link'))
  await waitFor(() => expect(location()).toBe('/settings/profile'))
  expect(screen.queryByTestId('ai-fullscreen')).not.toBeInTheDocument()
  expect(screen.getByTestId('ai-side-panel')).toBeInTheDocument()
  window.history.back()
  await waitFor(() => expect(location()).toBe('/'))
  expect(await screen.findByTestId('ai-fullscreen')).toBeInTheDocument()
})

// WP-379: 요청에 지금 화면 앱(app)을 화면 참고(screenContext)와 별도 필드로 싣는다 — 화면 참고 안에는 app 이 없다.
test('이슈 상세에서 보내면 app 은 ISSUE 이고 화면 참고에는 app 이 실리지 않는다', async () => {
  const bodies: Record<string, unknown>[] = []
  const { user } = renderPage('/projects/WP/issues/12', {
    handlers: [
      http.post(`${API}/ai/chat`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown> & { correlationId: string }
        bodies.push(body)
        return HttpResponse.json({ correlationId: body.correlationId })
      }),
      ...issueDetailHandlers({ number: 12 }),
    ],
  })
  await screen.findByTestId('issue-title-heading', {}, { timeout: PAGE_LOAD_TIMEOUT })
  await user.click(screen.getByTestId('chat-launcher'))
  expect(await screen.findByTestId('chat-context-chip')).toBeInTheDocument()
  await user.type(screen.getByTestId('chat-input'), '이거 요약해줘')
  await user.click(screen.getByRole('button', { name: '보내기' }))
  await waitFor(() => expect(bodies).toHaveLength(1))
  expect(bodies[0].app).toBe('ISSUE')
  expect(bodies[0].screenContext).toBeDefined()
  expect(bodies[0].screenContext).not.toHaveProperty('app')
})
