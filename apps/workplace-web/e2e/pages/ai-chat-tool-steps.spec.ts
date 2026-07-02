import { expect, test } from '../fixtures/auth.fixture'
import { mockApi } from '../fixtures/api-mock'
import { mockHomeChatGeneration } from '../fixtures/home-chat-mock'
import type { HomeMessage, HomeSessionPage } from '../../src/types/home'

// ai-chat-tool-steps.spec.ts — 도구 호출 인라인 표시 E2E.
// compose 이벤트(tool/progress)는 이제 POST /api/v1/ai/chat 응답이 아니라 통합 /api/v1/events
// 채널로 home.chat.* 이름으로 도착한다(#593 편입). ToolStepList 렌더·상태 전이·필터·복원을 검증.
// mockHomeChatGeneration(POST 는 { correlationId } 즉시 반환 + /events 가 그 correlationId 로
// 프레임을 흘림)을 그대로 사용. route.fulfill 은 본문을 한 방에 전달하므로 프레임 간 별도 렌더(점진
// 표시)는 검증하지 않는다(wiki-ai.spec.ts 와 동일한 SSE 모킹 한계) — 이 파일의 케이스들은 최종
// 정착 상태(done 이후 상태 전이)만 단언하므로 이 한계의 영향을 받지 않는다.

// ── 케이스 1: 라이브 중첩 렌더 + 상태 전이(성공) ────────────────────────────

test('도구 호출이 인라인으로 중첩 렌더되고 상태가 done(✓) 으로 전이된다', async ({
  authenticatedPage: page,
}) => {
  // compose 이벤트: progress(위임) → tool start → tool result(success) → delta → done
  await mockHomeChatGeneration(page, {
    frames: [
      { event: 'progress', data: { label: '이슈 전문가에게 위임 중' } },
      {
        event: 'tool',
        data: { seq: 1, phase: 'start', toolName: 'update_status', args: { issueKey: 'EX-2', status: '진행중' } },
      },
      { event: 'tool', data: { seq: 1, phase: 'result', toolName: 'update_status', isError: false } },
      { event: 'delta', data: { text: '상태를 변경했어요.' } },
      { event: 'done', data: { sessionId: 's-tool-1' } },
    ],
  })

  await page.goto('/')
  await page.getByTestId('chat-launcher').click()
  await page.getByTestId('chat-input').fill('EX-2 진행중으로 바꿔줘')
  await page.getByRole('button', { name: '보내기' }).click()

  // 위임 헤더가 라벨과 함께 렌더된다.
  await expect(page.getByTestId('tool-step-delegation')).toContainText('이슈 전문가에게 위임 중')

  // 도구 행: 한국어 라벨 + 이슈키 + 완료 상태
  const toolRow = page.getByTestId('tool-step-tool')
  await expect(toolRow).toContainText('상태 변경')
  await expect(toolRow).toContainText('EX-2')
  // result 이벤트 후 상태가 done(✓) 으로 전이
  await expect(toolRow).toContainText('✓')

  // 최종 delta 텍스트가 말풍선에 렌더된다.
  await expect(page.getByTestId('chat-panel')).toContainText('상태를 변경했어요.')

  // 회귀(#449): 최종 응답(delta) 도착 후에도 도구 행/위임 헤더가 사라지지 않고 잔존한다.
  // delta 핸들러가 turn 을 교체할 때 steps 를 보존해야 한다(과거 ...last 누락으로 done 순간 증발).
  await expect(page.getByTestId('tool-step-delegation')).toBeVisible()
  await expect(toolRow).toBeVisible()
  await expect(toolRow).toContainText('상태 변경')
  await expect(toolRow).toContainText('✓')
})

// ── 케이스 2: 오류 상태(✗ 실패) ─────────────────────────────────────────────

test('tool result isError:true 이면 도구 행이 오류(✗ 실패) 상태로 렌더된다', async ({
  authenticatedPage: page,
}) => {
  await mockHomeChatGeneration(page, {
    frames: [
      { event: 'tool', data: { seq: 2, phase: 'start', toolName: 'get_issue_detail', args: { issueKey: 'XX-99' } } },
      { event: 'tool', data: { seq: 2, phase: 'result', toolName: 'get_issue_detail', isError: true } },
      { event: 'delta', data: { text: '조회에 실패했어요.' } },
      { event: 'done', data: { sessionId: 's-tool-err' } },
    ],
  })

  await page.goto('/')
  await page.getByTestId('chat-launcher').click()
  await page.getByTestId('chat-input').fill('XX-99 조회해줘')
  await page.getByRole('button', { name: '보내기' }).click()

  // 도구 행이 오류 상태로 표시
  const toolRow = page.getByTestId('tool-step-tool')
  await expect(toolRow).toContainText('이슈 상세 조회')
  await expect(toolRow).toContainText('✗')
})

// ── 케이스 3: 필터 — 숨김 도구는 tool-step-tool 행을 생성하지 않는다 ─────────

test('숨김 도구(show_*/respond_chat) 의 tool 이벤트는 tool-step-tool 행을 렌더하지 않는다', async ({
  authenticatedPage: page,
}) => {
  // show_issue_list 와 respond_chat 은 필터링 대상; 표시 가능한 add_comment 만 행을 생성해야 함.
  await mockHomeChatGeneration(page, {
    frames: [
      { event: 'tool', data: { seq: 3, phase: 'start', toolName: 'show_issue_list', args: {} } },
      { event: 'tool', data: { seq: 3, phase: 'result', toolName: 'show_issue_list', isError: false } },
      { event: 'tool', data: { seq: 4, phase: 'start', toolName: 'respond_chat', args: {} } },
      { event: 'tool', data: { seq: 4, phase: 'result', toolName: 'respond_chat', isError: false } },
      { event: 'tool', data: { seq: 5, phase: 'start', toolName: 'add_comment', args: { issueKey: 'EX-3' } } },
      { event: 'tool', data: { seq: 5, phase: 'result', toolName: 'add_comment', isError: false } },
      { event: 'delta', data: { text: '처리했어요.' } },
      { event: 'done', data: { sessionId: 's-tool-filter' } },
    ],
  })

  await page.goto('/')
  await page.getByTestId('chat-launcher').click()
  await page.getByTestId('chat-input').fill('이슈 목록 보여줘')
  await page.getByRole('button', { name: '보내기' }).click()

  // tool-step-list 가 렌더된 후 검증 (add_comment 행 기다림)
  await expect(page.getByTestId('tool-step-list')).toBeVisible()
  const toolRows = page.getByTestId('tool-step-tool')
  // show_issue_list/respond_chat 은 숨겨지고 add_comment 만 표시
  await expect(toolRows).toHaveCount(1)
  await expect(toolRows.first()).toContainText('코멘트 작성')
})

// ── 케이스 4: 복원 — 세션 메시지 toolCalls 가 ToolStepList 로 렌더된다 ────────

test('세션 복원 시 toolCalls 가 ToolStepList(위임+도구 행) 로 렌더된다', async ({
  authenticatedPage: page,
}) => {
  // 세션 목록 모킹
  const sessions: HomeSessionPage = {
    items: [{ id: 's-restore-1', title: '복원 대화', lastMessageAt: '2026-06-22T00:00:00Z', widgetCount: 0 }],
    nextCursor: null,
  }
  await mockApi(page, 'GET', '/api/v1/home/sessions', sessions)

  // 세션 메시지: ASSISTANT 응답에 toolCalls(위임 + 완료된 도구 단계) 포함
  const messages: HomeMessage[] = [
    {
      id: 1,
      role: 'USER',
      content: '이슈 EX-5 상태 변경해줘',
      widgets: null,
      toolCalls: null,
      createdAt: '2026-06-22T00:00:00Z',
    },
    {
      id: 2,
      role: 'ASSISTANT',
      content: '상태를 완료로 변경했어요.',
      widgets: null,
      toolCalls: [
        { kind: 'delegation', label: '이슈 전문가에게 위임 중' },
        { kind: 'tool', seq: 1, toolName: 'update_status', args: { issueKey: 'EX-5', status: '완료' }, status: 'done' },
      ],
      createdAt: '2026-06-22T00:00:01Z',
    },
  ]
  await mockApi(page, 'GET', '/api/v1/home/sessions/s-restore-1/messages', messages)

  await page.goto('/')
  // fullscreen 으로 전환 (두 번 클릭)
  await page.getByTestId('chat-launcher').click()
  await page.getByTestId('chat-launcher').click()
  await expect(page.getByTestId('ai-fullscreen')).toBeVisible()

  // 세션 선택
  await page.getByTestId('ai-fs-sessions').getByTestId('chat-session-select').first().click()

  // ASSISTANT 턴에 ToolStepList 가 렌더된다.
  const chatPanel = page.getByTestId('chat-panel')
  await expect(chatPanel.getByTestId('tool-step-list')).toBeVisible()

  // 위임 헤더
  await expect(chatPanel.getByTestId('tool-step-delegation')).toContainText('이슈 전문가에게 위임 중')

  // 도구 행: 완료 상태
  const toolRow = chatPanel.getByTestId('tool-step-tool')
  await expect(toolRow).toContainText('상태 변경')
  await expect(toolRow).toContainText('EX-5')
  await expect(toolRow).toContainText('✓')

  // 텍스트 응답도 렌더된다.
  await expect(chatPanel).toContainText('상태를 완료로 변경했어요.')
})
