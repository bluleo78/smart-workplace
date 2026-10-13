// 개인 비서 API 목(GET 상태·GET 모델 목록·PUT 설정) — 프로필 개인 비서 spec 과 AI 비서 설정(추천 모델) spec 이 같은 경로를 쓰므로 한 곳에 둔다.
import type { Page } from '@playwright/test'

import { type RequestTracker, trackRequests } from './requests'

/** GET /users/me/assistant — 상태. get 을 요청마다 불러 등록 뒤 재조회처럼 응답을 바꿀 수 있다. */
export function mockMyAssistantStatus(page: Page, get: () => object) {
  return page.route('**/api/v1/users/me/assistant', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(get()) })
    }
    return route.fallback()
  })
}

/** GET /users/me/assistant/models — 설정된 비서의 서버 모델 목록. */
export function mockMyAssistantModels(page: Page, models: Array<{ id: string; label: string }>, provider = 'anthropic') {
  return page.route('**/api/v1/users/me/assistant/models', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ provider, models }) })
    }
    return route.fallback()
  })
}

/** PUT /users/me/assistant/settings — 204 로 받는다. 저장 요청 tracker 를 돌려준다. */
export async function mockMyAssistantSettings(page: Page): Promise<RequestTracker> {
  const puts = trackRequests(page, 'PUT', '/api/v1/users/me/assistant/settings')
  await page.route('**/api/v1/users/me/assistant/settings', (r) => r.fulfill({ status: 204, body: '' }))
  return puts
}
