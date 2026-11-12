// AI 도움말 답 표식 렌더(WP-1511) — 출처·그림·창 단추·보강 칩·접힌 근거·바닥줄과, 켜지 않은 호출자·사용자 말풍선이 그대로인지 본다.
// 눌렀을 때의 동작(HelpAnswerActions)은 mock 이다 — 실제 구현은 useHelpAnswerActions 가 맡는다.
import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AIAssistantProvider } from '@/components/ai/AIAssistantContext'
import { AIChatPanel } from '@/components/ai/AIChatPanel'
import { MarkdownMessage } from '@/components/ai/MarkdownMessage'
import { AiScreenContextProvider } from '@/components/ai/screen-context/AiScreenContextProvider'
import type { HelpChapter, HelpIndexChapter } from '@/components/help/helpBundle'
import { ChatSessionProvider } from '@/hooks/ChatSessionContext'
import { useAssistantChat } from '@/hooks/useAssistantChat'
import { chatStreams } from '@/lib/ai/chatStreams'
import { emitAiStreamEvent } from '@/lib/aiEventBus'
import { shellHandlers } from '@/test/msw/baseHandlers'
import { renderScreen } from '@/test/renderScreen'

import type { HelpAnswerActions } from './helpAnswerContext'

const FIGURE = { id: '15-repo-token', src: 'figures/15-repo-token.png', alt: '토큰 칸 창', marks: [] }

/** 목차 — 일반 구성원 장(agents-member)과 관리자 장(agents-admin). */
const index: HelpIndexChapter[] = [
  {
    chapter: 'agents-member', number: 15, title: '에이전트', routes: [], audience: ['member'],
    sections: [{ id: 'agent.run.repo.token', label: '토큰', title: '토큰을 넣는다', parent: null, level: 2 }],
  },
  {
    chapter: 'agents-admin', number: 16, title: '관리', routes: [], audience: ['admin'],
    sections: [{ id: 'admin.only', label: '관리자 전용', title: '관리자 전용', parent: null, level: 2 }],
  },
]
const chapters: Record<string, HelpChapter> = {
  'agents-member': {
    ...index[0],
    sections: [{ ...index[0].sections[0], markdown: '본문', figures: [FIGURE], links: [] }],
  },
  'agents-admin': {
    ...index[1],
    sections: [{ ...index[1].sections[0], markdown: '본문', figures: [{ ...FIGURE, id: 'admin-fig', src: 'figures/admin-fig.png', alt: '관리자 그림' }], links: [] }],
  },
}
const bundle = [
  http.get('/help/manual-index.json', () => HttpResponse.json(index)),
  http.get('/help/manual/:file', ({ params }) => {
    const ch = chapters[String(params.file).replace(/\.json$/, '')]
    return ch ? HttpResponse.json(ch) : new HttpResponse(null, { status: 404 })
  }),
]

let actions: HelpAnswerActions
beforeEach(() => {
  actions = { openHelpSection: vi.fn(), focusScreenControl: vi.fn(), openDialog: vi.fn(() => 'opened' as const) }
})

/** 도움말 답으로 그린다(helpAnswer 켬). */
function renderAnswer(md: string, opts: { admin?: boolean; helpAnswer?: boolean } = {}) {
  return renderScreen(
    <MarkdownMessage helpAnswer={opts.helpAnswer === false ? undefined : { actions }}>{md}</MarkdownMessage>,
    { handlers: bundle, auth: { isAdmin: opts.admin ?? false } },
  )
}

const FULL =
  '**토큰** 칸에 붙여 넣습니다.\n\n![창](figure:15-repo-token)\n\n[열기](dialog:agent.run.repo.token)\n\n[도움말 · 토큰](help:agent.run.repo.token) [매뉴얼 보강](manual-gap:)'

describe('AI 도움말 답 렌더', () => {
  it('출처·그림·창 단추·보강 칩을 그린다', async () => {
    const { user } = renderAnswer(FULL)
    const source = await screen.findByRole('button', { name: '도움말 · 토큰' })
    expect(screen.getByRole('button', { name: '저장소 토큰 넣기 창 열기' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /크게 보기/ })).toBeInTheDocument()
    expect(screen.getByText('매뉴얼에 없음')).toBeInTheDocument()
    await user.click(source)
    expect(actions.openHelpSection).toHaveBeenCalledWith('agent.run.repo.token')
  })

  it('출처 문구는 AI 가 쓴 글이 아니라 「도움말 · 절 이름」 이다(본문 링크·바닥줄 모두)', async () => {
    renderAnswer('[엉뚱한 글](help:agent.run.repo.token) 를 보세요.\n\n본문 끝.\n\n[도움말 · 엉뚱한 이름](help:agent.run.repo.token)')
    const footer = await screen.findByTestId('help-answer-footer')
    await waitFor(() => expect(within(footer).getByRole('button', { name: '도움말 · 토큰' })).toBeInTheDocument())
    expect(screen.getAllByRole('button', { name: '도움말 · 토큰' })).toHaveLength(2)
    expect(screen.queryByText('엉뚱한 글')).toBeNull()
    expect(screen.queryByText('도움말 · 엉뚱한 이름')).toBeNull()
  })

  it('절을 못 찾는 출처는 AI 가 쓴 글을 그대로 글자로', async () => {
    renderAnswer('끝.\n\n[도움말 · 모르는 칸](help:nope.nope)')
    await waitFor(() => expect(screen.getByTestId('help-answer-footer')).toHaveTextContent('도움말 · 모르는 칸'))
    expect(screen.queryByRole('button', { name: '도움말 · 모르는 칸' })).toBeNull()
  })

  it('끝 문단의 출처·칩은 바닥줄(구분선 아래 한 줄)로 모인다', async () => {
    renderAnswer(FULL)
    const footer = await screen.findByTestId('help-answer-footer')
    expect(within(footer).getByText('매뉴얼에 없음')).toBeInTheDocument()
    expect(footer).toHaveClass('border-t')
    await waitFor(() => expect(within(footer).getByRole('button', { name: '도움말 · 토큰' })).toBeInTheDocument())
  })

  it('그림은 작게(최대 240px) 그린다', async () => {
    renderAnswer(FULL)
    expect(await screen.findByRole('button', { name: /크게 보기/ })).toHaveClass('max-w-[240px]')
  })

  it('창 단추 글은 AI 링크 글이 아니라 목록 라벨이다', () => {
    renderAnswer('[지금 바로 삭제](dialog:agent.run.account)')
    expect(screen.getByRole('button', { name: 'AI 계정 연결 창 열기' })).toBeInTheDocument()
    expect(screen.queryByText('지금 바로 삭제')).toBeNull()
  })

  it('허용 목록 밖 dialog: 는 그리지 않는다', () => {
    renderAnswer('[열기](dialog:agent.danger) [열기](dialog:toString)')
    expect(screen.queryByRole('button', { name: /창 열기/ })).toBeNull()
  })

  it('대문자 DIALOG: 는 표식이 아니라 단추가 되지 않는다', () => {
    renderAnswer('[열기](DIALOG:agent.run.account)')
    expect(screen.queryByRole('button', { name: /창 열기/ })).toBeNull()
  })

  it('누른 결과가 missing 이면 단추 아래에 안내를 보인다', async () => {
    actions.openDialog = vi.fn(() => 'missing' as const)
    const { user } = renderAnswer('[열기](dialog:agent.run.account)')
    await user.click(screen.getByRole('button', { name: 'AI 계정 연결 창 열기' }))
    expect(screen.getByText('이 화면에서는 열 수 없어요')).toBeInTheDocument()
    expect(actions.openDialog).toHaveBeenCalledWith('agent.run.account')
  })

  it('opened 면 안내가 없다', async () => {
    const { user } = renderAnswer('[열기](dialog:agent.run.account)')
    await user.click(screen.getByRole('button', { name: 'AI 계정 연결 창 열기' }))
    expect(screen.queryByText('이 화면에서는 열 수 없어요')).toBeNull()
  })

  it('없는 그림 id 는 alt 글', async () => {
    renderAnswer('![없는 그림](figure:nope)\n\n[도움말 · 토큰](help:agent.run.repo.token)')
    expect(await screen.findByText('없는 그림')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /크게 보기/ })).toBeNull()
  })

  it('출처가 없으면 그림도 alt 글', async () => {
    renderAnswer('![창](figure:15-repo-token)')
    expect(await screen.findByText('창')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /크게 보기/ })).toBeNull()
  })

  it('그림 둘이면 첫 그림만', async () => {
    renderAnswer('![첫째](figure:15-repo-token) ![둘째 글](figure:nope)\n\n[도움말 · 토큰](help:agent.run.repo.token)')
    expect(await screen.findAllByRole('button', { name: /크게 보기/ })).toHaveLength(1)
    expect(screen.queryByText('둘째 글')).toBeNull()
  })

  it('관리자 장 출처는 일반 구성원에게 글로만, 그 장 그림도 alt 글', async () => {
    renderAnswer('![관리 그림 설명](figure:admin-fig)\n\n[도움말 · 관리](help:admin.only)')
    expect(await screen.findByText('관리 그림 설명')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('help-answer-footer')).toHaveTextContent('도움말 · 관리'))
    expect(screen.queryByRole('button', { name: '도움말 · 관리' })).toBeNull()
  })

  it('관리자에게는 관리자 장 출처가 단추', async () => {
    renderAnswer('![관리 그림 설명](figure:admin-fig)\n\n[도움말 · 관리](help:admin.only)', { admin: true })
    expect(await screen.findByRole('button', { name: '도움말 · 관리자 전용' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /크게 보기/ })).toBeInTheDocument()
  })

  it('evidence 펜스는 접힌 근거 기록', () => {
    const { container } = renderAnswer('답입니다.\n\n```evidence\n{"a":1}\n```')
    const details = container.querySelector('details')!
    expect(details).not.toHaveAttribute('open')
    expect(within(details).getByText('근거 기록').tagName).toBe('SUMMARY')
    expect(details).toHaveTextContent('{"a":1}')
  })

  it('evidence 가 아닌 코드 펜스는 그대로 코드 블록', () => {
    const { container } = renderAnswer('```\nls\n```')
    expect(container.querySelector('details')).toBeNull()
    expect(container.querySelector('pre')).not.toBeNull()
  })

  it('표식 요소에 아이콘(svg)을 붙이지 않는다', async () => {
    const { container } = renderAnswer(FULL)
    await screen.findByRole('button', { name: /크게 보기/ })
    expect(container.querySelector('svg')).toBeNull()
  })

  it('helpAnswer 없이 그리면 help:·dialog: 링크가 사라진다(이슈 코멘트 등)', () => {
    const { container } = renderAnswer('[열기](dialog:agent.run.account) [도움말](help:a) 끝', { helpAnswer: false })
    expect(screen.queryByRole('button')).toBeNull()
    expect(container.querySelector('a[href^="dialog:"], a[href^="help:"]')).toBeNull()
    // 빈 주소 링크도 남기지 않고 글자만 남는다.
    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).toContain('열기')
    expect(container.textContent).toContain('도움말')
    expect(screen.queryByTestId('help-answer-footer')).toBeNull()
  })
})

describe('AI 패널 사용자 말풍선', () => {
  beforeEach(() => chatStreams.setOwner(null))

  /** 앱 셸처럼 대화 상태 안에 AI 채팅 패널을 그린다. */
  function Panel() {
    const chat = useAssistantChat()
    return <AIChatPanel {...chat} />
  }

  it('사용자 말풍선의 표식 글자는 그대로 보이고 단추가 없다, 어시스턴트 답은 그린다', async () => {
    const starts: { correlationId: string }[] = []
    const { user } = renderScreen(
      <ChatSessionProvider>
        <AIAssistantProvider hotkeysEnabled={false}>
          <AiScreenContextProvider>
            <Panel />
          </AiScreenContextProvider>
        </AIAssistantProvider>
      </ChatSessionProvider>,
      {
        handlers: [
          http.post('/api/v1/ai/chat', async ({ request }) => {
            const body = (await request.json()) as { correlationId: string }
            starts.push(body)
            return HttpResponse.json({ correlationId: body.correlationId })
          }),
          ...bundle,
          ...shellHandlers,
        ],
        auth: { isAdmin: true },
      },
    )
    // user.type 은 [ 를 키 이름 시작으로 읽으므로 [[ 로 글자 [ 를 친다.
    await user.type(screen.getByTestId('chat-input'), '[[x](dialog:agent.run.account)')
    await user.click(screen.getByTestId('chat-send'))
    await waitFor(() => expect(starts).toHaveLength(1))
    expect(screen.getByTestId('chat-user-bubble')).toHaveTextContent('[x](dialog:agent.run.account)')
    expect(screen.queryByRole('button', { name: /창 열기/ })).toBeNull()

    // 같은 자리에 AI 답이 도착하면 표식이 단추·칩으로 그려진다.
    const correlationId = starts[0].correlationId
    act(() => emitAiStreamEvent('home.chat.delta', { correlationId, text: '[열기](dialog:agent.run.account)\n\n[매뉴얼 보강](manual-gap:)' }))
    expect(await screen.findByRole('button', { name: 'AI 계정 연결 창 열기' })).toBeInTheDocument()
    expect(screen.getByText('매뉴얼에 없음')).toBeInTheDocument()
  })
})
