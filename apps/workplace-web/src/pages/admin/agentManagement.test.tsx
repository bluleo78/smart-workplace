// 설정 › 에이전트 화면(/settings/agents) — 화면 컴포넌트 테스트(WP-971, WP-995).
// 목록 셀(생성일 포맷·실행 배지·키 사용 시각), 상세 드로어의 확인창(키 회수 취소·삭제·사용 중지 안내), 이름·아이디·설명 PUT,
// 실행 방식 전환(외부 연결 카드·명령 문구·409 사유·공통 비서 잠금)은 응답 → 화면, 입력 → payload 라 브라우저 없이 판정되므로
// e2e/pages/admin/agents.spec.ts · agent-runtime.spec.ts 에서 옮겼다.
// AI 아바타 바꾸기·되돌리기(WP-1222)도 입력 → multipart payload, 응답 → 목록·미리보기라 여기서 본다.
// E2E 에 남는 것: 생성 → 키 발급 → 회수 배선(@wiring), 행 키보드 진입(@input), 아이디 복사 클립보드(@platform), 375px 드로어 넘침(@layout).
// 상세 드로어·확인창이 페이지 컴포넌트 안에 있어 AgentManagementPage 를 renderScreen 으로 띄운다(앱 셸·라우트는 거치지 않는다).
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { AvatarsProvider } from '@/components/users/AvatarsProvider'
import { renderScreen } from '@/test/renderScreen'
import type { AgentResponse } from '@/types/agent'
import type { AvatarEntry } from '@/types/avatar'
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
  instructions: null,
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
    // 외부일 때 지시를 적고 내부로 바꾼 AI — 지시가 남아 있으면 칸을 보여 지울 수 있어야 한다(WP-1077).
    { ...base, id: 104, username: 'was_ext', name: '전외부봇', type: 'REGULAR', runtime: 'INTERNAL', instructions: '옛 지시' },
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
  opts: {
    runtimeConflict?: string
    deleteResult?: 'DELETED' | 'DEACTIVATED'
    extraAgents?: AgentResponse[]
    /** 개인 비서(106)의 키 목록 — 남은 키 배열, 또는 'error' 면 500(WP-1162). 없으면 빈 목록. */
    personalKeys?: (typeof KEY_1)[] | 'error'
  } = {},
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
    http.get('/api/v1/admin/agents/:id/keys', ({ params }) => {
      if (Number(params.id) === 106 && opts.personalKeys === 'error') {
        return HttpResponse.json({ message: '서버 오류' }, { status: 500 })
      }
      if (Number(params.id) === 106 && opts.personalKeys) return HttpResponse.json(opts.personalKeys)
      return HttpResponse.json(Number(params.id) === 100 ? [KEY_1] : [])
    }),
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

test('이름·아이디·설명을 바꿔 저장하면 설명 앞뒤 공백을 걷어 PUT 하고 변경 토스트를 띄운다 — 내부 AI 는 지시 칸이 없다 (WP-455, WP-1077)', async () => {
  const { user, calls } = await renderAgents()
  await openDrawer(user, 100)
  const name = await screen.findByTestId('agent-name-input')
  await user.clear(name)
  await user.paste('내부봇 v2')
  const username = screen.getByTestId('agent-username-input')
  await user.clear(username)
  await user.paste('ai-dev-v2')
  // 내부 AI 는 지시를 읽지 않으므로 지시 칸이 없고, 저장해도 지시를 보내지 않는다(WP-1077).
  expect(screen.queryByTestId('agent-instructions-input')).not.toBeInTheDocument()
  await user.click(screen.getByLabelText('설명(역할)'))
  await user.paste('  코드 리뷰를 맡습니다.  ')
  await user.click(screen.getByTestId('agent-identity-save'))

  expect(await screen.findByText('에이전트를 변경했습니다')).toBeInTheDocument()
  expect(calls.puts).toEqual([{ username: 'ai-dev-v2', name: '내부봇 v2', description: '코드 리뷰를 맡습니다.' }])
})

test('외부 AI 는 지시 칸이 보이고 앞뒤 공백을 걷어 PUT 한다 (WP-1077)', async () => {
  const { user, calls } = await renderAgents()
  await openDrawer(user, 101)
  const instructions = await screen.findByLabelText('지시')
  expect(screen.getByText(/이 AI 가 이슈를 맡을 때마다 따르는 규칙입니다/)).toBeInTheDocument()
  await user.click(instructions)
  await user.paste('  - 기획 이슈는 다른 서비스 사례를 조사해 근거를 붙인다.\n')
  await user.click(screen.getByTestId('agent-identity-save'))

  expect(await screen.findByText('에이전트를 변경했습니다')).toBeInTheDocument()
  expect(calls.puts).toEqual([
    {
      username: 'ext_bot',
      name: '외부봇',
      description: '',
      instructions: '- 기획 이슈는 다른 서비스 사례를 조사해 근거를 붙인다.',
    },
  ])
})

test('내부 AI 라도 적힌 지시가 있으면 칸과 「읽지 않는다」 안내를 보이고, 비워 저장하면 빈 지시를 보낸다 (WP-1077)', async () => {
  const { user, calls } = await renderAgents()
  await openDrawer(user, 104)
  const instructions = await screen.findByLabelText('지시')
  expect(instructions).toHaveValue('옛 지시')
  expect(screen.getByText('서버에서 실행하는 AI 는 지시를 읽지 않습니다. 외부로 바꾸면 다시 따릅니다.')).toBeInTheDocument()
  await user.clear(instructions)
  await user.click(screen.getByTestId('agent-identity-save'))

  expect(await screen.findByText('에이전트를 변경했습니다')).toBeInTheDocument()
  expect(calls.puts).toEqual([{ username: 'was_ext', name: '전외부봇', description: '', instructions: '' }])
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
  // 동작 안내는 PR 흐름이다 — 옛 「main 머지까지·push 는 하지 않아요」가 남지 않고 GitHub 준비를 알린다(WP-1151).
  expect(within(card).getByTestId('agent-work-loop-flow')).toHaveTextContent('이슈 브랜치를 push 해 GitHub PR 을 만들고')
  expect(within(card).getByTestId('agent-work-loop-flow')).toHaveTextContent('main 직접 push·배포는 하지 않아요')
  expect(within(card).getByTestId('agent-work-loop-github')).toHaveTextContent('GH_TOKEN')
  expect(card).not.toHaveTextContent('main 머지까지')
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
  const personal: AgentResponse = { ...base, id: 106, username: '__assistant_u7', name: '홍길동의 비서', type: 'PERSONAL', runtime: 'INTERNAL', ownerName: '홍길동' }
  const { user } = await renderAgents({ extraAgents: [personal] })
  const drawer = await openDrawer(user, 106)
  await within(drawer).findByTestId('agent-delete-106')
  expect(within(drawer).queryByTestId('agent-access-sections')).not.toBeInTheDocument()
  expect(within(drawer).queryByRole('switch', { name: '활성 상태' })).not.toBeInTheDocument()
  expect(within(drawer).queryByText('역할 할당')).not.toBeInTheDocument()
})

// WP-1153: 관리자가 개인 비서에게 키를 받으면 그 신원으로 주인의 개인 작업을 읽을 수 있었다 — 발급 폼 대신 안내만 보이고, 키 목록은 남는다.
test('개인 비서 상세에는 키 발급 폼 대신 안내가 보이고 키 목록은 그대로다 (WP-1153)', async () => {
  const personal: AgentResponse = { ...base, id: 106, username: '__assistant_u7', name: '홍길동의 비서', type: 'PERSONAL', runtime: 'INTERNAL', ownerName: '홍길동' }
  const { user } = await renderAgents({ extraAgents: [personal] })
  const drawer = await openDrawer(user, 106)
  const keys = await within(drawer).findByTestId('agent-keys-block')
  expect(within(keys).getByTestId('key-issue-personal-hint')).toHaveTextContent('개인 비서의 키는 관리자가 발급할 수 없어요')
  expect(within(keys).queryByTestId('key-issue-form')).not.toBeInTheDocument()
  expect(within(keys).queryByRole('button', { name: '키 발급' })).not.toBeInTheDocument()
  expect(await within(keys).findByText('키가 없습니다')).toBeInTheDocument()
  // 키가 없으면 회수 안내를 붙이지 않는다.
  expect(within(keys).getByTestId('key-issue-personal-hint')).not.toHaveTextContent('회수')
})

// WP-1162: 개인 비서의 남은 키는 인증되지 않으니 표에서 「활성」처럼 보이지 않게 「사용 불가」로 적고, 회수 안내를 붙인다.
test('개인 비서의 남은 키는 「사용 불가」로 보이고 회수 안내가 붙는다 (WP-1162)', async () => {
  const personal: AgentResponse = { ...base, id: 106, username: '__assistant_u7', name: '홍길동의 비서', type: 'PERSONAL', runtime: 'INTERNAL', ownerName: '홍길동' }
  const legacy = { ...KEY_1, id: 7, userId: 106, keyPrefix: 'ak_legacy0' }
  const { user } = await renderAgents({ extraAgents: [personal], personalKeys: [legacy] })
  const drawer = await openDrawer(user, 106)
  const keys = await within(drawer).findByTestId('agent-keys-block')
  expect(await within(keys).findByTestId('key-unusable-7')).toHaveTextContent('사용 불가')
  expect(within(keys).getByTestId('key-revoke-7')).toBeInTheDocument()
  expect(within(keys).getByTestId('key-issue-personal-hint')).toHaveTextContent('회수해 정리하세요')
})

// WP-1162: 목록을 못 불러오면 남은 키가 있는지 모르니 회수 안내를 숨기지 않는다(전에는 빈 목록으로 보고 숨겼다).
test('개인 비서 키 목록을 불러오지 못해도 회수 안내가 보인다 (WP-1162)', async () => {
  const personal: AgentResponse = { ...base, id: 106, username: '__assistant_u7', name: '홍길동의 비서', type: 'PERSONAL', runtime: 'INTERNAL', ownerName: '홍길동' }
  const { user } = await renderAgents({ extraAgents: [personal], personalKeys: 'error' })
  const drawer = await openDrawer(user, 106)
  const keys = await within(drawer).findByTestId('agent-keys-block')
  expect(within(keys).getByTestId('key-issue-personal-hint')).toHaveTextContent('회수해 정리하세요')
})

// 일반 AI 의 회수 안 된 키는 회수 칸이 비어 있고 「사용 불가」가 붙지 않는다.
test('일반 AI 의 키에는 「사용 불가」가 붙지 않는다 (WP-1162)', async () => {
  const { user } = await renderAgents()
  await openDrawer(user, 100)
  await screen.findByTestId('key-revoke-1')
  expect(screen.queryByTestId('key-unusable-1')).not.toBeInTheDocument()
})

// ── AI 아바타(WP-1222) ─────────────────────────────────────────────────────────────
// 관리자가 AI 상세에서 아바타를 바꾸고 되돌린다 — 내 아바타와 같은 자르기 창, API 만 /admin/agents/{id}/avatar.
// 아바타 표(GET /users/avatars)는 앱 루트의 AvatarsProvider 가 받으므로 화면을 그것으로 감싼다.

/** 아바타 표 + AI 아바타 쓰기 API — 표는 쓰기 뒤 다시 받으면 바뀐 값을 준다. 쓰기 요청과 multipart 글자 필드를 모은다. */
function agentAvatarApi(initial: AvatarEntry[], listFailsAfterWrite = false) {
  let avatars = [...initial]
  const writes: { method: string; id: number; fields: Record<string, string> }[] = []
  let listReads = 0
  const handlers = [
    http.get('/api/v1/users/avatars', () => {
      listReads += 1
      // listFailsAfterWrite — 저장 뒤 표 다시 받기가 실패하는 경우(저장 자체는 성공).
      if (listFailsAfterWrite && writes.length > 0) return HttpResponse.json({ message: 'boom' }, { status: 500 })
      return HttpResponse.json(avatars)
    }),
    http.put('/api/v1/admin/agents/:id/avatar', async ({ params, request }) => {
      const fields: Record<string, string> = {}
      ;(await request.formData()).forEach((v, k) => {
        fields[k] = typeof v === 'string' ? v : 'FILE'
      })
      const id = Number(params.id)
      writes.push({ method: 'PUT', id, fields })
      avatars = [...avatars.filter((a) => a.userId !== id), { userId: id, avatarUrl: `/api/v1/avatars/${id}/new` }]
      return HttpResponse.json({ avatarUrl: `/api/v1/avatars/${id}/new` })
    }),
    http.delete('/api/v1/admin/agents/:id/avatar', ({ params }) => {
      const id = Number(params.id)
      writes.push({ method: 'DELETE', id, fields: {} })
      avatars = avatars.filter((a) => a.userId !== id)
      return new HttpResponse(null, { status: 204 })
    }),
  ]
  return { handlers, writes, listReads: () => listReads }
}

async function renderAgentsWithAvatars(
  initial: AvatarEntry[],
  opts: Parameters<typeof agentApi>[0] = {},
  listFailsAfterWrite = false,
) {
  const api = agentApi(opts)
  const av = agentAvatarApi(initial, listFailsAfterWrite)
  const view = renderScreen(
    <AvatarsProvider>
      <AgentManagementPage />
    </AvatarsProvider>,
    // 아바타 표를 앞에 — 뒤의 `/users/:id`(계정 상세)가 `/users/avatars` 를 id 로 잡지 않게.
    { path: '/settings/agents', handlers: [...av.handlers, ...api.handlers] },
  )
  await screen.findByTestId('agent-row-100')
  return { ...view, ...av }
}

test('AI 아바타 — 목록·상세에 올린 이미지가 보이고, 바꾸면 자른 영역과 함께 관리자 API 로 올린 뒤 표를 다시 받는다 (WP-1222)', async () => {
  const { user, writes, listReads } = await renderAgentsWithAvatars([{ userId: 101, avatarUrl: '/api/v1/avatars/101/h' }])
  // 이미지가 있는 AI(101)는 목록 칸에 이미지(28px → 64 벌), 없는 AI(100)는 첫 글자.
  await waitFor(() => expect(screen.getByTestId('agent-avatar-101').querySelector('img')).toHaveAttribute('src', '/api/v1/avatars/101/h/64'))
  expect(screen.getByTestId('agent-avatar-100').querySelector('img')).toBeNull()
  expect(screen.getByTestId('agent-avatar-100')).toHaveTextContent('내')

  const drawer = await openDrawer(user, 100)
  const section = within(drawer).getByTestId('agent-avatar-section')
  expect(within(section).queryByRole('button', { name: '기본으로 되돌리기' })).not.toBeInTheDocument()
  await user.upload(within(section).getByLabelText('아바타 이미지 파일'), new File(['png'], 'bot.png', { type: 'image/png' }))
  const img = await screen.findByTestId('avatar-crop-image')
  Object.defineProperty(img, 'naturalWidth', { value: 300 })
  Object.defineProperty(img, 'naturalHeight', { value: 500 })
  fireEvent.load(img)
  const readsBefore = listReads()
  await user.click(within(screen.getByTestId('avatar-crop-dialog')).getByRole('button', { name: '저장' }))

  await waitFor(() => expect(writes).toHaveLength(1))
  // 300×500 의 가운데 정사각 = (0, 100) 에서 300.
  expect(writes[0]).toEqual({ method: 'PUT', id: 100, fields: { file: 'FILE', cropX: '0', cropY: '100', cropSize: '300' } })
  expect(await screen.findByText('아바타를 바꿨습니다.')).toBeInTheDocument()
  // 표를 다시 받아 미리보기·목록이 새 이미지가 된다.
  await waitFor(() => expect(listReads()).toBeGreaterThan(readsBefore))
  await waitFor(() =>
    expect(within(section).getByTestId('agent-avatar-preview').querySelector('img')).toHaveAttribute('src', '/api/v1/avatars/100/new/256'),
  )
  expect(within(section).getByRole('button', { name: '기본으로 되돌리기' })).toBeInTheDocument()
})

test('AI 아바타 — 저장 뒤 표 다시 받기가 실패해도 저장된 것으로 보고 창을 닫는다 (WP-1222)', async () => {
  const { user, writes, listReads } = await renderAgentsWithAvatars([], {}, true)
  const drawer = await openDrawer(user, 100)
  const section = within(drawer).getByTestId('agent-avatar-section')
  await user.upload(within(section).getByLabelText('아바타 이미지 파일'), new File(['png'], 'bot.png', { type: 'image/png' }))
  const img = await screen.findByTestId('avatar-crop-image')
  Object.defineProperty(img, 'naturalWidth', { value: 300 })
  Object.defineProperty(img, 'naturalHeight', { value: 300 })
  fireEvent.load(img)
  const readsBefore = listReads()
  await user.click(within(screen.getByTestId('avatar-crop-dialog')).getByRole('button', { name: '저장' }))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(await screen.findByText('아바타를 바꿨습니다.')).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByTestId('avatar-crop-dialog')).not.toBeInTheDocument())
  expect(listReads()).toBeGreaterThan(readsBefore)
  expect(screen.queryByText('아바타를 바꾸지 못했습니다.')).not.toBeInTheDocument()
})

test('AI 아바타 되돌리기 — DELETE 후 첫 글자로 돌아간다 (WP-1222)', async () => {
  const { user, writes } = await renderAgentsWithAvatars([{ userId: 101, avatarUrl: '/api/v1/avatars/101/h' }])
  const drawer = await openDrawer(user, 101)
  const section = within(drawer).getByTestId('agent-avatar-section')
  await user.click(await within(section).findByRole('button', { name: '기본으로 되돌리기' }))
  await waitFor(() => expect(writes).toEqual([{ method: 'DELETE', id: 101, fields: {} }]))
  expect(await screen.findByText('기본 아바타로 되돌렸습니다.')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByTestId('agent-avatar-101').querySelector('img')).toBeNull())
  expect(within(section).queryByRole('button', { name: '기본으로 되돌리기' })).not.toBeInTheDocument()
})

test('개인 비서는 주인 전용이라 아바타 섹션이 없다 (WP-1222)', async () => {
  const personal: AgentResponse = { ...base, id: 106, username: '__assistant_u7', name: '홍길동의 비서', type: 'PERSONAL', runtime: 'INTERNAL', ownerName: '홍길동' }
  const { user } = await renderAgentsWithAvatars([], { extraAgents: [personal] })
  const drawer = await openDrawer(user, 106)
  await within(drawer).findByTestId('agent-keys-block')
  expect(within(drawer).queryByTestId('agent-avatar-section')).not.toBeInTheDocument()
  // 일반 AI 에는 있다.
  await user.keyboard('{Escape}')
  const other = await openDrawer(user, 100)
  expect(within(other).getByTestId('agent-avatar-section')).toBeInTheDocument()
})
