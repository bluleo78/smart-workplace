// 모바일 이슈 상세 AI 진행(WP-377·WP-1079) — 페이지 테스트(WP-981).
// 제목 아래 「AI 진행」 칸의 작업자 순서·상태(진행률 포함)·질문 전문·마지막 보고, 「답변 필요」 배지 → ?chat=1 드로워는
// 브라우저 없이 판정된다. 칸 위치·질문 잘림 없음(@layout)은 e2e/pages/mobile/issue-agent-work.spec.ts 에 남는다.
// 앱 셸을 보지 않으므로 이슈 상세 화면만 renderScreen 으로 띄운다(WP-1002).
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { renderMobileRoute } from '@/test/kits/mobile/mobileScreen'
import { mockViewport } from '@/test/viewport'

import { agentWorker as aki, humanWorker as human, twoWorks } from '../../../e2e/factories/agentWork.factory'
import { createChatThread } from '../../../e2e/factories/chat.factory'
import { createIssue, createIssueDetail } from '../../../e2e/factories/issue.factory'
import { createProject } from '../../../e2e/factories/project.factory'
import IssueDetailPage from '../projects/IssueDetailPage'

// 휴대폰 폭·터치 포인터 — 모바일 상세(칩 줄·여러 줄로 쌓은 AI 진행 칸)로 그려지게 한다.
mockViewport()

const BASE = '/api/v1/projects/WP/issues/12'
const QUESTION = '테스트 DB 를 공용으로 쓸까요, 이슈별로 따로 띄울까요?'

/** WP-12 상세에 두 작업자(아키 답변 필요 · 양동희 작업 중)를 싣는다 — E2E mockAgentWorkDetail 과 같은 응답. */
async function open() {
  const summary = createIssue({ number: 12, title: '로그인 버그 수정', status: 'IN_PROGRESS', priority: 'HIGH', assignees: [human, aki], agentWork: twoWorks(QUESTION) })
  const view = renderMobileRoute('/projects/:key/issues/:number', <IssueDetailPage />, {
    path: '/projects/WP/issues/12',
    handlers: [
      http.get('/api/v1/projects/WP', () => HttpResponse.json(createProject())),
      http.get(BASE, () => HttpResponse.json(createIssueDetail({ summary }))),
      http.get('/api/v1/projects/WP/issues', () => HttpResponse.json({ items: [], nextCursor: null, hasMore: false })),
      ...['watchers', 'labels', 'attachments', 'drive-links'].map((s) => http.get(`${BASE}/${s}`, () => HttpResponse.json([]))),
      http.get(`${BASE}/chat/thread`, () => HttpResponse.json(createChatThread({ threadId: 777, recentMessages: [] }))),
      http.get('/api/v1/chat/threads/777/messages', () => HttpResponse.json({ items: [], nextCursor: null, hasMore: false })),
      http.post('/api/v1/chat/threads/777/read', () => new HttpResponse(null, { status: 204 })),
      http.get(`/api/v1/issues/${summary.id}/comments`, () => HttpResponse.json([])),
    ],
  })
  await screen.findByTestId('agent-work-card')
  return view
}

// 작업자 서버 순서(아키 먼저), 데스크톱 레일 없음, 질문은 잘리지 않고 다 보이며 진행률은 배지에 합친다.
test('AI 진행 칸이 작업자별 상태·질문·진행·마지막 보고를 보인다', async () => {
  await open()
  const card = screen.getByTestId('agent-work-card')
  const akiRow = within(card).getByTestId('agent-work-9')
  const meRow = within(card).getByTestId('agent-work-1')
  expect(akiRow.compareDocumentPosition(meRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(screen.queryByTestId('property-rail')).not.toBeInTheDocument()
  expect(within(akiRow).getByTestId('agent-work-9-state')).toHaveTextContent('답변 필요')
  expect(akiRow).toHaveTextContent(QUESTION)
  expect(within(akiRow).getByText(QUESTION)).not.toHaveClass('line-clamp-2')
  expect(within(meRow).getByTestId('agent-work-1-state')).toHaveTextContent('작업 중 3/5')
  expect(within(meRow).getByTestId('agent-work-1-last')).toHaveTextContent('5분 전')
})

// 「답변 필요」 배지를 누르면 ?chat=1 로 이슈 챗 드로워가 열린다(옛 질문 카드 「채팅에서 답하기」 대체).
test('답변 필요 배지를 누르면 ?chat=1 로 이슈 챗 드로워가 열린다', async () => {
  const { user, location } = await open()
  await user.click(screen.getByTestId('agent-work-9-state'))
  await waitFor(() => expect(location()).toMatch(/[?&]chat=1/))
  expect(await screen.findByTestId('issue-chat-drawer')).toBeInTheDocument()
})
