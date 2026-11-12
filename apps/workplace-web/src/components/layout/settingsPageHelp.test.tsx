// SettingsPage 의 help 경로(WP-1507) — 설정 가이드 대신 매뉴얼 도움말 대표 절 요약을 AI 화면 참고에 싣는지,
// 묶음을 못 받거나 아직 받는 중일 때 받지 않은 설명을 싣지 않는지, help 가 없는 화면은 /help 를 부르지 않는지 본다.
// 묶음은 AI 패널이나 도움말 패널이 열려 있을 때만 받는다 — 둘 다 닫혀 있으면 화면 이름만 싣고 /help 를 부르지 않는다.
import { screen, waitFor } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'

import { OpenAiPanel, OpenHelpPanel } from '@/test/kits/ai/OpenPanels'
import { currentScreenContext as probe, ScreenContextProbe } from '@/test/kits/ai/ScreenContextProbe'
import { withAppProviders } from '@/test/kits/appProviders'
import { helpBundleHandlers } from '@/test/kits/help/helpBundleKit'
import { shellHandlers } from '@/test/msw/baseHandlers'
import { server } from '@/test/msw/server'
import { renderScreen } from '@/test/renderScreen'

import { SettingsPage } from './SettingsPage'

/**
 * 설정 화면 하나와 화면 참고 탐침 — help 를 주면 그 대표 절로 요약한다.
 * open 은 화면과 함께 열어 둘 패널(기본 AI 패널) — 'none' 이면 두 패널 모두 닫힌 앱 상태다.
 */
function ui(help?: { id: string; name: string }, open: 'ai' | 'help' | 'none' = 'ai') {
  return withAppProviders(
    <>
      {open === 'ai' && <OpenAiPanel />}
      {open === 'help' && <OpenHelpPanel />}
      <SettingsPage title="에이전트" help={help}>
        <p>본문</p>
      </SettingsPage>
      <ScreenContextProbe />
    </>,
  )
}

// 앱 상태 Provider(withAppProviders)가 부르는 앱 셸 기본 조회 — /help 는 들어 있지 않아 「/help 를 부르지 않는다」 판정은 그대로다.
beforeEach(() => {
  server.use(...shellHandlers)
})

describe('SettingsPage help 경로', () => {
  it('help 를 주면 묶음을 받은 뒤 대표 절 요약이 화면 참고에 실린다', async () => {
    renderScreen(ui({ id: 'agents.list', name: '에이전트' }), { handlers: helpBundleHandlers() })
    await waitFor(() => expect(probe()?.scope?.facts).toBeDefined())
    const ctx = probe()!
    expect(ctx.view).toBe('설정 · 에이전트')
    expect(ctx.scope!.label).toBe('설정 · 에이전트')
    expect(ctx.scope!.facts).toEqual([
      { label: '소개', value: '에이전트 표 안내. 새 에이전트 로 만든다.' },
      { label: '개인 비서 표시', value: '개인 비서 표시 본문.' },
    ])
    // 코드 블록은 싣지 않는다.
    expect(JSON.stringify(ctx)).not.toContain('/cmd')
  })

  it('묶음을 받기 전에는 화면 이름만 — 안 받은 값은 싣지 않는다', async () => {
    renderScreen(ui({ id: 'agents.list', name: '에이전트' }), {
      handlers: [
        http.get('/help/manual/:file', async () => {
          await delay('infinite')
          return HttpResponse.json({})
        }),
        ...helpBundleHandlers(),
      ],
    })
    await waitFor(() => expect(probe()?.view).toBe('설정 · 에이전트'))
    // 목차를 받고 장 파일을 기다리는 동안에도 요약은 비어 있다.
    await new Promise((r) => setTimeout(r, 50))
    expect(probe()!.scope!.facts).toBeUndefined()
  })

  it('묶음이 500 이면 화면 이름만 남고 화면은 그대로', async () => {
    renderScreen(ui({ id: 'agents.list', name: '에이전트' }), {
      handlers: [http.get('/help/manual-index.json', () => new HttpResponse(null, { status: 500 })), ...helpBundleHandlers()],
    })
    await waitFor(() => expect(probe()?.view).toBe('설정 · 에이전트'))
    expect(screen.getByText('본문')).toBeInTheDocument()
    expect(probe()!.scope!.facts).toBeUndefined()
  })

  it('AI 패널·도움말 패널이 모두 닫혀 있으면 /help 를 부르지 않고 화면 이름만 싣는다', async () => {
    // 핸들러를 주지 않는다 — /help 를 부르면 setup 의 「핸들러 없는 요청」으로 실패한다.
    renderScreen(ui({ id: 'agents.list', name: '에이전트' }, 'none'))
    await waitFor(() => expect(probe()?.view).toBe('설정 · 에이전트'))
    await new Promise((r) => setTimeout(r, 50))
    expect(probe()!.scope!.facts).toBeUndefined()
  })

  it('도움말 패널만 열려 있어도 묶음을 받아 대표 절 요약을 싣는다', async () => {
    renderScreen(ui({ id: 'agents.list', name: '에이전트' }, 'help'), { handlers: helpBundleHandlers() })
    await waitFor(() => expect(probe()?.scope?.facts).toBeDefined())
    expect(probe()!.scope!.facts![0]).toEqual({ label: '소개', value: '에이전트 표 안내. 새 에이전트 로 만든다.' })
  })

  it('help·guide 둘 다 없으면 화면 참고를 등록하지 않는다, help 가 없으면 /help 요청이 없다', async () => {
    // 핸들러를 주지 않는다 — /help 를 부르면 setup 의 「핸들러 없는 요청」으로 실패한다.
    renderScreen(ui())
    expect(screen.getByText('본문')).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 50))
    expect(probe()).toBeNull()
  })
})
