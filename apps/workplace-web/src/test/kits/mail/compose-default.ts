// 메일 작성 방식 기본값(WP-1744)·새 창(WP-1535) 테스트 도우미 — 기본값별 설정 응답과 가짜 새 창을 여러 파일(기본값·임시저장·새 창)이 같이 쓴다.
import { http, HttpResponse } from 'msw'
import { vi } from 'vitest'

import type { MailComposeDefault } from '@/types/mailSettings'

import { createMailSettings } from '../../../../e2e/factories/mailSettings.factory'

/** 작성 방식 기본값 응답(GET /mail/settings) — 처음부터 그 기본값으로 띄울 때 handlers 에 건다(renderScreen 의 기본 DOCK 보다 앞선다). */
export const composeSettingsHandler = (composeMode: MailComposeDefault) =>
  http.get('/api/v1/mail/settings', () => HttpResponse.json(createMailSettings({ composeMode })))

/** 가짜 새 창 — jsdom 에는 실제 창이 없어 window.open 이 이것을 돌려주게 둔다. 주소 설정·닫기·앞으로 가져오기만 본다. */
export function fakeWindow() {
  return { location: { href: '' }, close: vi.fn(), closed: false, focus: vi.fn() }
}
