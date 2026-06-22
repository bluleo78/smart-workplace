import { expect, test } from '../fixtures/auth.fixture'
import { mockApi } from '../fixtures/api-mock'
import type { HomeMessage, HomeSessionPage } from '../../src/types/home'

// ai-chat-tool-steps.spec.ts — 도구 호출 인라인 표시 E2E.
// compose SSE 에 tool/progress 이벤트를 포함해 ToolStepList 렌더·상태 전이·필터·복원을 검증.

// ── SSE 모킹 헬퍼 ────────────────────────────────────────────────────────────

/**
 * ReadableStream 으로 SSE 청크를 타임 분리하여 compose 요청을 가로챈다.
 * route.fulfill 은 body 를 한 번에 flush 하므로 progress → tool 이벤트 렌더 순서가
 * 보장되지 않을 수 있다. addInitScript 로 fetch 를 패치해 macrotask 경계를 삽입한다.
 */
function mockComposeSse(chunks: string[]) {
  return (page: Parameters<typeof mockApi>[0]) =>
    page.addInitScript((sseChunks: string[]) => {
      const originalFetch = window.fetch.bind(window)
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : (input as Request).url
        if (!url.includes('/api/v1/ai/chat') || (init?.method ?? 'GET') !== 'POST') {
          return originalFetch(input, init)
        }
        const enc = new TextEncoder()
        const stream = new ReadableStream({
          async start(controller) {
            for (const chunk of sseChunks) {
              controller.enqueue(enc.encode(chunk))
              // macrotask 경계 삽입 → 청크별 React 렌더 사이클 보장
              await new Promise<void>((r) => setTimeout(r, 60))
            }
            controller.close()
          },
        })
        return new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      }
    }, chunks)
}

// ── 케이스 1: 라이브 중첩 렌더 + 상태 전이(성공) ────────────────────────────

test('도구 호출이 인라인으로 중첩 렌더되고 상태가 done(✓) 으로 전이된다', async ({
  authenticatedPage: page,
}) => {
  // compose SSE: progress(위임) → tool start → tool result(success) → delta → done
  const chunks = [
    'event: progress\ndata: {"label":"이슈 전문가에게 위임 중"}\n\n',
    'event: tool\ndata: {"seq":1,"phase":"start","toolName":"update_status","args":{"issueKey":"EX-2","status":"진행중"}}\n\n',
    'event: tool\ndata: {"seq":1,"phase":"result","toolName":"update_status","isError":false}\n\n',
    'event: delta\ndata: {"text":"상태를 변경했어요."}\n\n',
    'event: done\ndata: {"sessionId":"s-tool-1"}\n\n',
  ]
  await mockComposeSse(chunks)(page)

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
  const chunks = [
    'event: tool\ndata: {"seq":2,"phase":"start","toolName":"get_issue_detail","args":{"issueKey":"XX-99"}}\n\n',
    'event: tool\ndata: {"seq":2,"phase":"result","toolName":"get_issue_detail","isError":true}\n\n',
    'event: delta\ndata: {"text":"조회에 실패했어요."}\n\n',
    'event: done\ndata: {"sessionId":"s-tool-err"}\n\n',
  ]
  await mockComposeSse(chunks)(page)

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
  const chunks = [
    'event: tool\ndata: {"seq":3,"phase":"start","toolName":"show_issue_list","args":{}}\n\n',
    'event: tool\ndata: {"seq":3,"phase":"result","toolName":"show_issue_list","isError":false}\n\n',
    'event: tool\ndata: {"seq":4,"phase":"start","toolName":"respond_chat","args":{}}\n\n',
    'event: tool\ndata: {"seq":4,"phase":"result","toolName":"respond_chat","isError":false}\n\n',
    'event: tool\ndata: {"seq":5,"phase":"start","toolName":"add_comment","args":{"issueKey":"EX-3"}}\n\n',
    'event: tool\ndata: {"seq":5,"phase":"result","toolName":"add_comment","isError":false}\n\n',
    'event: delta\ndata: {"text":"처리했어요."}\n\n',
    'event: done\ndata: {"sessionId":"s-tool-filter"}\n\n',
  ]
  await mockComposeSse(chunks)(page)

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
