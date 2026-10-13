// WP-139 AI 추천 질문 E2E 모킹 — POST /api/v1/ai/suggestions 응답(보류 게이트 포함)과 GET/PUT /users/me/ai-preferences.
// auth.fixture 의 기본 스텁(빈 결과·켜짐)보다 나중에 등록되므로 LIFO 로 이쪽이 우선한다.
import type { Page } from '@playwright/test'

import type { AiPreferences, StarterSuggestionsResponse } from '../../src/types/aiSuggestions'
import { type RequestTracker, trackRequests } from './requests'

/**
 * 추천 응답 모킹 — reply 를 순서대로 소비(마지막 것을 반복). gate 를 주면 모든 응답을, gates[i] 를 주면 i 번째 응답만
 * 그 프라미스가 풀릴 때까지 보류한다(부하에서도 "둘째 응답이 아직 안 왔다"를 결정적으로 관측하려는 용도).
 */
export async function mockStarterSuggestions(
  page: Page,
  opts: { replies: Array<StarterSuggestionsResponse | { status: number }>; gate?: Promise<void>; gates?: Array<Promise<void> | undefined> },
): Promise<RequestTracker> {
  const calls = trackRequests(page, 'POST', '/api/v1/ai/suggestions')
  let i = 0
  await page.route((u) => u.pathname === '/api/v1/ai/suggestions', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    const n = i++
    const reply = opts.replies[Math.min(n, opts.replies.length - 1)]
    if (opts.gate) await opts.gate
    const own = opts.gates?.[n]
    if (own) await own
    if ('status' in reply) {
      return route.fulfill({ status: reply.status, contentType: 'application/json', body: JSON.stringify({ message: '오류' }) })
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reply) })
  })
  return calls
}

/** 사용자 AI 설정 모킹 — PUT 은 보낸 필드만 바꾸고(WP-55 부분 갱신) 두 값을 돌려준다. 저장 요청 tracker 를 돌려준다. */
export async function mockAiPreferences(page: Page, enabled: boolean, opts: { memoryEnabled?: boolean } = {}): Promise<RequestTracker> {
  const puts = trackRequests(page, 'PUT', '/api/v1/users/me/ai-preferences')
  let current: AiPreferences = { suggestionsEnabled: enabled, memoryEnabled: opts.memoryEnabled ?? true }
  await page.route((u) => u.pathname === '/api/v1/users/me/ai-preferences', (route) => {
    if (route.request().method() === 'PUT') current = { ...current, ...(route.request().postDataJSON() as Partial<AiPreferences>) }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current) })
  })
  return puts
}
