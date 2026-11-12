// AI 창 열기 등록부(WP-1511) — 화면이 등록하면 lookup 이 찾고 화면 참고 help.dialogs 에 실리며, 화면이 사라지면 풀린다.
// 읽기 전용(사용 중지된 AI)·설정 권한 없는 AI 계정 묶음은 등록하지 않는다.
import { act, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { type ReactNode, useContext, useEffect, useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { AiScreenContextProvider } from '@/components/ai/screen-context/AiScreenContextProvider'
import { AiScreenContextStoreContext, useRegisterAiScreenContext } from '@/components/ai/screen-context/useAiScreenContext'
import AgentManagementPage from '@/pages/admin/AgentManagementPage'
import { AgentRepoConnectionGroup } from '@/pages/admin/components/agent-detail/AgentRepoConnectionGroup'
import { AgentAiAccountGroup } from '@/pages/admin/components/AgentConnectionSection'
import { createAccount } from '@/test/kits/admin/agentAccounts'
import { createLocations } from '@/test/kits/admin/agentRuntime'
import { helpBundleHandlers } from '@/test/kits/help/helpBundleKit'
import { shellHandlers } from '@/test/msw/baseHandlers'
import { server } from '@/test/msw/server'
import { renderScreen } from '@/test/renderScreen'

import { AiDialogTargetsProvider, useAiDialogTarget, useAiDialogTargetLookup } from './AiDialogTargets'

type Lookup = ReturnType<typeof useAiDialogTargetLookup>
type Store = { get(): { help?: { dialogs?: { id: string; label: string }[] } } | null }

/** 테스트가 lookup·store 를 읽도록 밖으로 꺼낸다. */
let lookup: Lookup | null = null
let store: Store | null = null
function Probe() {
  const l = useAiDialogTargetLookup()
  const s = useContext(AiScreenContextStoreContext)
  useEffect(() => {
    lookup = l
    store = s as unknown as Store
  }, [l, s])
  return null
}

/** 계정 추가 창을 등록하는 가짜 화면 — open 이 불렸는지 mock 으로 본다. */
function FakeScreen({ open }: { open: () => void }) {
  const ref = useRef<HTMLButtonElement>(null)
  // 화면 참고는 페이지 문맥이 있어야 만들어진다(창 목록만으로는 보낼 화면이 아니다) — 실제 화면처럼 문맥도 등록한다.
  useRegisterAiScreenContext({ view: '계정' })
  useAiDialogTarget('agents.accounts.add', { open, anchor: ref })
  return <button ref={ref}>기준 단추</button>
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <AiScreenContextProvider>
      <AiDialogTargetsProvider>
        <Probe />
        {children}
      </AiDialogTargetsProvider>
    </AiScreenContextProvider>
  )
}

describe('AI 창 열기 등록부', () => {
  it('등록하면 lookup 이 열기 함수와 기준 단추를 준다', () => {
    const open = vi.fn()
    renderScreen(
      <Shell>
        <FakeScreen open={open} />
      </Shell>,
    )
    const found = lookup!('agents.accounts.add')
    expect(found).not.toBeNull()
    expect(found!.anchor).toBe(screen.getByRole('button', { name: '기준 단추' }))
    act(() => found!.open())
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('등록한 화면이 사라지면 lookup 이 null', () => {
    const { rerender } = renderScreen(
      <Shell>
        <FakeScreen open={() => {}} />
      </Shell>,
    ) as unknown as { rerender: (ui: ReactNode) => void }
    expect(lookup!('agents.accounts.add')).not.toBeNull()
    rerender(<Shell>{null}</Shell>)
    expect(lookup!('agents.accounts.add')).toBeNull()
  })

  it('등록하면 화면 참고 help.dialogs 에 id·라벨이 실린다', () => {
    renderScreen(
      <Shell>
        <FakeScreen open={() => {}} />
      </Shell>,
    )
    expect(store!.get()?.help?.dialogs).toEqual([{ id: 'agents.accounts.add', label: '계정 추가' }])
  })

  it('사용 중지된 AI 의 AI 계정 묶음은 등록하지 않는다', async () => {
    const handlers = [http.get('/api/v1/admin/agents/100/provider-credential', () => HttpResponse.json({ message: 'none' }, { status: 404 }))]
    renderScreen(
      <Shell>
        <AgentAiAccountGroup agentUserId={100} canConfigure readOnly />
      </Shell>,
      { handlers },
    )
    await screen.findByText('아직 연결하지 않았어요.')
    expect(lookup!('agent.run.account')).toBeNull()
    expect(store!.get()?.help?.dialogs).toBeUndefined()
  })

  it('설정할 수 있는 AI 의 AI 계정 묶음은 등록하고, 연결하기 창을 연다', async () => {
    const handlers = [http.get('/api/v1/admin/agents/100/provider-credential', () => HttpResponse.json({ message: 'none' }, { status: 404 }))]
    renderScreen(
      <Shell>
        <AgentAiAccountGroup agentUserId={100} canConfigure />
      </Shell>,
      { handlers },
    )
    const button = await screen.findByTestId('oauth-token-register')
    const found = lookup!('agent.run.account')
    expect(found?.anchor).toBe(button)
    act(() => found!.open())
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('설정 권한이 없으면 AI 계정 묶음은 등록하지 않는다', async () => {
    const handlers = [http.get('/api/v1/admin/agents/100/provider-credential', () => HttpResponse.json({ message: 'none' }, { status: 404 }))]
    renderScreen(
      <Shell>
        <AgentAiAccountGroup agentUserId={100} canConfigure={false} />
      </Shell>,
      { handlers },
    )
    await screen.findByText('아직 연결하지 않았어요.')
    expect(lookup!('agent.run.account')).toBeNull()
  })
})

describe('저장소 토큰 넣기 창 등록', () => {
  const project = (key: string, host: string) => ({ projectKey: key, name: key, repositoryUrl: `https://${host}/a/b.git`, repositoryBranch: 'main', repositoryHost: host })
  const repoHandlers = (projects: unknown[]) => [
    http.get('/api/v1/admin/agents/100/runtime-setting/projects', () => HttpResponse.json(projects)),
    http.get('/api/v1/admin/agents/100/repo-credentials', () => HttpResponse.json([])),
  ]

  it('불러오는 동안에는 등록하지 않는다', () => {
    renderScreen(
      <Shell>
        <AgentRepoConnectionGroup agentUserId={100} />
      </Shell>,
      { handlers: [http.get('/api/v1/admin/agents/100/runtime-setting/projects', () => new Promise<Response>(() => {})), ...repoHandlers([])] },
    )
    expect(lookup!('agent.run.repo.token')).toBeNull()
  })

  it('호스트 줄이 하나면 그 줄의 창을 연다', async () => {
    renderScreen(
      <Shell>
        <AgentRepoConnectionGroup agentUserId={100} />
      </Shell>,
      { handlers: repoHandlers([project('WD', 'github.com')]) },
    )
    await screen.findByText('github.com')
    const found = lookup!('agent.run.repo.token')
    expect(found).not.toBeNull()
    act(() => found!.open())
    // 행에서 연 창은 그 호스트 제목(「github.com 연결하기」)이다 — 「저장소 호스트 추가」 창이 아니다.
    expect(await screen.findByText('github.com 연결하기')).toBeInTheDocument()
  })

  it('호스트 줄이 여럿이면 「+ 다른 호스트 추가」 창을 연다', async () => {
    renderScreen(
      <Shell>
        <AgentRepoConnectionGroup agentUserId={100} />
      </Shell>,
      { handlers: repoHandlers([project('WD', 'github.com'), project('HR', 'gitlab.com')]) },
    )
    await screen.findByText('gitlab.com')
    const found = lookup!('agent.run.repo.token')
    expect(found?.anchor).toBe(screen.getByTestId('agent-repo-add'))
    act(() => found!.open())
    expect(await screen.findByText('저장소 호스트 추가')).toBeInTheDocument()
  })
})

describe('계정 추가 창 등록', () => {
  const setup = (path: string) => {
    server.use(...helpBundleHandlers(), ...shellHandlers)
    renderScreen(
      <Shell>
        <AgentManagementPage />
      </Shell>,
      {
        path,
        handlers: [
          http.get('/api/v1/admin/agent-accounts', () => HttpResponse.json([createAccount()])),
          http.get('/api/v1/admin/agent-locations', () => HttpResponse.json(createLocations())),
          http.get('/api/v1/admin/agent-runtime-summaries', () => HttpResponse.json([])),
        ],
      },
    )
  }

  it('계정 탭에서만 등록한다', async () => {
    setup('/settings/agents/accounts')
    await screen.findByTestId('agent-account-row-1')
    expect(lookup!('agents.accounts.add')).not.toBeNull()
  })

  it('실행 환경 탭에서는 등록하지 않는다', async () => {
    setup('/settings/agents/locations')
    await screen.findByTestId('agent-location-new')
    expect(lookup!('agents.accounts.add')).toBeNull()
  })
})
