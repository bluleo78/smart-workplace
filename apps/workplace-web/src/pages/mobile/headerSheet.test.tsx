// 모바일 헤더(WP-125) — 페이지 테스트(WP-971).
// 🔔 배지 숫자·이동, 메일 사이드바가 인라인 대신 ☰ 바텀시트에만 그려지는 조건부 렌더, 프로젝트 하위 화면 헤더의 ‹ 는
// 브라우저 없이 판정되므로 e2e/pages/mobile/header-sheet.spec.ts 에서 옮겼다.
// 시트 안 가로 넘침(@layout)과 시트를 닫은 뒤 포커스 이동(@input)은 E2E 에 남는다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import { mockViewport } from '@/test/viewport'

import { mailAccount, summary } from '../../../e2e/factories/mail.factory'
import { createProject } from '../../../e2e/factories/project.factory'

// 모바일(iPhone 13 폭·터치) — matchMedia 결과가 파일 안에서 캐시되므로 첫 렌더 전에 한 번.
mockViewport()

describe('모바일 헤더', () => {
  // 탭 루트 헤더의 🔔 는 안 읽은 알림 수를 배지로 보이고, 누르면 알림 화면으로 간다 — 숫자가 다른 카운트로 바뀌거나 이동이 끊기면 실패.
  test('홈 헤더 🔔 배지가 안 읽은 수를 보이고, 누르면 /notifications 로 간다', async () => {
    const { user, location } = renderPage('/', {
      handlers: [
        http.get('/api/v1/notifications/unread-count', () => HttpResponse.json({ count: 5 })),
        // 알림 화면은 웹 푸시 설정을 조회한다 — 푸시 꺼짐.
        http.get('/api/v1/push/config', () => HttpResponse.json({ enabled: false, vapidPublicKey: null })),
      ],
    })
    expect(await screen.findByTestId('mobile-bell-badge', {}, { timeout: PAGE_LOAD_TIMEOUT })).toHaveTextContent('5')
    await user.click(screen.getByTestId('mobile-bell'))
    await waitFor(() => expect(location()).toBe('/notifications'))
  })

  // 모바일 메일은 계정 사이드바를 인라인으로 그리지 않고 ☰ 를 눌러야 바텀시트 안에 그린다.
  test('메일: 계정 사이드바는 인라인에 없고 ☰ 로 연 바텀시트 안에 있다', async () => {
    const { user } = renderPage('/mail', {
      handlers: [
        http.get('/api/v1/mail/accounts', () => HttpResponse.json([mailAccount()])),
        http.get('/api/v1/mail/accounts/1/messages', () => HttpResponse.json([summary()])),
        http.get('/api/v1/mail/accounts/1/unread-counts', () =>
          HttpResponse.json({ classificationActive: false, inbox: 0, byCategory: {}, needsReply: 0 }),
        ),
      ],
    })
    await user.click(await screen.findByTestId('mobile-sidebar-trigger', {}, { timeout: PAGE_LOAD_TIMEOUT }))
    const sheet = await screen.findByTestId('mobile-sidebar-sheet')
    expect(within(sheet).getByTestId('mail-sidebar')).toBeInTheDocument()
    // 시트 밖(인라인)에는 사이드바가 하나도 없다.
    expect(screen.getAllByTestId('mail-sidebar')).toHaveLength(1)
  })

  // 병합 헤더(U1-1): 프로젝트 하위 화면(사이클)은 헤더 선두에 ‹ 하나를 둔다.
  test('프로젝트 하위 페이지(사이클)는 모바일 헤더 안에 ‹ 가 있다', async () => {
    renderPage('/projects/WP/cycles', {
      handlers: [http.get('/api/v1/projects/WP', () => HttpResponse.json(createProject()))],
    })
    const header = await screen.findByTestId('page-header', {}, { timeout: PAGE_LOAD_TIMEOUT })
    expect(await within(header).findByTestId('mobile-back')).toBeInTheDocument()
  })
})
