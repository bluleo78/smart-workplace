// 작업 화면 창(WP-1277) — 가짜 소켓으로 서버 프레임을 넣어 「입력 허용」 단추가 실행 환경 허용·연결 상태에 따라 보이는지,
// 세션을 못 열거나 끊기면 이유와 「다시 연결」이 뜨는지 본다. 터미널(xterm)은 jsdom 에서 그릴 수 없어 빈 가짜로 바꾼다.
import { act, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test, vi } from 'vitest'

import { renderScreen } from '@/test/renderScreen'

import { AgentScreenDialog } from './AgentScreenDialog'

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 100
    rows = 30
    options = {}
    open() {}
    write() {}
    focus() {}
    dispose() {}
    loadAddon() {}
    onData() {
      return { dispose() {} }
    }
  },
}))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} dispose() {} } }))

/** 브라우저 WebSocket 대신 — 테스트가 서버 프레임을 넣고, 보낸 프레임을 읽는다. */
class FakeSocket {
  static last: FakeSocket | null = null
  readyState = 1
  binaryType = 'blob'
  sent: unknown[] = []
  onmessage: ((e: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  readonly url: string
  constructor(url: string) {
    this.url = url
    FakeSocket.last = this
  }
  send(d: unknown) {
    this.sent.push(d)
  }
  close() {}
  frame(o: unknown) {
    act(() => this.onmessage?.({ data: JSON.stringify(o) }))
  }
}

const session = http.post('/api/v1/admin/agents/100/screen-sessions', () =>
  HttpResponse.json({ sessionId: 's-1', ticket: 'tk 1', expiresAt: '2026-11-03T00:00:30Z' }, { status: 201 }),
)

function open(handlers = [session]) {
  FakeSocket.last = null
  return renderScreen(
    <AgentScreenDialog agentUserId={100} agentName="Kodi" open onOpenChange={() => {}} openSocket={(url) => new FakeSocket(url) as unknown as WebSocket} />,
    { handlers },
  )
}

async function socket() {
  await vi.waitFor(() => expect(FakeSocket.last).not.toBeNull())
  return FakeSocket.last!
}

describe('AgentScreenDialog', () => {
  test('opens the socket with the one-time ticket only (no JWT) and shows connecting → attached view-only', async () => {
    open()
    const ws = await socket()
    expect(ws.url).toBe(`ws://${window.location.host}/api/v1/admin/agent-screen?ticket=tk%201`)
    expect(screen.getByTestId('agent-screen-phase')).toHaveTextContent('연결 중')
    ws.frame({ type: 'status', state: 'attached' })
    ws.frame({ type: 'input', enabled: false, allowed: true })
    expect(screen.getByTestId('agent-screen-phase')).toHaveTextContent('연결됨')
    expect(screen.getByTestId('agent-screen-mode')).toHaveTextContent('보기 전용')
    expect(screen.getByTestId('agent-screen-input-on')).toBeInTheDocument()
  })

  test('hides 입력 허용 when the location does not allow input (and for an old runner without the flag)', async () => {
    open()
    const ws = await socket()
    ws.frame({ type: 'status', state: 'attached' })
    ws.frame({ type: 'input', enabled: false, allowed: false })
    expect(screen.queryByTestId('agent-screen-input-on')).not.toBeInTheDocument()
    ws.frame({ type: 'input', enabled: false })
    expect(screen.queryByTestId('agent-screen-input-on')).not.toBeInTheDocument()
  })

  test('input band appears only after the server confirms input, and asks before sending', async () => {
    const { user } = open()
    const ws = await socket()
    ws.frame({ type: 'status', state: 'attached' })
    ws.frame({ type: 'input', enabled: false, allowed: true })
    await user.click(screen.getByTestId('agent-screen-input-on'))
    expect(await screen.findByTestId('agent-screen-input-confirm')).toHaveTextContent('AI 의 비밀값에 닿을 수 있습니다')
    await user.click(screen.getByRole('button', { name: '입력 허용' }))
    expect(ws.sent).toContainEqual(JSON.stringify({ type: 'input', enabled: true }))
    // 서버가 아직 켜지 않았다 — 띠 없음
    expect(screen.queryByTestId('agent-screen-input-band')).not.toBeInTheDocument()
    ws.frame({ type: 'input', enabled: true, allowed: true })
    expect(screen.getByTestId('agent-screen-input-band')).toHaveTextContent('입력 중 — 치는 키가 AI 화면에 그대로 갑니다.')
    ws.frame({ type: 'error', message: '다른 관리자가 이미 입력 중이에요' })
    expect(screen.getByRole('alert')).toHaveTextContent('다른 관리자가 이미 입력 중이에요')
  })

  test('shows the server reason when the session cannot open', async () => {
    open([
      http.post('/api/v1/admin/agents/100/screen-sessions', () => HttpResponse.json({ message: '실행 중인 AI 만 작업 화면을 볼 수 있어요' }, { status: 409 })),
    ])
    expect(await screen.findByTestId('agent-screen-ended')).toHaveTextContent('실행 중인 AI 만 작업 화면을 볼 수 있어요')
  })

  test('shows the reason when the screen ends and 다시 연결 opens a new session', async () => {
    const { user } = open()
    const ws = await socket()
    ws.frame({ type: 'status', state: 'ended', reason: 'AI 작업 공간이 떠 있지 않아요' })
    expect(screen.getByTestId('agent-screen-ended')).toHaveTextContent('AI 작업 공간이 떠 있지 않아요')
    FakeSocket.last = null
    await user.click(screen.getByRole('button', { name: '다시 연결' }))
    expect(await socket()).not.toBe(ws)
    expect(screen.getByTestId('agent-screen-phase')).toHaveTextContent('연결 중')
  })
})
