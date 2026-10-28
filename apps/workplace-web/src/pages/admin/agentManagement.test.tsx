// 설정 › 에이전트 화면(/settings/agents) — 화면 컴포넌트 테스트(WP-971, WP-995).
// 목록 셀(생성일 포맷·실행 배지·키 사용 시각), 상세 드로어의 확인창(키 회수 취소·삭제·사용 중지 안내), 이름·아이디·설명 PUT,
// 실행 방식 전환(외부 연결 카드·명령 문구·409 사유·공통 비서 잠금)은 응답 → 화면, 입력 → payload 라 브라우저 없이 판정되므로
// e2e/pages/admin/agents.spec.ts · agent-runtime.spec.ts 에서 옮겼다.
// E2E 에 남는 것: 생성 → 키 발급 → 회수 배선(@wiring), 행 키보드 진입(@input), 아이디 복사 클립보드(@platform), 375px 드로어 넘침(@layout).
// 상세 드로어·확인창이 페이지 컴포넌트 안에 있어 AgentManagementPage 를 renderScreen 으로 띄운다(앱 셸·라우트는 거치지 않는다).
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { renderScreen } from '@/test/renderScreen'
import type { AgentResponse } from '@/types/agent'
import type { RoleResponse } from '@/types/role'

import { createRole, createUserDetail } from '../../../e2e/factories/auth.factory'
import AgentManagementPage from './AgentManagementPage'

const base = {
  email: null,
  isActive: true,
  createdAt: '2026-05-20T09:00:00Z',
  ownerName: null,
  lastKeyUsedAt: null,
  description: null,
} as const

// 일반 내부 1 · 외부(5분 전 키 사용) 1 · 외부(키 미사용) 1 · 공통 비서 1.
function makeAgents(): AgentResponse[] {
  return [
    { ...base, id: 100, username: 'ai-dev', name: '내부봇', type: 'REGULAR', runtime: 'INTERNAL' },
    {
      ...base,
      id: 101,
      username: 'ext_bot',
      name: '외부봇',
      type: 'REGULAR',
      runtime: 'EXTERNAL',
      lastKeyUsedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    },
    { ...base, id: 102, username: 'ext_new', name: '외부신규', type: 'REGULAR', runtime: 'EXTERNAL' },
    { ...base, id: 103, username: 'ws_bot', name: '공통봇', type: 'WORKSPACE', runtime: 'INTERNAL' },
  ]
}

const KEY_1 = {
  id: 1,
  userId: 100,
  keyPrefix: 'ak_test1',
  label: 'worker-1',
  createdBy: 1,
  createdAt: '2026-05-20T09:00:00Z',
  lastUsedAt: null,
  revokedAt: null,
}

// 역할 목록 — AI 에게 줄 수 없는 ADMIN·관리 권한 역할(grantsAdmin)과 사람 전용 USER 가 섞였다(WP-728).
const ROLES: RoleResponse[] = [
  createRole({ id: 1, name: 'USER', description: '일반 사용자', isSystem: true }),
  { ...createRole({ id: 2, name: 'ADMIN', description: '시스템 관리자', isSystem: true }), grantsAdmin: true },
  createRole({ id: 3, name: 'AGENT', description: 'AI 에이전트', isSystem: true }),
  { ...createRole({ id: 4, name: 'HR', description: '인사', isSystem: false }), grantsAdmin: true },
  createRole({ id: 5, name: 'VIEWER', description: '보기 전용', isSystem: false }),
]

type Calls = {
  revokes: number
  deletes: number
  puts: unknown[]
  runtimes: unknown[]
  roleSaves: unknown[]
  actives: unknown[]
  agentListReads: number
}

/**
 * 에이전트 화면이 부르는 API — 목록은 runtime PUT 을 반영해 재조회에 보인다.
 * runtimeConflict 면 runtime PUT 이 409, deleteResult 는 DELETE 결과(DELETED/DEACTIVATED). 쓰기 요청은 calls 에 모은다.
 */
function agentApi(
  opts: { runtimeConflict?: string; deleteResult?: 'DELETED' | 'DEACTIVATED'; extraAgents?: AgentResponse[] } = {},
) {
  let agents = [...makeAgents(), ...(opts.extraAgents ?? [])]
  const calls: Calls = { revokes: 0, deletes: 0, puts: [], runtimes: [], roleSaves: [], actives: [], agentListReads: 0 }
  // 에이전트 상세의 역할·활성 상태(WP-1075)는 계정 상세(/users/:id)를 읽는다 — 활성 PUT 을 반영한다.
  const accountOf = (id: number) => {
    const a = agents.find((x) => x.id === id)!
    return createUserDetail({ id, username: a.username, name: a.name, kind: 'AGENT', isActive: a.isActive, roles: [ROLES[2]] })
  }
  const handlers = [
    http.get('/api/v1/admin/agents', () => {
      calls.agentListReads += 1
      return HttpResponse.json(agents)
    }),
    http.get('/api/v1/users/:id', ({ params }) => HttpResponse.json(accountOf(Number(params.id)))),
    http.get('/api/v1/roles', () => HttpResponse.json(ROLES)),
    http.put('/api/v1/users/:id/roles', async ({ request }) => {
      calls.roleSaves.push(await request.json())
      return new HttpResponse(null, { status: 204 })
    }),
    http.put('/api/v1/users/:id/active', async ({ params, request }) => {
      const body = (await request.json()) as { active: boolean }
      calls.actives.push(body)
      agents = agents.map((a) => (a.id === Number(params.id) ? { ...a, isActive: body.active } : a))
      return new HttpResponse(null, { status: 204 })
    }),
    http.put('/api/v1/admin/agents/:id/runtime', async ({ params, request }) => {
      const body = (await request.json()) as { runtime: AgentResponse['runtime'] }
      calls.runtimes.push(body)
      if (opts.runtimeConflict) return HttpResponse.json({ message: opts.runtimeConflict }, { status: 409 })
      agents = agents.map((a) => (a.id === Number(params.id) ? { ...a, runtime: body.runtime } : a))
      return new HttpResponse(null, { status: 204 })
    }),
    http.put('/api/v1/admin/agents/:id', async ({ request }) => {
      calls.puts.push(await request.json())
      return new HttpResponse(null, { status: 204 })
    }),
    http.delete('/api/v1/admin/agents/:id', () => {
      calls.deletes += 1
      return HttpResponse.json({ result: opts.deleteResult ?? 'DELETED' })
    }),
    http.get('/api/v1/admin/agents/:id/keys', ({ params }) => HttpResponse.json(Number(params.id) === 100 ? [KEY_1] : [])),
    http.post('/api/v1/admin/agents/:id/keys', () =>
      HttpResponse.json({ id: 9, keyPrefix: 'ak_new', plaintextKey: 'ak_new_SECRET', label: null }),
    ),
    http.delete('/api/v1/admin/agents/:id/keys/:keyId', () => {
      calls.revokes += 1
      return new HttpResponse(null, { status: 204 })
    }),
    http.get('/api/v1/admin/agents/:id/provider-credential', () => HttpResponse.json({ message: '없음' }, { status: 404 })),
    // 공통 비서(103) 상세는 모델 목록을 부른다.
    http.get('/api/v1/admin/agents/:id/models', () => HttpResponse.json({ models: [] })),
    http.get('/api/v1/admin/workspace-assistant', () =>
      HttpResponse.json({ agentUserId: 103, agentName: '공통봇', hasActiveToken: true, model: null, thinkingDepth: null }),
    ),
  ]
  return { calls, handlers }
}

/** 화면을 띄우고 목록이 보일 때까지 기다린다. */
async function renderAgents(opts: Parameters<typeof agentApi>[0] = {}) {
  const api = agentApi(opts)
  const view = renderScreen(<AgentManagementPage />, { path: '/settings/agents', handlers: api.handlers })
  await screen.findByTestId('agent-row-100')
  return { ...view, calls: api.calls }
}

/** 행을 눌러 상세 드로어를 연다. */
async function openDrawer(user: ReturnType<typeof renderScreen>['user'], id: number) {
  await user.click(screen.getByTestId(`agent-row-${id}`))
  return screen.findByTestId('agent-detail-drawer')
}

test('목록 — 생성일은 zero-pad 하이픈, 실행 배지는 내부/외부, 외부만 키 사용 시각을 보인다', async () => {
  await renderAgents()
  // #617: 로케일 기본(2026. 5. 20.)이 아니라 공용 formatDateOnly.
  const row = screen.getByTestId('agent-row-100')
  expect(row).toHaveTextContent('2026-05-20')
  expect(row.textContent).not.toMatch(/\d{4}\.\s?\d{1,2}\.\s?\d{1,2}\.?/)

  expect(screen.getByTestId('agent-runtime-cell-100')).toHaveTextContent('내부')
  expect(screen.getByTestId('agent-runtime-cell-101')).toHaveTextContent('외부')
  expect(screen.getByTestId('agent-key-status-101')).toHaveTextContent('키 사용 5분 전')
  expect(screen.getByTestId('agent-key-status-102')).toHaveTextContent('키 미사용')
  expect(screen.queryByTestId('agent-key-status-100')).not.toBeInTheDocument()
})

test('키 회수 확인창에서 취소하면 DELETE 가 없고 회수 버튼이 남는다 (#136)', async () => {
  const { user, calls } = await renderAgents()
  await openDrawer(user, 100)
  await user.click(await screen.findByTestId('key-revoke-1'))
  await user.click(within(await screen.findByTestId('agent-confirm-dialog')).getByTestId('agent-confirm-cancel'))
  await waitFor(() => expect(screen.queryByTestId('agent-confirm-dialog')).not.toBeInTheDocument())
  expect(calls.revokes).toBe(0)
  expect(screen.getByTestId('key-revoke-1')).toBeInTheDocument()
})

test('에이전트 삭제 — 확인창 문구(조사·사용 중지 안내) 뒤 DELETE 1회와 삭제 토스트', async () => {
  const { user, calls } = await renderAgents()
  await openDrawer(user, 100)
  await user.click(screen.getByTestId('agent-delete-100'))
  const dialog = await screen.findByTestId('agent-confirm-dialog')
  // 조사는 이름 받침에 맞춘다 — 「내부봇」은 받침 있음 → 「을」(WP-679). 기록이 있으면 사용 중지한다고 미리 알린다(WP-705).
  expect(dialog).toHaveTextContent('에이전트 "내부봇"을 삭제하시겠습니까?')
  expect(dialog).toHaveTextContent('이 AI 가 남긴 기록이 있으면 기록은 두고 사용을 중지합니다.')
  await user.click(within(dialog).getByTestId('agent-confirm-confirm'))

  expect(await screen.findByText('에이전트를 삭제했습니다')).toBeInTheDocument()
  expect(calls.deletes).toBe(1)
})

test('기록이 남아 서버가 사용 중지(DEACTIVATED)하면 삭제 대신 사용 중지 토스트를 띄운다 (WP-705)', async () => {
  const { user, calls } = await renderAgents({ deleteResult: 'DEACTIVATED' })
  await openDrawer(user, 100)
  await user.click(screen.getByTestId('agent-delete-100'))
  await user.click(await screen.findByTestId('agent-confirm-confirm'))

  expect(await screen.findByText('남은 기록이 있어 삭제 대신 사용을 중지했습니다')).toBeInTheDocument()
  expect(calls.deletes).toBe(1)
  expect(screen.queryByText('에이전트를 삭제했습니다')).not.toBeInTheDocument()
})

test('이름·아이디·설명을 바꿔 저장하면 설명 앞뒤 공백을 걷어 PUT 하고 변경 토스트를 띄운다 (WP-455)', async () => {
  const { user, calls } = await renderAgents()
  await openDrawer(user, 100)
  const name = await screen.findByTestId('agent-name-input')
  await user.clear(name)
  await user.paste('내부봇 v2')
  const username = screen.getByTestId('agent-username-input')
  await user.clear(username)
  await user.paste('ai-dev-v2')
  await user.click(screen.getByLabelText('설명(역할)'))
  await user.paste('  코드 리뷰를 맡습니다.  ')
  await user.click(screen.getByTestId('agent-identity-save'))

  expect(await screen.findByText('에이전트를 변경했습니다')).toBeInTheDocument()
  expect(calls.puts).toEqual([{ username: 'ai-dev-v2', name: '내부봇 v2', description: '코드 리뷰를 맡습니다.' }])
})

test('내부 → 외부로 바꾸면 AI 연결 대신 외부 연결 카드(설치·로그인·전환·work-loop 명령)가 보이고 키 발급창엔 평문 키 명령이 없다', async () => {
  const { user, calls } = await renderAgents()
  await openDrawer(user, 100)
  expect(await screen.findByTestId('agent-connection-section')).toBeInTheDocument()
  expect(screen.queryByTestId('external-connect-card')).not.toBeInTheDocument()

  await user.click(screen.getByTestId('agent-runtime-EXTERNAL'))
  const card = await screen.findByTestId('external-connect-card')
  expect(calls.runtimes).toEqual([{ runtime: 'EXTERNAL' }])
  expect(screen.queryByTestId('agent-connection-section')).not.toBeInTheDocument()
  // ② 플러그인 설치 ③ 이 AI 등록 ④ 이 AI로 일하기(WP-378) — 키·토큰이 든 명령은 없다.
  // 두 줄 명령 — toHaveTextContent 는 줄바꿈을 공백으로 접으므로 원문을 그대로 비교한다.
  expect(within(card).getByTestId('plugin-install-command').textContent).toBe(
    `/plugin marketplace add ${window.location.origin}/claude/marketplace.json\n/plugin install genia-works@genia-works`,
  )
  expect(within(card).getByTestId('agent-login-command')).toHaveTextContent('/genia-works:login')
  expect(within(card).getByTestId('agent-switch-command')).toHaveTextContent('/genia-works:as ai-dev')
  expect(within(card).getByTestId('agent-launch-as-command')).toHaveTextContent('GENIA_WORKS_AS=ai-dev claude')
  // ⑤ 자동으로 이슈 처리(WP-376) — work-loop 시작 명령 두 줄과 이슈 하나만 맡기는 안내.
  expect(within(card).getByTestId('agent-work-loop-launch-command')).toHaveTextContent(
    'GENIA_WORKS_AS=ai-dev claude --permission-mode bypassPermissions',
  )
  expect(within(card).getByTestId('agent-work-loop-start-command')).toHaveTextContent('/loop /genia-works:work-loop <프로젝트 키>')
  expect(within(card).getByTestId('agent-work-loop')).toHaveTextContent('/genia-works:work-on')
  // 다른 방법은 접혀 있다 — 펼쳐야 키를 직접 넘기는 명령이 보인다.
  expect(screen.queryByTestId('agent-fallback-command')).not.toBeInTheDocument()
  await user.click(screen.getByTestId('agent-fallback'))
  expect(await screen.findByTestId('agent-fallback-command')).toHaveTextContent('GENIA_WORKS_TOKEN=<발급한 키> claude')
  expect(screen.getByPlaceholderText('label (예: 맥북)')).toBeInTheDocument()

  // 키 발급 다이얼로그에는 로그인 안내만 있고 평문 키가 든 명령은 없다.
  await user.click(within(screen.getByTestId('key-issue-form')).getByRole('button', { name: '키 발급' }))
  const keyDialog = await screen.findByTestId('agent-key-issue-dialog')
  expect(within(keyDialog).getByTestId('agent-key-login-guide')).toHaveTextContent('/genia-works:login')
  expect(within(keyDialog).getByTestId('agent-key-login-guide')).toHaveTextContent('ai-dev')
  expect(keyDialog).not.toHaveTextContent('GENIA_WORKS_TOKEN=ak_')
  expect(within(keyDialog).getByRole('button', { name: '키 복사' })).toBeInTheDocument()
})

test('실행 방식 변경이 409 면 서버 사유를 보이고 외부 카드로 바뀌지 않는다', async () => {
  const { user } = await renderAgents({ runtimeConflict: '공통 비서로 지정된 AI는 외부로 바꿀 수 없습니다' })
  await openDrawer(user, 100)
  await user.click(await screen.findByTestId('agent-runtime-EXTERNAL'))
  expect(await screen.findByText('공통 비서로 지정된 AI는 외부로 바꿀 수 없습니다')).toBeInTheDocument()
  expect(screen.queryByTestId('external-connect-card')).not.toBeInTheDocument()
})

test('공통 비서는 실행 방식 두 버튼이 모두 비활성이고 해제 먼저라는 사유가 보인다', async () => {
  const { user } = await renderAgents()
  await openDrawer(user, 103)
  expect(await screen.findByTestId('agent-runtime-EXTERNAL')).toBeDisabled()
  expect(screen.getByTestId('agent-runtime-INTERNAL')).toBeDisabled()
  expect(screen.getByTestId('agent-runtime-description')).toHaveTextContent('비서 지정을 먼저 해제하세요')
})

// ── WP-1075: 역할 할당·활성 상태가 구성원 화면에서 에이전트 상세로 옮겨 왔다 ──

test('일반 에이전트 상세 — AI 에게 줄 수 없는 역할은 빠지고, 고른 역할을 저장하면 roleIds 로 PUT 한다 (WP-1075·WP-728)', async () => {
  const { user, calls } = await renderAgents()
  const drawer = await openDrawer(user, 100)
  const access = await within(drawer).findByTestId('agent-access-sections')
  expect(within(access).getByText('AI 에게는 관리자 역할이나 관리 권한이 든 역할을 줄 수 없어요', { exact: false })).toBeInTheDocument()
  // 보이는 역할: USER·AGENT·VIEWER, 숨는 역할: ADMIN·HR(관리 권한).
  for (const id of [1, 3, 5]) expect(document.getElementById(`role-${id}`)).toBeInTheDocument()
  for (const id of [2, 4]) expect(document.getElementById(`role-${id}`)).not.toBeInTheDocument()

  await user.click(within(access).getByRole('checkbox', { name: /VIEWER/ }))
  await user.click(within(access).getByRole('button', { name: '역할 저장' }))
  await waitFor(() => expect(calls.roleSaves).toEqual([{ roleIds: [3, 5] }]))
  expect(await screen.findByText('역할이 저장되었습니다.')).toBeInTheDocument()
})

test('일반 에이전트 상세 — 활성 끄기는 AI 문구의 확인창을 거쳐 active=false 로 저장되고, 목록에 「비활성」 배지와 연결 대신 안내가 보인다 (WP-1075)', async () => {
  const { user, calls } = await renderAgents()
  expect(screen.queryByTestId('agent-inactive-100')).not.toBeInTheDocument()
  const drawer = await openDrawer(user, 100)
  const access = await within(drawer).findByTestId('agent-access-sections')
  expect(within(access).getByText('비활성 AI 는 이 워크스페이스에 접속하거나 일할 수 없어요. 다른 워크스페이스에는 영향이 없어요.')).toBeInTheDocument()
  const readsBefore = calls.agentListReads

  await user.click(within(access).getByRole('switch', { name: '활성 상태' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog).toHaveTextContent('에이전트 비활성화')
  expect(dialog).toHaveTextContent('비활성화하면 이 AI 는 이 워크스페이스에 접속하거나 일할 수 없어요.')
  await user.click(within(dialog).getByRole('button', { name: '비활성화' }))

  await waitFor(() => expect(calls.actives).toEqual([{ active: false }]))
  // 목록을 다시 읽어 배지가 바로 붙고, 상세는 키·연결 대신 안내를 보인다(정지된 AI 에 키 발급 방지).
  expect(await screen.findByTestId('agent-inactive-100')).toHaveTextContent('비활성')
  expect(calls.agentListReads).toBeGreaterThan(readsBefore)
  expect(await within(drawer).findByTestId('agent-inactive-notice')).toBeInTheDocument()
  expect(within(drawer).queryByTestId('key-revoke-1')).not.toBeInTheDocument()
  expect(within(access).getByRole('switch', { name: '활성 상태' })).not.toBeChecked()
})

test('공통 비서 상세 — 활성 스위치는 막혀 있고 지정 해제가 먼저라는 이유가 보인다 (WP-1075)', async () => {
  const { user, calls } = await renderAgents()
  const drawer = await openDrawer(user, 103)
  const access = await within(drawer).findByTestId('agent-access-sections')
  const toggle = within(access).getByRole('switch', { name: '활성 상태' })
  expect(toggle).toBeChecked()
  expect(toggle).toBeDisabled()
  expect(within(access).getByText('공통 비서는 지정을 해제한 뒤 비활성화할 수 있어요.')).toBeInTheDocument()
  expect(calls.actives).toEqual([])
})

test('비활성 에이전트는 목록에 배지가 보이고, 상세에서 켜면 확인창 없이 active=true 로 저장된다 (WP-1075·WP-705)', async () => {
  const stopped: AgentResponse = { ...base, id: 105, username: 'old_bot', name: '중지봇', type: 'REGULAR', runtime: 'INTERNAL', isActive: false }
  const { user, calls } = await renderAgents({ extraAgents: [stopped] })
  expect(screen.getByTestId('agent-inactive-105')).toHaveTextContent('비활성')
  expect(screen.queryByTestId('agent-inactive-100')).not.toBeInTheDocument()

  const drawer = await openDrawer(user, 105)
  const access = await within(drawer).findByTestId('agent-access-sections')
  await user.click(within(access).getByRole('switch', { name: '활성 상태' }))
  await waitFor(() => expect(calls.actives).toEqual([{ active: true }]))
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  await waitFor(() => expect(screen.queryByTestId('agent-inactive-105')).not.toBeInTheDocument())
})

test('개인 비서 상세에는 역할 할당·활성 상태가 보이지 않는다 (WP-1075)', async () => {
  const personal: AgentResponse = { ...base, id: 104, username: '__assistant_u7', name: '홍길동의 비서', type: 'PERSONAL', runtime: 'INTERNAL', ownerName: '홍길동' }
  const { user } = await renderAgents({ extraAgents: [personal] })
  const drawer = await openDrawer(user, 104)
  await within(drawer).findByTestId('agent-delete-104')
  expect(within(drawer).queryByTestId('agent-access-sections')).not.toBeInTheDocument()
  expect(within(drawer).queryByRole('switch', { name: '활성 상태' })).not.toBeInTheDocument()
  expect(within(drawer).queryByText('역할 할당')).not.toBeInTheDocument()
})
