// 설정 › AI 비서(AssistantSettingsPage) 상단 — 화면 컴포넌트 테스트(WP-971, WP-995).
// 화면 제목(#651)·가이드 내용(WP-399)·「AI에게 묻기」가 입력창 문구를 채워 AI 를 엶(WP-414), 추천 질문 스위치(개인 비서 없어도 보임)와
// 추천 모델 선택(자동 라벨·모델 고르기·자동으로 되돌리기·직접 입력 접두, 관리자 공통 비서 상세)의 저장 payload(WP-139)는
// 브라우저 없이 판정되므로 e2e/pages/settings/ai-suggestion-settings.spec.ts·settings-layout.spec.ts·settings-guide.spec.ts 에서 옮겼다.
// 메모리 카드는 aiMemoryCard.test.tsx, 공용 메모리 탭은 shared/sharedMemory.test.tsx 가 본다. 화면 배선(@wiring)은 ai-memory-settings.spec.ts 에 남는다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { settingsGuides } from '@/components/settings-guide/settingsGuides'
import { AgentConnectionSection } from '@/pages/admin/components/AgentConnectionSection'
import { PersonalAssistantSection } from '@/pages/profile/PersonalAssistantSection'
import { renderScreen } from '@/test/renderScreen'

import AssistantSettingsPage from './AssistantSettingsPage'
import { aiMemoriesApi, aiPreferencesApi, memoryChangesApi } from './memoryTestkit-b7'
import { openGuideSheet, withAssistant } from './testkit-b7'

const status = (over: Record<string, unknown> = {}) => ({
  configured: true, tokenLabel: null, tokenLastUsedAt: null, model: 'claude-sonnet-5-5', thinkingDepth: 'NORMAL',
  name: null, provider: 'anthropic', baseUrl: null, suggestionModel: null, suggestionModelAuto: 'claude-haiku-5-5', ...over,
})
const NO_ASSISTANT = { ...status(), configured: false, provider: null, model: null, suggestionModelAuto: null }

/** 개인 비서 상태·모델 목록·설정 저장(PUT 본문은 puts 에). */
function assistantApi(s: Record<string, unknown>, models: Array<{ id: string; label: string }> = []) {
  const puts: unknown[] = []
  return {
    puts,
    handlers: [
      http.get('/api/v1/users/me/assistant', () => HttpResponse.json(s)),
      http.get('/api/v1/users/me/assistant/models', () => HttpResponse.json({ provider: s.provider ?? 'anthropic', models })),
      http.put('/api/v1/users/me/assistant/settings', async ({ request }) => {
        puts.push(await request.json())
        return new HttpResponse(null, { status: 204 })
      }),
    ],
  }
}

describe('AI 비서 화면', () => {
  /** 화면 전체(개인 비서 없음·빈 메모리)를 띄운다 — 「AI에게 묻기」를 보려고 AI Provider 로 감싼다. */
  async function openPage() {
    const prefs = aiPreferencesApi(true)
    const view = renderScreen(withAssistant(<AssistantSettingsPage />), {
      path: '/settings/assistant',
      handlers: [...assistantApi(NO_ASSISTANT).handlers, ...prefs.handlers, ...aiMemoriesApi([]).handlers, ...memoryChangesApi([], 0).handlers],
    })
    await screen.findByTestId('ai-memory-empty')
    return { ...view, prefs }
  }

  // 페이지 제목은 사이드바 메뉴 라벨과 같다(#651). WP-399 — 화면마다 자기 가이드가 붙는다.
  test('제목이 「AI 비서」이고 가이드에 AI 비서 가이드가 보인다 (#651·WP-399)', async () => {
    const { user } = await openPage()
    expect(screen.getByTestId('page-header')).toHaveTextContent('AI 비서')
    const sheet = await openGuideSheet(user)
    expect(sheet.getByText(settingsGuides.assistant.lead)).toBeInTheDocument()
  })

  // WP-414 — 가이드의 「이 설정에 대해 AI에게 묻기」는 입력창 문구를 채운 채 AI 를 연다(문구·맥락 전송·포커스는 E2E·AIChatPanel 이 본다).
  test('가이드의 「AI에게 묻기」는 문구를 채운 채 AI 옆 패널을 열고 시트를 닫는다 (WP-414)', async () => {
    const { user } = await openPage()
    const sheet = await openGuideSheet(user)
    await user.click(sheet.getByTestId('settings-guide-ask-ai'))
    const probe = screen.getByTestId('ai-probe')
    expect(probe).toHaveAttribute('data-mode', 'side')
    expect(probe).toHaveAttribute('data-seed', '이 설정에 대해 알려줘 ')
    await waitFor(() => expect(screen.queryByTestId('settings-guide-sheet')).not.toBeInTheDocument())
  })

  test('개인 비서가 없어도 추천 질문 스위치가 보이고, 끄면 false 를 저장한다 (WP-139)', async () => {
    const { user, prefs } = await openPage()
    const card = screen.getByTestId('ai-suggestions-card')
    expect(card).toHaveTextContent('추천 질문')
    expect(card).toHaveTextContent('AI 대화에서 시작할 질문과 답 뒤 이어 물을 질문을 제안해요')
    const toggle = screen.getByTestId('ai-suggestions-toggle')
    await waitFor(() => expect(toggle).toBeEnabled())
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    await user.click(toggle)
    await waitFor(() => expect(prefs.puts).toEqual([{ suggestionsEnabled: false }]))
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'))
  })
})

// WP-139 추천 질문 모델 — 개인 비서 섹션만 띄운다.
describe('개인 비서 추천 모델 (WP-139)', () => {
  async function openPersonal(s: Record<string, unknown>, models: Array<{ id: string; label: string }>) {
    const api = assistantApi(s, models)
    const view = renderScreen(<PersonalAssistantSection />, { path: '/settings/assistant', handlers: api.handlers })
    await screen.findByText('개인 비서', { exact: true })
    return { ...view, puts: api.puts }
  }

  test('자동 라벨은 서버 자동 모델이고, 모델을 고르면 그 id 를 저장한다', async () => {
    const { user, puts } = await openPersonal(status(), [
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
      { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
    ])
    const trigger = await screen.findByTestId('assistant-suggestion-model')
    await waitFor(() => expect(trigger).toHaveTextContent('자동 (Claude Haiku 5.5)'))
    expect(screen.getByText('추천·후속 질문을 만들 때만 쓰는 가벼운 모델이에요.')).toBeInTheDocument()
    await user.click(trigger)
    await user.click(await screen.findByRole('option', { name: 'Claude Sonnet 5.5' }))
    await waitFor(() => expect(puts).toEqual([{ suggestionModel: 'claude-sonnet-5-5' }]))
  })

  test('저장된 추천 모델에서 자동으로 되돌리면 null 을 보낸다', async () => {
    const { user, puts } = await openPersonal(status({ suggestionModel: 'claude-sonnet-5-5' }), [{ id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' }])
    await user.click(await screen.findByTestId('assistant-suggestion-model'))
    await user.click(await screen.findByRole('option', { name: /^자동/ }))
    await waitFor(() => expect(puts).toEqual([{ suggestionModel: null }]))
  })

  // 직접 입력에 providerId/ 접두가 없으면 비서 모델의 providerId 를 붙여 저장한다(접두 규칙 자체는 src/lib/ai/suggestionModel.test.ts).
  test('목록 조회를 지원하지 않는 연결은 직접 입력이고 자동 라벨은 비서 모델, 저장은 providerId 접두를 붙인다', async () => {
    const { user, puts } = await openPersonal(
      status({ provider: 'opencode', model: 'amazon-bedrock-openai/gpt-oss', suggestionModelAuto: 'amazon-bedrock-openai/gpt-oss' }),
      [],
    )
    await waitFor(() => expect(screen.getByTestId('assistant-suggestion-model-current')).toHaveTextContent('자동 (amazon-bedrock-openai/gpt-oss)'))
    await user.click(screen.getByTestId('assistant-suggestion-model-input'))
    await user.paste('small')
    await user.click(screen.getByTestId('assistant-suggestion-model-apply'))
    await waitFor(() => expect(puts).toEqual([{ suggestionModel: 'amazon-bedrock-openai/small' }]))
  })
})

// 관리자 › 에이전트 상세의 공통 비서 연결 섹션 — 추천 질문 모델 칸과 저장 payload.
test('관리자 공통 비서 상세에 추천 질문 모델 칸이 있고 저장 payload 가 맞다 (WP-139)', async () => {
  const AGENT_ID = 5
  const puts: unknown[] = []
  const { user } = renderScreen(<AgentConnectionSection agentUserId={AGENT_ID} canConfigure />, {
    path: '/settings/agents',
    handlers: [
      http.get('/api/v1/admin/workspace-assistant', () =>
        HttpResponse.json({ agentUserId: AGENT_ID, agentName: 'AI 봇', hasActiveToken: true, model: 'claude-sonnet-5-5', thinkingDepth: 'NORMAL', suggestionModel: null, suggestionModelAuto: 'claude-haiku-5-5' }),
      ),
      http.get('/api/v1/admin/agents/:id/provider-credential', () =>
        HttpResponse.json({ id: 1, provider: 'anthropic', baseUrl: null, label: 't', createdAt: '2026-05-31T00:00:00Z', lastUsedAt: null }),
      ),
      http.get('/api/v1/admin/agents/:id/models', () =>
        HttpResponse.json({ provider: 'anthropic', models: [{ id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' }, { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' }] }),
      ),
      http.put('/api/v1/admin/workspace-assistant/settings', async ({ request }) => {
        puts.push(await request.json())
        return new HttpResponse(null, { status: 204 })
      }),
    ],
  })
  const trigger = await screen.findByTestId('workspace-assistant-suggestion-model')
  await waitFor(() => expect(trigger).toHaveTextContent('자동 (Claude Haiku 5.5)'))
  await user.click(trigger)
  await user.click(await within(document.body).findByRole('option', { name: 'Claude Haiku 5.5' }))
  await waitFor(() => expect(puts).toEqual([{ suggestionModel: 'claude-haiku-5-5' }]))
})
