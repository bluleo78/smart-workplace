// 설정 › 에이전트 — 목록 탭(/settings/agents)과 상세 페이지(/settings/agents/:id) 화면 컴포넌트 테스트(WP-971, WP-995, WP-1281).
// WP-1281 에서 상세가 오른쪽 시트(드로어)에서 페이지로 바뀌었다 — 목록 셀(생성일·실행 배지·마지막 접속), 상세 섹션(상태 · 기본 정보 · 역할 · 맡은 일과 지시 ·
// 실행 · 코드 저장소 · 위험 구역)의 확인창·PUT payload, 실행 방식 카드 전환(확인 창 요약·409 사유·공통 비서 잠금), 외부 연결 방법(설정 가이드로 이동)은
// 응답 → 화면, 입력 → payload 라 브라우저 없이 판정되므로 e2e 에서 옮겼다. AI 아바타 바꾸기·되돌리기(WP-1222)도 여기서 본다.
// 상세 페이지는 라우트(:id)가 필요해 목록·상세 두 라우트를 Routes 로 묶어 renderScreen 으로 띄운다(앱 셸·가드는 거치지 않는다).
// 런모드별(기본·작업 공간·외부) 섹션 구성과 시작 막힘 사유는 agentDetailPage.test.tsx, 설정 가이드 동작은 settingsGuide.test.tsx 가 본다.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { expect, test } from 'vitest'

import { AIAssistantProvider } from '@/components/ai/AIAssistantContext'
import { AvatarsProvider } from '@/components/users/AvatarsProvider'
import { renderScreen } from '@/test/renderScreen'
import type { AgentResponse } from '@/types/agent'
import type { AvatarEntry } from '@/types/avatar'
import type { RoleResponse } from '@/types/role'

import { createRole, createUserDetail } from '../../../e2e/factories/auth.factory'
import { agentRuntimeApi } from '../../test/kits/admin/agentRuntime'
import AgentDetailPage from './AgentDetailPage'
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
    { ...base, id: 100, username: 'ai-dev', name: '내부봇', type: 'REGULAR', runtime: 'INTERNAL', runMode: 'SERVER' },
    {
      ...base,
      id: 101,
      username: 'ext_bot',
      name: '외부봇',
      type: 'REGULAR',
      runtime: 'EXTERNAL', runMode: 'EXTERNAL',
      lastKeyUsedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    },
    { ...base, id: 102, username: 'ext_new', name: '외부신규', type: 'REGULAR', runtime: 'EXTERNAL', runMode: 'EXTERNAL' },
    { ...base, id: 103, username: 'ws_bot', name: '공통봇', type: 'WORKSPACE', runtime: 'INTERNAL', runMode: 'SERVER' },
    // 외부일 때 지시를 적고 내부로 바꾼 AI — 지시가 남아 있으면 칸을 보여 지울 수 있어야 한다(WP-1077).
    { ...base, id: 104, username: 'was_ext', name: '전외부봇', type: 'REGULAR', runtime: 'INTERNAL', runMode: 'SERVER', instructions: '옛 지시' },
  ]
}

const KEY_1 = {
  id: 1,
  userId: 100,
  keyPrefix: 'ak_test1',
  label: 'worker-1' as string | null,
  createdBy: 1 as number | null,
  createdAt: '2026-05-20T09:00:00Z',
  lastUsedAt: null,
  revokedAt: null,
  managed: false,
  expiresAt: null as string | null,
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
    // 상세 페이지는 목록에서 찾지 않고 한 명을 따로 읽는다(WP-1281) — 없는 id 는 404.
    http.get('/api/v1/admin/agents/:id', ({ params }) => {
      const a = agents.find((x) => x.id === Number(params.id))
      return a ? HttpResponse.json(a) : HttpResponse.json({ message: '없음' }, { status: 404 })
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
      // 서버가 판정하는 runMode 도 같이 바뀐다 — INTERNAL → SERVER, EXTERNAL(실행 설정 없음) → EXTERNAL.
      agents = agents.map((a) => (a.id === Number(params.id) ? { ...a, runtime: body.runtime, runMode: body.runtime === 'INTERNAL' ? 'SERVER' : 'EXTERNAL' } : a))
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
    // AI 실행(WP-1245) — 목록 「실행」 열 요약·상세 실행 방식 섹션의 템플릿·설정 조회(이 화면 테스트는 실행 설정 없는 AI 만 쓴다).
    ...agentRuntimeApi().handlers,
  ]
  return { calls, handlers }
}

/** 목록 탭을 띄우고 목록이 보일 때까지 기다린다. */
async function renderAgents(opts: Parameters<typeof agentApi>[0] = {}) {
  const api = agentApi(opts)
  const view = renderScreen(<AgentManagementPage />, { path: '/settings/agents', handlers: api.handlers })
  await screen.findByTestId('agent-row-100')
  return { ...view, calls: api.calls }
}

/**
 * 목록 ↔ 상세 두 라우트 — 상세에서 목록으로 돌아가는 이동(삭제 뒤·뒤로 가기)까지 같은 화면 테스트로 본다.
 * 설정 가이드(시트)의 「AI 에게 묻기」가 AI 패널 상태를 읽으므로 AI 패널 Provider 로 감싼다.
 */
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

/** 상세 페이지를 바로 띄운다 — 페이지가 그려질 때까지 기다린다. */
async function renderDetail(id: number, opts: Parameters<typeof agentApi>[0] = {}, extra: ReturnType<typeof http.get>[] = []) {
  const api = agentApi(opts)
  const view = renderScreen(<Screens />, { path: `/settings/agents/${id}`, handlers: [...extra, ...api.handlers] })
  await screen.findByTestId('agent-detail-page')
  return { ...view, calls: api.calls }
}

const PERSONAL: AgentResponse = { ...base, id: 106, username: '__assistant_u7', name: '홍길동의 비서', type: 'PERSONAL', runtime: 'INTERNAL', runMode: 'SERVER', ownerName: '홍길동' }

test('목록 — 생성일은 zero-pad 하이픈, 실행 배지는 기본/외부, 외부만 마지막 접속 시각을 보인다', async () => {
  await renderAgents()
  // #617: 로케일 기본(2026. 5. 20.)이 아니라 공용 formatDateOnly.
  const row = screen.getByTestId('agent-row-100')
  expect(row).toHaveTextContent('2026-05-20')
  expect(row.textContent).not.toMatch(/\d{4}\.\s?\d{1,2}\.\s?\d{1,2}\.?/)

  expect(screen.getByTestId('agent-runtime-cell-100')).toHaveTextContent('기본')
  expect(screen.getByTestId('agent-runtime-cell-101')).toHaveTextContent('외부')
  expect(screen.getByTestId('agent-key-status-101')).toHaveTextContent('마지막 접속 5분 전')
  expect(screen.getByTestId('agent-key-status-102')).toHaveTextContent('아직 접속 안 함')
  expect(screen.queryByTestId('agent-key-status-100')).not.toBeInTheDocument()
})

test('목록 — 행을 누르면 상세 페이지로 가고, ‹ 목록으로 돌아가기가 목록으로 되돌린다', async () => {
  const api = agentApi()
  const { user, location } = renderScreen(<Screens />, { path: '/settings/agents', handlers: api.handlers })
  await user.click(await screen.findByTestId('agent-row-100'))
  expect(location()).toBe('/settings/agents/100')
  expect(await screen.findByTestId('agent-detail-page')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '목록으로 돌아가기' }))
  expect(location()).toBe('/settings/agents')
  expect(await screen.findByTestId('agent-row-100')).toBeInTheDocument()
})

test('키 폐기 확인창에서 취소하면 DELETE 가 없고 폐기 버튼이 남고, 확인하면 DELETE 1회 (#136)', async () => {
  const { user, calls } = await renderDetail(100)
  await user.click(await screen.findByTestId('key-revoke-1'))
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog).toHaveTextContent('키를 폐기할까요?')
  await user.click(within(dialog).getByRole('button', { name: '취소' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  expect(calls.revokes).toBe(0)
  expect(screen.getByTestId('key-revoke-1')).toBeInTheDocument()

  await user.click(screen.getByTestId('key-revoke-1'))
  await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '키 폐기' }))
  await waitFor(() => expect(calls.revokes).toBe(1))
})

test('위험 구역 · 에이전트 삭제 — 확인창 문구(조사·사용 중지 안내) 뒤 DELETE 1회, 삭제 토스트, 목록으로 돌아간다', async () => {
  const { user, calls, location } = await renderDetail(100)
  await user.click(screen.getByTestId('agent-delete-100'))
  const dialog = await screen.findByTestId('agent-confirm-dialog')
  // 조사는 이름 받침에 맞춘다 — 「내부봇」은 받침 있음 → 「을」(WP-679). 기록이 있으면 사용 중지한다고 미리 알린다(WP-705).
  expect(dialog).toHaveTextContent('내부봇을 삭제할까요?')
  expect(dialog).toHaveTextContent('이 AI 가 남긴 기록이 있으면 지우지 않고 사용 중지로 바꿔요.')
  await user.click(within(dialog).getByTestId('agent-confirm-confirm'))

  expect(await screen.findByText('에이전트를 삭제했습니다')).toBeInTheDocument()
  expect(calls.deletes).toBe(1)
  await waitFor(() => expect(location()).toBe('/settings/agents'))
})

test('기록이 남아 서버가 사용 중지(DEACTIVATED)하면 삭제 대신 사용 중지 토스트를 띄우고 상세에 머문다 (WP-705)', async () => {
  const { user, calls, location } = await renderDetail(100, { deleteResult: 'DEACTIVATED' })
  await user.click(screen.getByTestId('agent-delete-100'))
  await user.click(await screen.findByTestId('agent-confirm-confirm'))

  expect(await screen.findByText('남은 기록이 있어 삭제 대신 사용을 중지했습니다')).toBeInTheDocument()
  expect(calls.deletes).toBe(1)
  expect(screen.queryByText('에이전트를 삭제했습니다')).not.toBeInTheDocument()
  // 다시 사용으로 바꿀 수 있게 상세에 남는다.
  expect(location()).toBe('/settings/agents/100')
})

test('기본 정보 — 이름·아이디를 바꿔 저장하면 PUT 하고 변경 토스트를 띄운다 (맡은 일은 그대로 실어 보낸다)', async () => {
  const { user, calls } = await renderDetail(100)
  const name = await screen.findByTestId('agent-name-input')
  await user.clear(name)
  await user.paste('내부봇 v2')
  const username = screen.getByTestId('agent-username-input')
  await user.clear(username)
  await user.paste('ai-dev-v2')
  await user.click(screen.getByTestId('agent-identity-save'))

  expect(await screen.findByText('에이전트를 변경했습니다')).toBeInTheDocument()
  expect(calls.puts).toEqual([{ username: 'ai-dev-v2', name: '내부봇 v2', description: '' }])
})

test('맡은 일과 지시 — 맡은 일 앞뒤 공백을 걷어 PUT 하고, 기본(서버 실행) AI 는 지시 칸이 막혀 지시를 보내지 않는다 (WP-455, WP-1077)', async () => {
  const { user, calls } = await renderDetail(100)
  const duty = await screen.findByLabelText('맡은 일')
  await user.click(duty)
  await user.paste('  코드 리뷰를 맡습니다.  ')
  // 기본 방식은 지시를 읽지 않아 칸이 막히고 이유만 남는다.
  expect(screen.getByTestId('agent-instructions-input')).toBeDisabled()
  expect(screen.getByText('기본 방식은 지시를 읽지 않아요. 외부·Claude Code 로 바꾸면 따라요.')).toBeInTheDocument()
  await user.click(screen.getByTestId('agent-duty-save'))

  expect(await screen.findByText('에이전트를 변경했습니다')).toBeInTheDocument()
  expect(calls.puts).toEqual([{ username: 'ai-dev', name: '내부봇', description: '코드 리뷰를 맡습니다.' }])
})

test('외부 AI 는 지시 칸이 열려 있고 앞뒤 공백을 걷어 PUT 한다 (WP-1077)', async () => {
  const { user, calls } = await renderDetail(101)
  const instructions = await screen.findByLabelText('지시')
  expect(instructions).toBeEnabled()
  await user.click(instructions)
  await user.paste('  - 기획 이슈는 다른 서비스 사례를 조사해 근거를 붙인다.\n')
  await user.click(screen.getByTestId('agent-duty-save'))

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

// 예전엔 「내부 AI 라도 적힌 지시가 있으면 칸을 열어 비워 저장」할 수 있었다(WP-1077). WP-1281 에서 기본 방식은 칸 자체를 막고(안 읽는 값은 못 고침),
// 적힌 지시는 지우지 않고 다른 방식으로 바꾸면 다시 따르게 했다 — 그래서 지우기 대신 「보이되 막히고 저장해도 보내지 않음」을 지킨다.
test('기본 AI 에 옛 지시가 남아 있으면 칸에 보이되 막혀 있고, 다른 칸을 저장해도 지시는 보내지 않는다 (WP-1077·WP-1281)', async () => {
  const { user, calls } = await renderDetail(104)
  const instructions = await screen.findByLabelText('지시')
  expect(instructions).toHaveValue('옛 지시')
  expect(instructions).toBeDisabled()
  await user.click(screen.getByLabelText('맡은 일'))
  await user.paste('새 설명')
  await user.click(screen.getByTestId('agent-duty-save'))

  expect(await screen.findByText('에이전트를 변경했습니다')).toBeInTheDocument()
  expect(calls.puts).toEqual([{ username: 'was_ext', name: '전외부봇', description: '새 설명' }])
})

test('기본 → 외부 — 카드를 누르면 펼쳐지고 바꾸기 확인창의 요약을 거쳐 PUT 한 뒤, 접속 키 묶음과 가이드의 연결 방법이 나온다', async () => {
  const { user, calls } = await renderDetail(100)
  expect(await screen.findByTestId('agent-ai-account-group')).toBeInTheDocument()
  expect(screen.queryByTestId('external-connect-card')).not.toBeInTheDocument()

  await user.click(screen.getByTestId('agent-run-mode-EXTERNAL'))
  // 펼침만으로는 저장하지 않는다.
  expect(await screen.findByTestId('agent-run-mode-pending')).toBeInTheDocument()
  expect(calls.runtimes).toEqual([])
  await user.click(screen.getByTestId('agent-run-mode-apply'))
  const confirm = await screen.findByTestId('agent-run-mode-confirm')
  expect(confirm).toHaveTextContent('실행 방식을 외부로 바꿀까요?')
  expect(confirm).toHaveTextContent('Works 는 이 AI 의 이슈·멘션에 더는 바로 답하지 않아요.')
  expect(calls.runtimes).toEqual([])
  await user.click(within(confirm).getByTestId('agent-run-mode-confirm-apply'))

  const card = await screen.findByTestId('external-connect-card')
  expect(calls.runtimes).toEqual([{ runtime: 'EXTERNAL' }])
  expect(await screen.findByText('실행 방식을 변경했습니다')).toBeInTheDocument()
  expect(screen.queryByTestId('agent-ai-account-group')).not.toBeInTheDocument()
  // 연결 방법 ②~⑤ 는 화면 카드가 아니라 설정 가이드 단계다 — 카드에는 키 발급·표와 가이드로 가는 한 줄만.
  expect(within(card).queryByTestId('plugin-install-command')).not.toBeInTheDocument()
  expect(within(card).getByTestId('external-connect-guide-hint')).toBeInTheDocument()
  await user.click(within(card).getByTestId('external-connect-guide-open'))

  const sheet = await screen.findByTestId('settings-guide-sheet')
  // ② 플러그인 설치 ④ 이 AI 로 로그인 ⑤ 자동 이슈 처리 — 키·토큰이 든 명령은 없다.
  // 두 줄 명령 — toHaveTextContent 는 줄바꿈을 공백으로 접으므로 원문을 그대로 비교한다.
  expect(within(sheet).getByTestId('plugin-install-command').textContent).toBe(
    `/plugin marketplace add ${window.location.origin}/claude/marketplace.json\n/plugin install genia-works@genia-works`,
  )
  expect(within(sheet).getByTestId('agent-login-command')).toHaveTextContent('/genia-works:login')
  expect(within(sheet).getByTestId('agent-switch-command')).toHaveTextContent('/genia-works:as ai-dev')
  expect(within(sheet).getByTestId('agent-launch-as-command')).toHaveTextContent('GENIA_WORKS_AS=ai-dev claude')
  expect(within(sheet).getByTestId('agent-work-loop-launch-command')).toHaveTextContent(
    'GENIA_WORKS_AS=ai-dev claude --permission-mode bypassPermissions',
  )
  expect(within(sheet).getByTestId('agent-work-loop-start-command')).toHaveTextContent('/loop /genia-works:work-loop <프로젝트 키>')
  // 동작 안내는 PR 흐름이다 — 옛 「main 머지까지·push 는 하지 않아요」가 남지 않고 GitHub 준비를 알린다(WP-1151).
  expect(sheet).toHaveTextContent('이슈 브랜치를 push 해 GitHub PR 을 만들고')
  expect(sheet).toHaveTextContent('main 에 직접 push 하거나 배포하지는 않아요')
  expect(sheet).toHaveTextContent('GH_TOKEN')
  expect(sheet).not.toHaveTextContent('main 머지까지')
  // 다른 방법은 접혀 있다 — 펼쳐야 키를 직접 넘기는 명령이 보인다.
  expect(within(sheet).queryByTestId('agent-fallback-command')).not.toBeInTheDocument()
  await user.click(within(sheet).getByRole('button', { name: /다른 방법/ }))
  expect(await within(sheet).findByTestId('agent-fallback-command')).toHaveTextContent('GENIA_WORKS_TOKEN=<발급한 키> claude')
  await user.keyboard('{Escape}')

  // 키 발급 다이얼로그에는 로그인 안내만 있고 평문 키가 든 명령은 없다.
  await user.click(within(screen.getByTestId('key-issue-form')).getByRole('button', { name: '키 발급' }))
  const keyDialog = await screen.findByTestId('agent-key-issue-dialog')
  expect(within(keyDialog).getByTestId('agent-key-login-guide')).toHaveTextContent('/genia-works:login')
  expect(within(keyDialog).getByTestId('agent-key-login-guide')).toHaveTextContent('ai-dev')
  expect(keyDialog).not.toHaveTextContent('GENIA_WORKS_TOKEN=ak_')
  expect(within(keyDialog).getByRole('button', { name: '키 복사' })).toBeInTheDocument()
})

test('실행 방식 변경이 409 면 서버 사유를 보이고 외부 카드로 바뀌지 않는다', async () => {
  const { user } = await renderDetail(100, { runtimeConflict: '공통 비서로 지정된 AI는 외부로 바꿀 수 없습니다' })
  await user.click(await screen.findByTestId('agent-run-mode-EXTERNAL'))
  await user.click(screen.getByTestId('agent-run-mode-apply'))
  await user.click(within(await screen.findByTestId('agent-run-mode-confirm')).getByTestId('agent-run-mode-confirm-apply'))
  expect(await screen.findByText('공통 비서로 지정된 AI는 외부로 바꿀 수 없습니다')).toBeInTheDocument()
  expect(screen.queryByTestId('external-connect-card')).not.toBeInTheDocument()
})

test('공통 비서는 다른 실행 방식 카드가 모두 막히고 「기본」만 선택돼 있으며 해제 먼저라는 사유가 보인다', async () => {
  await renderDetail(103)
  const basic = await screen.findByTestId('agent-run-mode-SERVER')
  expect(basic).toHaveAttribute('aria-checked', 'true')
  expect(screen.getByTestId('agent-run-mode-EXTERNAL')).toBeDisabled()
  expect(screen.getByTestId('agent-run-mode-claude-code')).toBeDisabled()
  expect(screen.getByTestId('agent-run-mode-lock')).toHaveTextContent('공통 비서는 기본 방식으로만 돌아요')
  expect(screen.getByTestId('agent-run-mode-lock')).toHaveTextContent('공통 비서 지정을 먼저 풀어 주세요')
})

// ── WP-1075: 역할 할당·사용 상태가 구성원 화면에서 에이전트 상세로 옮겨 왔다 ──

test('일반 에이전트 상세 — AI 에게 줄 수 없는 역할은 빠지고, 고른 역할을 저장하면 roleIds 로 PUT 한다 (WP-1075·WP-728)', async () => {
  const { user, calls } = await renderDetail(100)
  const access = await waitFor(() => {
    const el = document.getElementById('agent-roles')
    expect(el).not.toBeNull()
    expect(el!.querySelector('#role-1')).not.toBeNull()
    return el!
  })
  expect(within(access).getByText('AI 에게는 관리자 역할이나 관리 권한이 든 역할을 줄 수 없어요', { exact: false })).toBeInTheDocument()
  // 보이는 역할: USER·AGENT·VIEWER, 숨는 역할: ADMIN·HR(관리 권한).
  for (const id of [1, 3, 5]) expect(document.getElementById(`role-${id}`)).toBeInTheDocument()
  for (const id of [2, 4]) expect(document.getElementById(`role-${id}`)).not.toBeInTheDocument()

  await user.click(within(access).getByRole('checkbox', { name: /VIEWER/ }))
  await user.click(within(access).getByRole('button', { name: '역할 저장' }))
  await waitFor(() => expect(calls.roleSaves).toEqual([{ roleIds: [3, 5] }]))
  expect(await screen.findByText('역할이 저장되었습니다.')).toBeInTheDocument()
})

test('상태 — 사용 끄기는 확인창을 거쳐 active=false 로 저장되고, 상세에 「사용 중지」·키 발급 막힘 안내가, 목록에 「사용 중지」 배지가 보인다 (WP-1075)', async () => {
  const { user, calls } = await renderDetail(100)
  const toggle = await screen.findByRole('switch', { name: '사용' })
  expect(toggle).toBeChecked()
  const readsBefore = calls.agentListReads

  await user.click(toggle)
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog).toHaveTextContent('사용을 중지할까요?')
  expect(dialog).toHaveTextContent('내부봇이 이 워크스페이스에 접속하거나 일할 수 없게 돼요.')
  await user.click(within(dialog).getByRole('button', { name: '사용 중지' }))

  await waitFor(() => expect(calls.actives).toEqual([{ active: false }]))
  // 상세 머리에 배지, 정지된 AI 에는 새 키를 발급하지 않고(남은 키 폐기는 가능) AI 계정은 보기만.
  await waitFor(() => expect(screen.getByRole('switch', { name: '사용' })).not.toBeChecked())
  expect(await screen.findByTestId('key-issue-blocked')).toHaveTextContent('사용 중지된 AI 에는 새 키를 발급하지 않아요')
  expect(screen.queryByTestId('key-issue-form')).not.toBeInTheDocument()
  expect(screen.getByTestId('key-revoke-1')).toBeInTheDocument()
  expect(screen.queryByTestId('oauth-token-register')).not.toBeInTheDocument()
  expect(calls.agentListReads).toBeGreaterThanOrEqual(readsBefore)
  // 목록으로 돌아가면 배지가 붙어 있다.
  await user.click(screen.getByRole('button', { name: '목록으로 돌아가기' }))
  expect(await screen.findByTestId('agent-inactive-100')).toHaveTextContent('사용 중지')
})

test('공통 비서 상세 — 사용 스위치는 막혀 있고 지정 해제가 먼저라는 이유가 보인다 (WP-1075)', async () => {
  const { calls } = await renderDetail(103)
  const toggle = await screen.findByRole('switch', { name: '사용' })
  expect(toggle).toBeChecked()
  expect(toggle).toBeDisabled()
  expect(within(screen.getByTestId('agent-use-toggle')).getByText('공통 비서 지정을 먼저 풀어 주세요.')).toBeInTheDocument()
  expect(calls.actives).toEqual([])
})

test('사용 중지된 에이전트는 목록에 배지가 보이고, 상세에서 켜면 확인창 없이 active=true 로 저장된다 (WP-1075·WP-705)', async () => {
  const stopped: AgentResponse = { ...base, id: 105, username: 'old_bot', name: '중지봇', type: 'REGULAR', runtime: 'INTERNAL', runMode: 'SERVER', isActive: false }
  const { user, calls } = await renderDetail(105, { extraAgents: [stopped] })
  const toggle = await screen.findByRole('switch', { name: '사용' })
  expect(toggle).not.toBeChecked()
  await user.click(toggle)
  await waitFor(() => expect(calls.actives).toEqual([{ active: true }]))
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole('switch', { name: '사용' })).toBeChecked())
})

test('개인 비서 상세 — 역할 할당·위험 구역이 없고 사용 스위치는 주인이 관리한다며 막혀 있다 (WP-1075·WP-1163)', async () => {
  await renderDetail(106, { extraAgents: [PERSONAL] })
  const toggle = await screen.findByRole('switch', { name: '사용' })
  expect(toggle).toBeDisabled()
  expect(within(screen.getByTestId('agent-use-toggle')).getByText('이 AI 는 주인이 관리해요.')).toBeInTheDocument()
  expect(document.getElementById('agent-roles')).toBeNull()
  expect(screen.queryByTestId('agent-delete-106')).not.toBeInTheDocument()
  expect(screen.queryByText('역할 할당')).not.toBeInTheDocument()
  expect(screen.queryByText('위험 구역')).not.toBeInTheDocument()
})

// WP-1153: 관리자가 개인 비서에게 키를 받으면 그 신원으로 주인의 개인 작업을 읽을 수 있었다 — 발급 폼 대신 안내만 보이고, 키 목록은 남는다.
test('개인 비서 상세에는 키 발급 폼 대신 안내가 보이고 키 목록은 그대로다 (WP-1153)', async () => {
  await renderDetail(106, { extraAgents: [PERSONAL] })
  const keys = await screen.findByTestId('agent-keys-block')
  expect(within(keys).getByTestId('key-issue-blocked')).toHaveTextContent('개인 비서의 키는 관리자가 발급할 수 없어요')
  expect(within(keys).queryByTestId('key-issue-form')).not.toBeInTheDocument()
  expect(within(keys).queryByRole('button', { name: '키 발급' })).not.toBeInTheDocument()
  expect(await within(keys).findByText('아직 발급한 키가 없어요')).toBeInTheDocument()
})

// WP-1162: 개인 비서의 남은 키는 인증되지 않으니 표에서 「활성」처럼 보이지 않게 「사용 불가」로 적고, 회수 안내를 붙인다.
test('개인 비서의 남은 키는 「사용 불가」로 보이고 폐기 안내가 붙는다 (WP-1162)', async () => {
  const legacy = { ...KEY_1, id: 7, userId: 106, keyPrefix: 'ak_legacy0' }
  await renderDetail(106, { extraAgents: [PERSONAL], personalKeys: [legacy] })
  const keys = await screen.findByTestId('agent-keys-block')
  expect(await within(keys).findByTestId('key-unusable-7')).toHaveTextContent('사용 불가')
  expect(within(keys).getByTestId('key-revoke-7')).toBeInTheDocument()
  expect(within(keys).getByTestId('key-issue-blocked')).toHaveTextContent('폐기해 정리하세요')
})

// WP-1162: 목록을 못 불러와도 안내는 늘 보인다 — 예전에는 남은 키 유무로 안내를 켜고 꺼서 실패 때 숨겨졌다. WP-1281 에서 안내 문구가 늘 같아졌다.
test('개인 비서 키 목록을 불러오지 못해도 폐기 안내가 보인다 (WP-1162)', async () => {
  await renderDetail(106, { extraAgents: [PERSONAL], personalKeys: 'error' })
  const keys = await screen.findByTestId('agent-keys-block')
  expect(within(keys).getByTestId('key-issue-blocked')).toHaveTextContent('폐기해 정리하세요')
})

// 일반 AI 의 회수 안 된 키는 회수 칸이 비어 있고 「사용 불가」가 붙지 않는다.
test('일반 AI 의 키에는 「사용 불가」가 붙지 않는다 (WP-1162)', async () => {
  await renderDetail(100)
  await screen.findByTestId('key-revoke-1')
  expect(screen.queryByTestId('key-unusable-1')).not.toBeInTheDocument()
})

// WP-1253: 만료된 키(Works 자동 발급 키의 수명이 다함)는 회수한 키처럼 쓸 수 없다 — 상태 칸에 「만료됨」, 폐기 버튼 없음.
test('만료된 키는 「만료됨」으로 보이고 폐기 버튼이 없다 (WP-1253)', async () => {
  const expired = { ...KEY_1, id: 8, userId: 106, keyPrefix: 'ak_expired', label: 'Works 자동 발급', createdBy: null, managed: true, expiresAt: '2020-01-01T00:00:00Z' }
  await renderDetail(106, { extraAgents: [PERSONAL], personalKeys: [expired] })
  const keys = await screen.findByTestId('agent-keys-block')
  expect(await within(keys).findByTestId('key-expired-8')).toHaveTextContent('만료됨')
  expect(within(keys).queryByTestId('key-revoke-8')).not.toBeInTheDocument()
  expect(within(keys).queryByTestId('key-unusable-8')).not.toBeInTheDocument()
})

test('없는 에이전트 주소는 찾을 수 없음 안내를 보이고 주소를 고치지 않는다', async () => {
  const api = agentApi()
  const { location } = renderScreen(<Screens />, { path: '/settings/agents/999', handlers: api.handlers })
  expect(await screen.findByTestId('agent-detail-notfound')).toHaveTextContent('에이전트를 찾을 수 없어요')
  expect(location()).toBe('/settings/agents/999')
})

// ── AI 아바타(WP-1222) ─────────────────────────────────────────────────────────────
// 관리자가 AI 상세의 「기본 정보」에서 아바타를 바꾸고 되돌린다 — 내 아바타와 같은 자르기 창, API 만 /admin/agents/{id}/avatar.
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


/** 목록·상세를 아바타 제공자로 감싸 상세로 바로 띄운다. */
async function renderWithAvatars(
  path: string,
  initial: AvatarEntry[],
  opts: Parameters<typeof agentApi>[0] = {},
  listFailsAfterWrite = false,
) {
  const api = agentApi(opts)
  const av = agentAvatarApi(initial, listFailsAfterWrite)
  const view = renderScreen(
    <AvatarsProvider>
      <Screens />
    </AvatarsProvider>,
    // 아바타 표를 앞에 — 뒤의 `/users/:id`(계정 상세)가 `/users/avatars` 를 id 로 잡지 않게.
    { path, handlers: [...av.handlers, ...api.handlers] },
  )
  return { ...view, ...av }
}

/** 파일을 올리고 자르기 창의 이미지 크기를 정해 저장을 누른다. */
async function uploadAvatar(user: ReturnType<typeof renderScreen>['user'], section: HTMLElement, w: number, h: number) {
  await user.upload(within(section).getByLabelText('아바타 이미지 파일'), new File(['png'], 'bot.png', { type: 'image/png' }))
  const img = await screen.findByTestId('avatar-crop-image')
  Object.defineProperty(img, 'naturalWidth', { value: w })
  Object.defineProperty(img, 'naturalHeight', { value: h })
  fireEvent.load(img)
  await user.click(within(screen.getByTestId('avatar-crop-dialog')).getByRole('button', { name: '저장' }))
}

test('AI 아바타 — 목록에 올린 이미지가 보이고, 상세에서 바꾸면 자른 영역과 함께 관리자 API 로 올린 뒤 표를 다시 받는다 (WP-1222)', async () => {
  const { user, writes, listReads } = await renderWithAvatars('/settings/agents', [{ userId: 101, avatarUrl: '/api/v1/avatars/101/h' }])
  await screen.findByTestId('agent-row-100')
  // 이미지가 있는 AI(101)는 목록 칸에 이미지(28px → 64 벌), 없는 AI(100)는 첫 글자.
  await waitFor(() => expect(screen.getByTestId('agent-avatar-101').querySelector('img')).toHaveAttribute('src', '/api/v1/avatars/101/h/64'))
  expect(screen.getByTestId('agent-avatar-100').querySelector('img')).toBeNull()
  expect(screen.getByTestId('agent-avatar-100')).toHaveTextContent('내')

  await user.click(screen.getByTestId('agent-row-100'))
  const section = await screen.findByTestId('agent-avatar')
  expect(within(section).queryByRole('button', { name: '기본으로 되돌리기' })).not.toBeInTheDocument()
  const readsBefore = listReads()
  await uploadAvatar(user, section, 300, 500)

  await waitFor(() => expect(writes).toHaveLength(1))
  // 300×500 의 가운데 정사각 = (0, 100) 에서 300.
  expect(writes[0]).toEqual({ method: 'PUT', id: 100, fields: { file: 'FILE', cropX: '0', cropY: '100', cropSize: '300' } })
  expect(await screen.findByText('아바타를 바꿨습니다.')).toBeInTheDocument()
  // 표를 다시 받아 미리보기가 새 이미지가 된다.
  await waitFor(() => expect(listReads()).toBeGreaterThan(readsBefore))
  await waitFor(() =>
    expect(within(section).getByTestId('agent-avatar-preview').querySelector('img')).toHaveAttribute('src', '/api/v1/avatars/100/new/256'),
  )
  expect(within(section).getByRole('button', { name: '기본으로 되돌리기' })).toBeInTheDocument()
})

test('AI 아바타 — 저장 뒤 표 다시 받기가 실패해도 저장된 것으로 보고 창을 닫는다 (WP-1222)', async () => {
  const { user, writes, listReads } = await renderWithAvatars('/settings/agents/100', [], {}, true)
  const section = await screen.findByTestId('agent-avatar')
  const readsBefore = listReads()
  await uploadAvatar(user, section, 300, 300)
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(await screen.findByText('아바타를 바꿨습니다.')).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByTestId('avatar-crop-dialog')).not.toBeInTheDocument())
  expect(listReads()).toBeGreaterThan(readsBefore)
  expect(screen.queryByText('아바타를 바꾸지 못했습니다.')).not.toBeInTheDocument()
})

test('AI 아바타 되돌리기 — DELETE 후 첫 글자로 돌아간다 (WP-1222)', async () => {
  const { user, writes } = await renderWithAvatars('/settings/agents/101', [{ userId: 101, avatarUrl: '/api/v1/avatars/101/h' }])
  const section = await screen.findByTestId('agent-avatar')
  await user.click(await within(section).findByRole('button', { name: '기본으로 되돌리기' }))
  await waitFor(() => expect(writes).toEqual([{ method: 'DELETE', id: 101, fields: {} }]))
  expect(await screen.findByText('기본 아바타로 되돌렸습니다.')).toBeInTheDocument()
  await waitFor(() => expect(within(section).queryByRole('button', { name: '기본으로 되돌리기' })).not.toBeInTheDocument())
})

test('개인 비서는 주인 전용이라 아바타 바꾸기가 없고 이름·아이디는 보기만 한다 (WP-1222)', async () => {
  await renderWithAvatars('/settings/agents/106', [], { extraAgents: [PERSONAL] })
  const section = await screen.findByTestId('agent-basic-section')
  expect(screen.queryByTestId('agent-avatar')).not.toBeInTheDocument()
  expect(screen.queryByTestId('agent-name-input')).not.toBeInTheDocument()
  expect(section).toHaveTextContent('홍길동의 비서')
  expect(section).toHaveTextContent('__assistant_u7')
})
