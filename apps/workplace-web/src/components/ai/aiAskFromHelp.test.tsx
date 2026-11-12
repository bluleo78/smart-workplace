// 도움말의 「✦ AI에게 묻기」(WP-1511) — 검색어가 있으면 바로 보내고, 도움말 문맥을 AI 화면 참고로 이어 가는지 본다.
// 도움말 패널(HelpPanel)과 AI 채팅 패널(AIChatPanel)을 한 트리에 두고 /ai/chat 요청 본문(screenContext)으로 판정한다.
// 휴대폰 시트 쪽(도움말을 먼저 닫는 순서)은 MobileHelpSheet.test.tsx 가 본다.
import { act, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { StrictMode, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AIAssistantProvider, useAssistant } from '@/components/ai/AIAssistantContext'
import { AIChatPanel } from '@/components/ai/AIChatPanel'
import { AiScreenContextProvider } from '@/components/ai/screen-context/AiScreenContextProvider'
import { useRegisterAiScreenContext } from '@/components/ai/screen-context/useAiScreenContext'
import { HelpPanelProvider } from '@/components/help/HelpPanelContext'
import { ChatSessionProvider } from '@/hooks/ChatSessionContext'
import { useAssistantChat } from '@/hooks/useAssistantChat'
import { chatStreams } from '@/lib/ai/chatStreams'
import { helpBundleHandlers, helpSearchHandler } from '@/test/kits/help/helpBundleKit'
import { HelpPanelHost } from '@/test/kits/help/HelpPanelHost'
import { shellHandlers } from '@/test/msw/baseHandlers'
import { renderScreen } from '@/test/renderScreen'

vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false, getIsMobile: () => false }))

const API = '/api/v1'

type StartBody = { query: string; correlationId: string; screenContext?: { view: string; help?: { query?: string; section?: { id: string } } } }

/** 앱 셸처럼 대화 상태 안에 AI 채팅 패널을 그린다. */
function Panel() {
  const chat = useAssistantChat()
  return <AIChatPanel {...chat} />
}

/** 화면(페이지) 문맥을 등록하는 탐침 — 단추로 화면 이름을 바꿔 「화면을 옮긴다」를 흉내 낸다. */
function PageProbe() {
  const [view, setView] = useState('메일함')
  useRegisterAiScreenContext({ view, scope: { label: view } })
  return <button onClick={() => setView('캘린더')}>화면 옮기기</button>
}

/** 도움말 패널 + AI 채팅 패널을 띄운다. 보낸 /ai/chat 본문은 starts 에 쌓인다. */
function setup(opts: { page?: boolean } = {}) {
  const starts: StartBody[] = []
  const handlers = [
    http.post(`${API}/ai/chat`, async ({ request }) => {
      const body = (await request.json()) as StartBody
      starts.push(body)
      return HttpResponse.json({ correlationId: body.correlationId })
    }),
    helpSearchHandler(),
    ...helpBundleHandlers(),
    ...shellHandlers,
  ]
  const view = renderScreen(
    <ChatSessionProvider>
      <AIAssistantProvider hotkeysEnabled={false}>
        <AiScreenContextProvider>
          <HelpPanelProvider>
            {opts.page && <PageProbe />}
            <HelpPanelHost openButton />
            <Panel />
          </HelpPanelProvider>
        </AiScreenContextProvider>
      </AIAssistantProvider>
    </ChatSessionProvider>,
    { path: '/', handlers, auth: { isAdmin: true } },
  )
  return { ...view, starts }
}

/** 도움말을 열고 본문이 뜰 때까지. */
async function openHelp(user: ReturnType<typeof setup>['user']) {
  await user.click(screen.getByRole('button', { name: '열기' }))
  await screen.findByText('홈 첫머리 본문', { exact: false })
}

const input = () => screen.getByTestId('chat-input') as HTMLTextAreaElement

describe('도움말 「AI에게 묻기」', () => {
  // 대화 저장소는 모듈 싱글턴 — 앞 테스트의 답변 중 상태가 넘어오지 않게 비운다.
  beforeEach(() => chatStreams.setOwner(null))

  it('검색칸에 질의가 있으면 그 질의를 화면 참고(help.query 포함)와 함께 바로 보낸다', async () => {
    const { user, starts } = setup()
    await openHelp(user)
    await user.type(screen.getByRole('combobox', { name: '도움말 검색' }), '토큰 권한은?')
    await screen.findByRole('listbox', { name: '도움말 검색 결과' })
    await user.click(screen.getByTestId('help-ask-ai'))
    await waitFor(() => expect(starts).toHaveLength(1))
    expect(starts[0].query).toBe('토큰 권한은?')
    expect(starts[0].screenContext?.help?.query).toBe('토큰 권한은?')
    // 보낸 글은 입력창에 남지 않는다.
    expect(input().value).toBe('')
  })

  it('칩 ×로 화면 참고를 뺀 뒤 「AI에게 묻기」로 바로 보내도 화면 참고(도움말 포함)를 싣지 않는다', async () => {
    const { user, starts } = setup({ page: true })
    await openHelp(user)
    await user.click(await screen.findByTestId('chat-context-remove'))
    await user.type(screen.getByRole('combobox', { name: '도움말 검색' }), '토큰 권한은?')
    await screen.findByRole('listbox', { name: '도움말 검색 결과' })
    await user.click(screen.getByTestId('help-ask-ai'))
    await waitFor(() => expect(starts).toHaveLength(1))
    expect(starts[0].query).toBe('토큰 권한은?')
    expect(starts[0].screenContext).toBeUndefined()
  })

  it('질의가 없으면 보내지 않고 입력창에 포커스만 간다', async () => {
    const { user, starts } = setup()
    await openHelp(user)
    await user.click(screen.getByTestId('help-ask-ai'))
    await waitFor(() => expect(input()).toHaveFocus())
    expect(starts).toHaveLength(0)
    expect(input().value).toBe('')
  })

  it('다른 답변 중이면 보내지 않고 입력창에 채운다', async () => {
    const { user, starts } = setup()
    // 첫 질문을 보내 두면 스트림 프레임이 없어 답변 중으로 남는다 — 보내기가 막힌다.
    await user.type(input(), '먼저 보낸 질문')
    await user.click(screen.getByTestId('chat-send'))
    await waitFor(() => expect(starts).toHaveLength(1))
    await openHelp(user)
    await user.type(screen.getByRole('combobox', { name: '도움말 검색' }), '토큰 권한은?')
    await screen.findByRole('listbox', { name: '도움말 검색 결과' })
    await user.click(screen.getByTestId('help-ask-ai'))
    await waitFor(() => expect(input().value).toBe('토큰 권한은?'))
    expect(starts).toHaveLength(1)
  })

  it('데스크톱에서 도움말 패널을 닫으면 묻기로 넘긴 도움말 문맥은 버려 보내지 않는다', async () => {
    const { user, starts } = setup()
    await openHelp(user)
    // 질의 없이 묻기 — 보내지 않고 문맥만 넘긴다.
    await user.click(screen.getByTestId('help-ask-ai'))
    await waitFor(() => expect(input()).toHaveFocus())
    await user.click(screen.getByTestId('help-close'))
    await waitFor(() => expect(screen.queryByTestId('help-panel-body')).toBeNull())
    await user.type(input(), '이 화면 어떻게 써?')
    await user.click(screen.getByTestId('chat-send'))
    await waitFor(() => expect(starts).toHaveLength(1))
    expect(starts[0].screenContext?.help).toBeUndefined()
  })

  it('도움말 패널이 이미 닫힌 채 넘겨받은 도움말 문맥(휴대폰 시트)은 첫 전송까지 유지되고 그다음에는 없다(N1)', async () => {
    const { user, starts } = seedSetup({ page: false, send: false })
    await user.click(screen.getByRole('button', { name: '도움말로 묻기' }))
    await user.type(input(), '이 화면 어떻게 써?')
    await user.click(screen.getByTestId('chat-send'))
    await waitFor(() => expect(starts).toHaveLength(1))
    expect(starts[0].screenContext?.help?.section?.id).toBe('home')
  })

  it('화면을 옮기면 carried 도움말을 버린다', async () => {
    const { user, starts } = setup({ page: true })
    await openHelp(user)
    await user.click(screen.getByTestId('help-ask-ai'))
    await waitFor(() => expect(input()).toHaveFocus())
    await user.click(screen.getByTestId('help-close'))
    await waitFor(() => expect(screen.queryByTestId('help-panel-body')).toBeNull())
    await act(async () => screen.getByRole('button', { name: '화면 옮기기' }).click())
    await user.type(input(), '여긴 뭐야?')
    await user.click(screen.getByTestId('chat-send'))
    await waitFor(() => expect(starts).toHaveLength(1))
    expect(starts[0].screenContext?.view).toBe('캘린더')
    expect(starts[0].screenContext?.help).toBeUndefined()
  })
  it('StrictMode 에서 패널이 씨앗이 이미 있는 채 마운트돼도 한 번만 보낸다', async () => {
    const starts: StartBody[] = []
    const handlers = [
      http.post(`${API}/ai/chat`, async ({ request }) => {
        const body = (await request.json()) as StartBody
        starts.push(body)
        return HttpResponse.json({ correlationId: body.correlationId })
      }),
      ...shellHandlers,
    ]
    // 씨앗을 맡긴 같은 핸들러에서 패널을 마운트한다 — 패널이 씨앗을 가진 채 처음 그려진다.
    function AskThenMount() {
      const { askWithPrompt } = useAssistant()
      const [show, setShow] = useState(false)
      return (
        <>
          <button
            onClick={() => {
              askWithPrompt('토큰 권한은?', { send: true })
              setShow(true)
            }}
          >
            묻기
          </button>
          {show && <Panel />}
        </>
      )
    }
    const { user } = renderScreen(
      <StrictMode>
        <ChatSessionProvider>
          <AIAssistantProvider hotkeysEnabled={false}>
            <AiScreenContextProvider>
              <AskThenMount />
            </AiScreenContextProvider>
          </AIAssistantProvider>
        </ChatSessionProvider>
      </StrictMode>,
      { path: '/', handlers },
    )
    await user.click(screen.getByRole('button', { name: '묻기' }))
    await waitFor(() => expect(starts).toHaveLength(1))
    // 늦게 오는 두 번째 전송이 없는지 잠시 더 본다.
    await new Promise((r) => setTimeout(r, 300))
    expect(starts).toHaveLength(1)
    expect(starts[0].query).toBe('토큰 권한은?')
  })

  // 도움말을 얹어 바로 묻는 단추 — 휴대폰(도움말 시트가 층을 비운 뒤 AI 가 열림)과 화면 참고가 없는 화면(설정·관리자)은
  // 저장소에 화면 문맥이 없는 채로 씨앗만 help 를 들고 온다.
  function seedSetup(opts: { page?: boolean; send?: boolean }) {
    const starts: StartBody[] = []
    const handlers = [
      http.post(`${API}/ai/chat`, async ({ request }) => {
        const body = (await request.json()) as StartBody
        starts.push(body)
        return HttpResponse.json({ correlationId: body.correlationId })
      }),
      ...shellHandlers,
    ]
    function Asker() {
      const { askWithPrompt } = useAssistant()
      return (
        <button
          onClick={() =>
            askWithPrompt('토큰 권한은?', { send: opts.send ?? true, help: { section: { id: 'home', path: ['홈'], body: '본문' }, query: '토큰 권한은?' } })
          }
        >
          도움말로 묻기
        </button>
      )
    }
    const view = renderScreen(
      <ChatSessionProvider>
        <AIAssistantProvider hotkeysEnabled={false}>
          <AiScreenContextProvider>
            {opts.page && <PageProbe />}
            <Asker />
            <Panel />
          </AiScreenContextProvider>
        </AIAssistantProvider>
      </ChatSessionProvider>,
      { path: '/', handlers },
    )
    return { ...view, starts }
  }

  it('화면 문맥이 저장소에 없어도(휴대폰·화면 참고 없는 화면) 씨앗의 도움말을 바로 보내는 전송에 싣는다', async () => {
    const { user, starts } = seedSetup({ page: false })
    await user.click(screen.getByRole('button', { name: '도움말로 묻기' }))
    await waitFor(() => expect(starts).toHaveLength(1))
    expect(starts[0].screenContext?.view).toBe('도움말')
    expect(starts[0].screenContext?.help?.section?.id).toBe('home')
    expect(starts[0].screenContext?.help?.query).toBe('토큰 권한은?')
  })

  it('화면 문맥이 있는 화면에서는 그 화면에 도움말을 얹어 보낸다', async () => {
    const { user, starts } = seedSetup({ page: true })
    await user.click(screen.getByRole('button', { name: '도움말로 묻기' }))
    await waitFor(() => expect(starts).toHaveLength(1))
    expect(starts[0].screenContext?.view).toBe('메일함')
    expect(starts[0].screenContext?.help?.section?.id).toBe('home')
  })
})
