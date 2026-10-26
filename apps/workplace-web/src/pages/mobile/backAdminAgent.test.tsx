// 모바일 관리자 에이전트 상세 시트(?agent) 딥링크(WP-209) — 페이지 테스트(WP-971).
// 딥링크로 연 시트를 닫으면 ?agent 만 지워져 에이전트 관리에 남는 것, 없는 에이전트는 찾을 수 없음 시트가 되는 것은
// URL 상태라 브라우저 없이 판정되므로 e2e/pages/mobile/back-admin-agent.spec.ts 에서 옮겼다.
// 브라우저 뒤로가기(goBack)로 시트만 닫히는 것(@platform)은 E2E 에 남는다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { MOCK_ADMIN_ROLE, MOCK_USER_ROLE } from '@/test/msw/baseHandlers'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import { mockViewport } from '@/test/viewport'

// 모바일(iPhone 13 폭·터치) — matchMedia 결과가 파일 안에서 캐시되므로 첫 렌더 전에 한 번.
mockViewport()

const AGENT = {
  id: 100,
  username: 'release_coordinator_bot',
  name: '릴리스 일정 조율 및 배포 체크리스트 자동 점검 에이전트',
  email: 'release@bot.local',
  kind: 'AGENT' as const,
  isActive: true,
  createdAt: '2026-05-20T09:00:00Z',
}

/** 에이전트 관리 화면이 부르는 목록·키·자격 증명·워크스페이스 비서. */
const agentHandlers = [
  http.get('/api/v1/admin/agents', () => HttpResponse.json([AGENT])),
  http.get('/api/v1/admin/agents/:id/keys', () => HttpResponse.json([])),
  http.get('/api/v1/admin/agents/:id/provider-credential', () => HttpResponse.json({ message: '없음' }, { status: 404 })),
  http.get('/api/v1/admin/workspace-assistant', () =>
    HttpResponse.json({ agentUserId: null, agentName: null, hasActiveToken: false, model: null, thinkingDepth: null }),
  ),
]

const admin = { roles: [MOCK_ADMIN_ROLE, MOCK_USER_ROLE], handlers: agentHandlers }

describe('에이전트 상세 시트 딥링크', () => {
  // 딥링크로 들어와 닫기를 누르면 ?agent 만 지운다 — 다른 화면으로 튕기거나 쿼리가 남으면 실패.
  test('딥링크(?agent) → 닫기는 에이전트 관리(/settings/agents)에 남는다', async () => {
    const { user, location } = renderPage('/settings/agents?agent=100', admin)
    const drawer = await screen.findByTestId('agent-detail-drawer', {}, { timeout: PAGE_LOAD_TIMEOUT })
    await user.click(within(drawer).getByRole('button', { name: '닫기' }))
    await waitFor(() => expect(location()).toBe('/settings/agents'))
    await waitFor(() => expect(screen.queryByTestId('agent-detail-drawer')).not.toBeInTheDocument())
  })

  // 목록에 없는 id 는 빈 시트가 아니라 찾을 수 없음 안내를 보이고, Esc 로 닫으면 ?agent 가 지워진다.
  test('없는 에이전트 딥링크는 찾을 수 없음 시트를 보이고 Esc 로 닫힌다', async () => {
    const { user, location } = renderPage('/settings/agents?agent=999', admin)
    expect(await screen.findByTestId('agent-detail-notfound', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(location()).toBe('/settings/agents'))
  })
})
