// 모바일 메일 탭 배지(WP-186) — 페이지 테스트(WP-981).
// 탭 배지 숫자는 안 읽은 업무 메일 수(unread-summary)를 그대로 보이는 문구라 브라우저 없이 판정되므로
// e2e/pages/mobile/mail-views.spec.ts 에서 옮겼다. 메일 화면 배선(헤더 제목·☰ 시트 하위 분류)은 E2E @wiring 에 남는다.
import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { chatHandlers } from '@/test/kits/mobile/chatHistory'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import { mockViewport } from '@/test/viewport'

// 모바일 폭 — 하단 탭바(메일 탭 배지)가 그려지는 조건.
mockViewport()

test('메일 탭 배지 = 업무 안 읽은 수', async () => {
  renderPage('/', {
    handlers: [...chatHandlers(), http.get('/api/v1/mail/unread-summary', () => HttpResponse.json({ workUnread: 2 }))],
  })
  expect(await screen.findByTestId('mobile-tab-badge-mail', {}, { timeout: PAGE_LOAD_TIMEOUT })).toHaveTextContent('2')
})
