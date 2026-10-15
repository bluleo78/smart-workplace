// WP-139 설정 — AI 비서 페이지 "추천 질문" 스위치(개인 비서 없어도 보임)와 추천 모델 선택(개인·관리자)의 저장 payload.
import { mockAiPreferences } from '../../fixtures/ai-suggestions-mock'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { mockMyAssistantModels, mockMyAssistantSettings, mockMyAssistantStatus } from '../../fixtures/my-assistant-mock'
import { trackRequests } from '../../fixtures/requests'

const status = (over: Record<string, unknown> = {}) => ({
  configured: true, tokenLabel: null, tokenLastUsedAt: null, model: 'claude-sonnet-5-5', thinkingDepth: 'NORMAL',
  name: null, provider: 'anthropic', baseUrl: null, suggestionModel: null, suggestionModelAuto: 'claude-haiku-5-5', ...over,
})

/** 개인 비서 상태·모델 목록·설정 저장 목 — 저장 요청 tracker 를 돌려준다. */
async function mockPersonal(page: import('@playwright/test').Page, s: Record<string, unknown>, models: Array<{ id: string; label: string }>) {
  await mockMyAssistantStatus(page, () => s)
  await mockMyAssistantModels(page, models, typeof s.provider === 'string' ? s.provider : 'anthropic')
  return mockMyAssistantSettings(page)
}

test('개인 비서가 없어도 추천 질문 스위치가 보이고, 끄면 false 를 저장한다', async ({ authenticatedPage: page }) => {
  const puts = await mockAiPreferences(page, true)
  await mockMyAssistantStatus(page, () => ({ ...status(), configured: false, provider: null, model: null, suggestionModelAuto: null }))
  await page.goto('/settings/assistant')
  const card = page.getByTestId('ai-suggestions-card')
  await expect(card).toContainText('추천 질문')
  await expect(card).toContainText('AI 대화에서 시작할 질문과 답 뒤 이어 물을 질문을 제안해요')
  const toggle = page.getByTestId('ai-suggestions-toggle')
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await toggle.click()
  await puts.waitFor(1)
  expect(puts.lastBody()).toEqual({ suggestionsEnabled: false })
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
})

test('개인 비서 추천 모델 — 자동 라벨, 모델 선택과 자동 되돌리기 payload', async ({ authenticatedPage: page }) => {
  const puts = await mockPersonal(page, status(), [
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
    { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
  ])
  await page.goto('/settings/assistant')
  const trigger = page.getByTestId('assistant-suggestion-model')
  await expect(trigger).toContainText('자동 (Claude Haiku 5.5)')
  await expect(page.getByText('추천·후속 질문을 만들 때만 쓰는 가벼운 모델이에요.')).toBeVisible()
  await trigger.click()
  await page.getByRole('option', { name: 'Claude Sonnet 5.5' }).click()
  await puts.waitFor(1)
  expect(puts.lastBody()).toEqual({ suggestionModel: 'claude-sonnet-5-5' })
})

test('저장된 추천 모델에서 자동으로 되돌리면 null 을 보낸다', async ({ authenticatedPage: page }) => {
  const puts = await mockPersonal(page, status({ suggestionModel: 'claude-sonnet-5-5' }), [{ id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' }])
  await page.goto('/settings/assistant')
  await page.getByTestId('assistant-suggestion-model').click()
  await page.getByRole('option', { name: /^자동/ }).click()
  await puts.waitFor(1)
  expect(puts.lastBody()).toEqual({ suggestionModel: null })
})

// 직접 입력에 providerId/ 접두가 없으면 비서 모델의 providerId 를 붙여 저장한다(접두 규칙 자체는 src/lib/ai/suggestionModel.test.ts).
test('목록 조회를 지원하지 않는 연결은 직접 입력, 자동 라벨은 비서 모델', async ({ authenticatedPage: page }) => {
  const puts = await mockPersonal(page, status({ provider: 'opencode', model: 'amazon-bedrock-openai/gpt-oss', suggestionModelAuto: 'amazon-bedrock-openai/gpt-oss' }), [])
  await page.goto('/settings/assistant')
  await expect(page.getByTestId('assistant-suggestion-model-current')).toContainText('자동 (amazon-bedrock-openai/gpt-oss)')
  await page.getByTestId('assistant-suggestion-model-input').fill('small')
  await page.getByTestId('assistant-suggestion-model-apply').click()
  await puts.waitFor(1)
  expect(puts.lastBody()).toEqual({ suggestionModel: 'amazon-bedrock-openai/small' })
})

test('관리자 공통 비서 상세에 추천 질문 모델 칸이 있고 저장 payload 가 맞다', async ({ adminPage: page }) => {
  const AGENT_ID = 5
  await mockApi(page, 'GET', '/api/v1/admin/workspace-assistant', {
    agentUserId: AGENT_ID, agentName: 'AI 봇', hasActiveToken: true, model: 'claude-sonnet-5-5', thinkingDepth: 'NORMAL', suggestionModel: null, suggestionModelAuto: 'claude-haiku-5-5',
  })
  await page.route(/\/api\/v1\/admin\/agents(\?.*)?$/, (r) => r.fulfill({ json: [{ id: AGENT_ID, username: 'ai_bot', name: 'AI 봇', email: 'ai@bot.local', kind: 'AGENT', isActive: true, createdAt: '2026-05-31T00:00:00Z' }] }))
  await page.route(/\/api\/v1\/admin\/agents\/\d+\/keys$/, (r) => r.fulfill({ json: [] }))
  await page.route(/\/api\/v1\/admin\/agents\/\d+\/provider-credential$/, (r) =>
    r.fulfill({ json: { id: 1, provider: 'anthropic', baseUrl: null, label: 't', createdAt: '2026-05-31T00:00:00Z', lastUsedAt: null } }))
  await page.route(/\/api\/v1\/admin\/agents\/\d+\/models$/, (r) =>
    r.fulfill({ json: { provider: 'anthropic', models: [{ id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' }, { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' }] } }))
  const puts = trackRequests(page, 'PUT', '/api/v1/admin/workspace-assistant/settings')
  await page.route('**/api/v1/admin/workspace-assistant/settings', (r) => r.fulfill({ status: 204, body: '' }))

  await page.goto('/settings/agents')
  await page.getByTestId(`agent-row-${AGENT_ID}`).click()
  const trigger = page.getByTestId('workspace-assistant-suggestion-model')
  await expect(trigger).toContainText('자동 (Claude Haiku 5.5)')
  await trigger.click()
  await page.getByRole('option', { name: 'Claude Haiku 5.5', exact: true }).click()
  await puts.waitFor(1)
  expect(puts.lastBody()).toEqual({ suggestionModel: 'claude-haiku-5-5' })
})
