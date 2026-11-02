// 모바일 관리자 에이전트 상세 딥링크(WP-209 → WP-1281) — 페이지 테스트(WP-971).
// 예전엔 ?agent=<id> 로 오른쪽 시트를 열었다. WP-1281 에서 상세가 페이지(/settings/agents/:id)가 되어 옛 딥링크는 그 페이지로 넘어가고
// (알림·문서에 남은 링크가 계속 열린다), 없는 에이전트는 찾을 수 없음 안내가 된다. 시트를 닫는 동작(닫기 → ?agent 만 지움)은 시트와 함께 없어졌다.
// 브라우저 뒤로가기(goBack)로 목록에 돌아가는 것(@platform)은 E2E 에 남는다.
// 라우트(:id)가 필요해 목록·상세 두 라우트를 renderScreen 으로 띄운다(관리자 라우트 가드는 보지 않는다, WP-1002).
import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, test } from 'vitest'

import { AIAssistantProvider } from '@/components/ai/AIAssistantContext'
import { renderScreen } from '@/test/renderScreen'
import { mockViewport } from '@/test/viewport'

import { agentRuntimeApi } from '../../test/kits/admin/agentRuntime'
import AgentDetailPage from '../admin/AgentDetailPage'
import AgentManagementPage from '../admin/AgentManagementPage'

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
  type: 'REGULAR' as const,
  ownerName: null,
  runtime: 'INTERNAL' as const,
  runMode: 'SERVER' as const,
  description: null,
  instructions: null,
  lastKeyUsedAt: null,
}

/** 에이전트 관리 화면이 부르는 목록·키·자격 증명·워크스페이스 비서, 상세의 활성 상태·역할(계정 상세·역할 목록, WP-1075). */
const agentHandlers = [
  http.get('/api/v1/admin/agents', () => HttpResponse.json([AGENT])),
  // 상세 페이지가 한 명을 따로 읽는다 — 없는 id 는 404.
  http.get('/api/v1/admin/agents/:id', ({ params }) =>
    Number(params.id) === AGENT.id ? HttpResponse.json(AGENT) : HttpResponse.json({ message: '없음' }, { status: 404 }),
  ),
  http.get('/api/v1/admin/agents/:id/keys', () => HttpResponse.json([])),
  http.get('/api/v1/admin/agents/:id/provider-credential', () => HttpResponse.json({ message: '없음' }, { status: 404 })),
  http.get('/api/v1/admin/workspace-assistant', () =>
    HttpResponse.json({ agentUserId: null, agentName: null, hasActiveToken: false, model: null, thinkingDepth: null }),
  ),
  http.get('/api/v1/users/:id', () => HttpResponse.json({ ...AGENT, roles: [] })),
  http.get('/api/v1/roles', () => HttpResponse.json([])),
  // AI 실행(WP-1245) — 목록 요약·템플릿·실행 설정 조회.
  ...agentRuntimeApi().handlers,
]

/** 관리자 로그인 — 에이전트 관리는 관리자 화면이다. */
const admin = { auth: { isAdmin: true, hasRole: () => true }, handlers: agentHandlers }

/** 목록·상세 라우트 — 옛 딥링크가 목록 화면에서 상세 라우트로 넘어가는 것까지 본다. */
function Screens() {
  return (
    <AIAssistantProvider hotkeysEnabled={false}>
      <Routes>
        <Route path="/settings/agents" element={<AgentManagementPage />} />
        <Route path="/settings/agents/:id" element={<AgentDetailPage />} />
      </Routes>
    </AIAssistantProvider>
  )
}

describe('에이전트 상세 딥링크', () => {
  // 알림·문서에 남은 옛 링크(?agent=100)는 시트 대신 상세 페이지로 넘어가고, 긴 이름도 머리에 그대로 보인다.
  test('옛 딥링크(?agent) 는 상세 페이지(/settings/agents/:id)로 넘어가 그 에이전트를 보인다', async () => {
    const { location } = renderScreen(<Screens />, { path: '/settings/agents?agent=100', ...admin })
    expect(await screen.findByTestId('agent-detail-page')).toHaveTextContent(AGENT.name)
    expect(location()).toBe('/settings/agents/100')
  })

  // 목록에 없는 id 는 빈 화면이 아니라 찾을 수 없음 안내를 보이고 주소를 조용히 고치지 않는다.
  test('없는 에이전트 딥링크는 찾을 수 없음 안내를 보인다', async () => {
    const { location } = renderScreen(<Screens />, { path: '/settings/agents?agent=999', ...admin })
    expect(await screen.findByTestId('agent-detail-notfound')).toHaveTextContent('에이전트를 찾을 수 없어요')
    expect(location()).toBe('/settings/agents/999')
  })
})
