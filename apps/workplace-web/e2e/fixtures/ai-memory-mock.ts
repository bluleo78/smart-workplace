// WP-55 AI 메모리 E2E 모킹 — 채팅 결과 줄 되돌리기(POST /users/me/ai-memories/undo). 설정 카드 목은 Task 8 이 이 파일에 더한다.
import type { Page } from '@playwright/test'

import type { UndoAiMemoryRequest } from '../../src/types/aiMemory'
import { type RequestTracker, trackRequests } from './requests'

/** 되돌리기 응답을 순서대로 소비 — 비면 받은 값으로 성공({...body, undone:true}). */
export async function mockMemoryUndo(page: Page, replies: Array<{ status: number; body: unknown }> = []): Promise<RequestTracker> {
  const calls = trackRequests(page, 'POST', '/api/v1/users/me/ai-memories/undo')
  let i = 0
  await page.route((u) => u.pathname === '/api/v1/users/me/ai-memories/undo', (route) => {
    const r = replies[i++] ?? { status: 200, body: { ...(route.request().postDataJSON() as UndoAiMemoryRequest), undone: true } }
    return route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.body) })
  })
  return calls
}

/** 서버 오류 응답(ErrorResponse + errors.code). */
export const memoryError = (status: number, code: string, message = '오류') => ({
  status,
  body: { status, error: '', message, errors: { code } },
})
