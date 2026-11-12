// 계정 추가 창의 Gen:iA 브라우저 로그인(WP-1461) — 화면 컴포넌트 테스트. 계정 탭(AgentManagementPage, /settings/agents/accounts)을 띄우고
// 「+ 계정 추가」로 창을 연다. [로그인] → 시작(POST) → 「Microsoft 로그인 열기」 링크와 남은 시간 → 2초마다 상태 조회(GET) → 성공·만료·실패 화면,
// 진행 중 창 닫기·종류 바꾸기의 취소(DELETE), 붙여 넣기 경로가 그대로인지를 본다.
// 폴링은 가짜 시계(setInterval·setTimeout·Date)를 앞으로 돌려 본다 — shouldAdvanceTime 으로 msw·userEvent 는 실제 시간처럼 흐른다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { GENIA_LOGIN_POLL_MS } from '@/lib/geniaLogin'
import { renderScreen, type ScreenUser } from '@/test/renderScreen'
import type { AgentAccountResponse } from '@/types/agentAccount'

import { createAccount, createGeniaLogin } from '../../test/kits/admin/agentAccounts'
import AgentManagementPage from './AgentManagementPage'

const API = '/api/v1/admin/agent-accounts'
const LOGINS = `${API}/genia-logins`
const GENIA_LOGIN = JSON.stringify({ genia: { type: 'oauth', refresh: 'rt-genia', access: 'at-genia', expires: 1_800_000_000_000 } })

beforeEach(() => {
  // clear* 도 함께 가짜로 — 빠뜨리면 가짜 setInterval 을 진짜 clearInterval 이 지우지 못해, 성공 뒤에도 폴링 타이머가 남는다.
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'], shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
})

type Reply = { status: number; body?: object }

type Calls = { listGets: number; creates: unknown[]; updates: unknown[]; starts: unknown[]; polls: string[]; cancels: string[] }

/**
 * 계정 탭 + Gen:iA 로그인 엔드포인트. start 는 시작 응답(차례대로 — 다시 시도는 다음 것), polls 는 상태 조회 응답을 차례대로 돌려준다(마지막 것을 되풀이).
 * 응답 본문은 부를 때 만든다 — expiresAt 이 응답 순간의 10분이 되게.
 */
function renderLogin(opts: { start?: Array<() => Reply>; polls?: Array<() => Reply>; accounts?: AgentAccountResponse[] } = {}) {
  const accounts = opts.accounts ?? [createAccount({ id: 1, label: 'Claude 팀 A' })]
  const calls: Calls = { listGets: 0, creates: [], updates: [], starts: [], polls: [], cancels: [] }
  const starts = opts.start ?? [() => ({ status: 201, body: createGeniaLogin() })]
  const polls = opts.polls ?? [() => ({ status: 200, body: createGeniaLogin() })]
  const send = (r: Reply) => (r.status === 204 ? new HttpResponse(null, { status: 204 }) : HttpResponse.json(r.body ?? {}, { status: r.status }))
  const view = renderScreen(<AgentManagementPage />, {
    path: '/settings/agents/accounts',
    handlers: [
      http.get(API, () => {
        calls.listGets += 1
        return HttpResponse.json(accounts)
      }),
      http.post(API, async ({ request }) => {
        calls.creates.push(await request.json())
        return HttpResponse.json(createAccount({ id: 99, provider: 'genia' }))
      }),
      http.patch(`${API}/:id`, async ({ request }) => {
        calls.updates.push(await request.json())
        return HttpResponse.json(accounts[0])
      }),
      http.post(LOGINS, async ({ request }) => {
        calls.starts.push(await request.json())
        return send(starts[Math.min(calls.starts.length - 1, starts.length - 1)]())
      }),
      http.get(`${LOGINS}/:id`, ({ params }) => {
        calls.polls.push(String(params.id))
        return send(polls[Math.min(calls.polls.length - 1, polls.length - 1)]())
      }),
      http.delete(`${LOGINS}/:id`, ({ params }) => {
        calls.cancels.push(String(params.id))
        return new HttpResponse(null, { status: 204 })
      }),
    ],
  })
  return { ...view, calls }
}

/** 「+ 계정 추가」로 창을 열고 종류를 Gen:iA 로 고른다. */
async function openGenia(user: ScreenUser) {
  await screen.findByTestId('agent-account-row-1')
  await user.click(screen.getByTestId('agent-account-new'))
  const dialog = await screen.findByTestId('agent-account-dialog')
  await user.click(within(dialog).getByTestId('agent-account-kind-genia'))
  return dialog
}

/** 상태 조회 한 번만큼 시계를 돌린다. */
async function tickPoll() {
  await vi.advanceTimersByTimeAsync(GENIA_LOGIN_POLL_MS)
}

const SUCCEEDED = (): Reply => ({
  status: 200,
  body: createGeniaLogin({ status: 'SUCCEEDED', authorizeUrl: null, accountId: 99, accountEmail: 'me@iacloud.kr' }),
})

test('Gen:iA 를 고르면 붙여 넣기 칸은 그대로 두고 [로그인] 단추가 더해진다', async () => {
  const { user } = renderLogin()
  await screen.findByTestId('agent-account-row-1')
  await user.click(screen.getByTestId('agent-account-new'))
  const dialog = await screen.findByTestId('agent-account-dialog')
  // 키 종류·ChatGPT 에는 없다
  expect(within(dialog).queryByTestId('genia-login-start')).not.toBeInTheDocument()
  await user.click(within(dialog).getByTestId('agent-account-kind-chatgpt'))
  expect(within(dialog).queryByTestId('genia-login-start')).not.toBeInTheDocument()
  await user.click(within(dialog).getByTestId('agent-account-kind-genia'))
  expect(within(dialog).getByTestId('genia-login-start')).toHaveTextContent('로그인')
  expect(dialog).toHaveTextContent(
    '지금 로그인한 내 Gen:iA 계정을 Microsoft 로그인으로 넣어요. 다른 사람의 계정은 아래에 로그인 정보를 붙여 넣어요.',
  )
  // 붙여 넣기 경로는 그대로
  expect(within(dialog).getByTestId('agent-account-login-warning')).toBeInTheDocument()
  expect(within(dialog).getByTestId('login-info-text')).toBeInTheDocument()
  expect(within(dialog).getByTestId('login-info-file-pick')).toBeInTheDocument()
  // [로그인] 은 로그인 안내 위에
  expect(
    within(dialog).getByTestId('genia-login-start').compareDocumentPosition(within(dialog).getByTestId('agent-account-login-warning')) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy()
})

test('[로그인] → 라벨을 실어 시작하고 「Microsoft 로그인 열기」(새 탭)와 남은 시간을 보인다', async () => {
  const { user, calls } = renderLogin()
  const dialog = await openGenia(user)
  await user.click(within(dialog).getByTestId('agent-account-label'))
  await user.paste('  내 Gen:iA  ')
  await user.click(within(dialog).getByTestId('genia-login-start'))
  const link = await within(dialog).findByTestId('genia-login-open')
  expect(calls.starts).toEqual([{ label: '내 Gen:iA' }])
  expect(link).toHaveTextContent('Microsoft 로그인 열기')
  expect(link).toHaveAttribute('href', 'https://login.microsoftonline.com/authorize?state=abc')
  expect(link).toHaveAttribute('target', '_blank')
  expect(link.getAttribute('rel')).toContain('noopener')
  expect(within(dialog).getByTestId('genia-login-remaining')).toHaveTextContent('남은 시간 10:00')
  await vi.advanceTimersByTimeAsync(1000)
  await waitFor(() => expect(within(dialog).getByTestId('genia-login-remaining')).toHaveTextContent('남은 시간 9:59'))
})

test('로그인 진행 중에는 라벨을 잠근다 — 라벨은 [로그인] 때 값으로 저장되므로, 끝나면(만료) 다시 풀린다', async () => {
  const { user } = renderLogin({
    polls: [() => ({ status: 200, body: createGeniaLogin({ status: 'EXPIRED', authorizeUrl: null }) })],
  })
  const dialog = await openGenia(user)
  const label = within(dialog).getByTestId('agent-account-label')
  expect(label).toBeEnabled()
  await user.click(within(dialog).getByTestId('genia-login-start'))
  await within(dialog).findByTestId('genia-login-open')
  expect(label).toBeDisabled()
  await tickPoll()
  await within(dialog).findByTestId('genia-login-retry')
  expect(label).toBeEnabled()
})

test('로그인 진행 중에 종류를 바꾸면 라벨 잠금이 풀린다', async () => {
  const { user } = renderLogin()
  const dialog = await openGenia(user)
  await user.click(within(dialog).getByTestId('genia-login-start'))
  await within(dialog).findByTestId('genia-login-open')
  expect(within(dialog).getByTestId('agent-account-label')).toBeDisabled()
  await user.click(within(dialog).getByTestId('agent-account-kind-chatgpt'))
  await waitFor(() => expect(within(dialog).getByTestId('agent-account-label')).toBeEnabled())
})

test('[로그인] — 라벨을 비우면 빈 본문으로 시작한다', async () => {
  const { user, calls } = renderLogin()
  const dialog = await openGenia(user)
  await user.click(within(dialog).getByTestId('genia-login-start'))
  await within(dialog).findByTestId('genia-login-open')
  expect(calls.starts).toEqual([{}])
})

test('대기 → 성공이면 「로그인됨 — me@iacloud.kr」, 목록을 다시 받고 [닫기] 만 남는다', async () => {
  const { user, calls } = renderLogin({ polls: [() => ({ status: 200, body: createGeniaLogin() }), SUCCEEDED] })
  const dialog = await openGenia(user)
  await user.click(within(dialog).getByTestId('genia-login-start'))
  await within(dialog).findByTestId('genia-login-open')
  const listBefore = calls.listGets
  await tickPoll()
  await waitFor(() => expect(calls.polls.length).toBe(1))
  expect(within(dialog).getByTestId('genia-login-open')).toBeInTheDocument()
  await tickPoll()
  const done = await within(dialog).findByTestId('genia-login-done')
  expect(done).toHaveTextContent('로그인됨 — me@iacloud.kr')
  expect(done).toHaveAttribute('role', 'status')
  await waitFor(() => expect(calls.listGets).toBe(listBefore + 1))
  expect(await screen.findByText('계정을 추가했습니다.')).toBeInTheDocument()
  // 계정이 이미 생겼다 — 종류·라벨을 잠그고 하단은 [닫기] 하나
  expect(within(dialog).queryByTestId('agent-account-submit')).not.toBeInTheDocument()
  expect(within(dialog).getByTestId('agent-account-label')).toBeDisabled()
  expect(within(dialog).getByTestId('agent-account-kind-anthropic')).toBeDisabled()
  // 성공 뒤에는 더 묻지 않는다
  const pollsAfter = calls.polls.length
  await tickPoll()
  expect(calls.polls.length).toBe(pollsAfter)
  await user.click(within(dialog).getByTestId('agent-account-close'))
  await waitFor(() => expect(screen.queryByTestId('agent-account-dialog')).not.toBeInTheDocument())
  expect(calls.cancels).toEqual([])
})

test('만료면 「로그인 시간이 지났어요 — 다시 시도」, [다시 시도] 는 새로 시작한다', async () => {
  const { user, calls } = renderLogin({
    start: [() => ({ status: 201, body: createGeniaLogin({ id: 'login-1' }) }), () => ({ status: 201, body: createGeniaLogin({ id: 'login-2' }) })],
    polls: [() => ({ status: 200, body: createGeniaLogin({ status: 'EXPIRED', authorizeUrl: null }) })],
  })
  const dialog = await openGenia(user)
  await user.click(within(dialog).getByTestId('genia-login-start'))
  await within(dialog).findByTestId('genia-login-open')
  await tickPoll()
  const retry = await within(dialog).findByTestId('genia-login-retry')
  expect(dialog).toHaveTextContent('로그인 시간이 지났어요 —')
  expect(retry).toHaveTextContent('다시 시도')
  expect(within(dialog).queryByTestId('genia-login-open')).not.toBeInTheDocument()
  await user.click(retry)
  await waitFor(() => expect(calls.starts).toHaveLength(2))
  expect(await within(dialog).findByTestId('genia-login-open')).toBeInTheDocument()
})

test('상태 조회가 404 면 만료와 같은 화면, 다시 묻지 않는다', async () => {
  const { user, calls } = renderLogin({ polls: [() => ({ status: 404, body: { message: '없음' } })] })
  const dialog = await openGenia(user)
  await user.click(within(dialog).getByTestId('genia-login-start'))
  await within(dialog).findByTestId('genia-login-open')
  await tickPoll()
  expect(await within(dialog).findByTestId('genia-login-retry')).toBeInTheDocument()
  expect(dialog).toHaveTextContent('로그인 시간이 지났어요 —')
  // 진행이 없어졌으니 더 묻지 않는다 — 마지막 성공 값(PENDING)이 남아 있어도 폴링이 멈춰야 한다
  const pollsAfter = calls.polls.length
  await tickPoll()
  await tickPoll()
  await tickPoll()
  expect(calls.polls.length).toBe(pollsAfter)
})

test('실패면 서버 이유와 [다시 시도]', async () => {
  const { user } = renderLogin({
    polls: [
      () => ({
        status: 200,
        body: createGeniaLogin({ status: 'FAILED', authorizeUrl: null, errorMessage: '같은 키의 계정이 이미 있어요 — 목록의 그 계정을 써 주세요' }),
      }),
    ],
  })
  const dialog = await openGenia(user)
  await user.click(within(dialog).getByTestId('genia-login-start'))
  await within(dialog).findByTestId('genia-login-open')
  await tickPoll()
  const error = await within(dialog).findByTestId('genia-login-error')
  expect(error).toHaveAttribute('role', 'alert')
  expect(error).toHaveTextContent('같은 키의 계정이 이미 있어요 — 목록의 그 계정을 써 주세요')
  expect(within(dialog).getByTestId('genia-login-retry')).toBeInTheDocument()
})

test('시작이 502 면 서버 문구와 [다시 시도]', async () => {
  const message = 'Gen:iA 로그인 서버에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요'
  const { user, calls } = renderLogin({
    start: [() => ({ status: 502, body: { message, errors: { code: 'GENIA_LOGIN_UNAVAILABLE' } } }), () => ({ status: 201, body: createGeniaLogin() })],
  })
  const dialog = await openGenia(user)
  await user.click(within(dialog).getByTestId('genia-login-start'))
  const error = await within(dialog).findByTestId('genia-login-error')
  expect(error).toHaveAttribute('role', 'alert')
  expect(error).toHaveTextContent(message)
  await user.click(within(dialog).getByTestId('genia-login-retry'))
  expect(await within(dialog).findByTestId('genia-login-open')).toBeInTheDocument()
  expect(calls.starts).toHaveLength(2)
})

test('진행 중에 창을 닫으면 진행을 취소한다', async () => {
  const { user, calls } = renderLogin()
  const dialog = await openGenia(user)
  await user.click(within(dialog).getByTestId('genia-login-start'))
  await within(dialog).findByTestId('genia-login-open')
  await user.click(within(dialog).getByRole('button', { name: '취소' }))
  await waitFor(() => expect(screen.queryByTestId('agent-account-dialog')).not.toBeInTheDocument())
  await waitFor(() => expect(calls.cancels).toEqual(['login-1']))
})

test('진행 중에 종류를 ChatGPT 로 바꿔도 진행을 취소한다', async () => {
  const { user, calls } = renderLogin()
  const dialog = await openGenia(user)
  await user.click(within(dialog).getByTestId('genia-login-start'))
  await within(dialog).findByTestId('genia-login-open')
  await user.click(within(dialog).getByTestId('agent-account-kind-chatgpt'))
  await waitFor(() => expect(calls.cancels).toEqual(['login-1']))
  expect(within(dialog).queryByTestId('genia-login-open')).not.toBeInTheDocument()
})

test('진행 중에도 붙여 넣기로 추가할 수 있다', async () => {
  const { user, calls } = renderLogin()
  const dialog = await openGenia(user)
  await user.click(within(dialog).getByTestId('genia-login-start'))
  await within(dialog).findByTestId('genia-login-open')
  await user.click(within(dialog).getByTestId('login-info-text'))
  await user.paste(GENIA_LOGIN)
  await user.click(within(dialog).getByTestId('agent-account-submit'))
  await waitFor(() => expect(calls.creates).toEqual([{ provider: 'genia', loginInfo: GENIA_LOGIN }]))
  await waitFor(() => expect(screen.queryByTestId('agent-account-dialog')).not.toBeInTheDocument())
  await waitFor(() => expect(calls.cancels).toEqual(['login-1']))
})

// ── 수정 창: 만료된 Gen:iA 계정 다시 로그인 ─────────────────────────────────────

const EXPIRED = () => createAccount({ id: 6, provider: 'genia', label: '내 Gen:iA', accountEmail: 'me@iacloud.kr', status: 'RELOGIN_REQUIRED' })

/** 줄 ⋯ 메뉴 → 수정으로 창을 연다. */
async function openEdit(user: ScreenUser, id: number) {
  await user.click(await screen.findByTestId(`agent-account-menu-${id}`))
  await user.click(await screen.findByTestId(`agent-account-edit-${id}`))
  return screen.findByTestId('agent-account-dialog')
}

test('수정(Gen:iA, 다시 로그인 필요) — 키 교체를 열면 [로그인] 과 붙여 넣기 칸이 함께 보인다', async () => {
  const { user } = renderLogin({ accounts: [EXPIRED()] })
  const dialog = await openEdit(user, 6)
  expect(within(dialog).queryByTestId('genia-login-start')).not.toBeInTheDocument()
  await user.click(within(dialog).getByTestId('agent-account-replace-toggle'))
  expect(within(dialog).getByTestId('genia-login-start')).toBeInTheDocument()
  expect(within(dialog).getByTestId('login-info-text')).toBeInTheDocument()
})

test('수정 — [로그인] 은 accountId 를 실어 시작하고, 성공하면 표시·토스트·목록 다시 받기, 「교체 안 함」 단추가 사라진다', async () => {
  const { user, calls } = renderLogin({ accounts: [EXPIRED()], polls: [SUCCEEDED] })
  const dialog = await openEdit(user, 6)
  await user.click(within(dialog).getByTestId('agent-account-replace-toggle'))
  await user.click(within(dialog).getByTestId('genia-login-start'))
  await within(dialog).findByTestId('genia-login-open')
  expect(calls.starts).toEqual([{ accountId: 6 }])
  const listBefore = calls.listGets
  await tickPoll()
  expect(await within(dialog).findByTestId('genia-login-done')).toHaveTextContent('로그인됨 — me@iacloud.kr')
  expect(await screen.findByText('계정을 수정했습니다.')).toBeInTheDocument()
  await waitFor(() => expect(calls.listGets).toBe(listBefore + 1))
  expect(within(dialog).queryByTestId('agent-account-replace-toggle')).not.toBeInTheDocument()
  expect(within(dialog).queryByTestId('login-info-text')).not.toBeInTheDocument()
  expect(calls.updates).toEqual([])
})

test('수정 — 로그인 성공 뒤 라벨을 바꾸면 [저장] 은 라벨만 보낸다', async () => {
  const { user, calls } = renderLogin({ accounts: [EXPIRED()], polls: [SUCCEEDED] })
  const dialog = await openEdit(user, 6)
  await user.click(within(dialog).getByTestId('agent-account-replace-toggle'))
  await user.click(within(dialog).getByTestId('genia-login-start'))
  await within(dialog).findByTestId('genia-login-open')
  await tickPoll()
  await within(dialog).findByTestId('genia-login-done')
  // 라벨을 안 바꿨으면 저장 비활성
  expect(within(dialog).getByTestId('agent-account-submit')).toBeDisabled()
  const label = within(dialog).getByTestId('agent-account-label')
  expect(label).toBeEnabled()
  await user.clear(label)
  await user.click(label)
  await user.paste('새 이름')
  await user.click(within(dialog).getByTestId('agent-account-submit'))
  await waitFor(() => expect(calls.updates).toEqual([{ label: '새 이름' }]))
})

test('수정 — 다시 로그인 대신 붙여 넣기로 바꾸는 길도 그대로', async () => {
  const { user, calls } = renderLogin({ accounts: [EXPIRED()] })
  const dialog = await openEdit(user, 6)
  await user.click(within(dialog).getByTestId('agent-account-replace-toggle'))
  await user.click(within(dialog).getByTestId('login-info-text'))
  await user.paste(GENIA_LOGIN)
  await user.click(within(dialog).getByTestId('agent-account-submit'))
  await waitFor(() => expect(calls.updates).toEqual([{ loginInfo: GENIA_LOGIN }]))
})

test('수정 — ChatGPT 계정의 키 교체에는 [로그인] 이 없다', async () => {
  const { user } = renderLogin({ accounts: [createAccount({ id: 7, provider: 'chatgpt', label: 'GPT' })] })
  const dialog = await openEdit(user, 7)
  await user.click(within(dialog).getByTestId('agent-account-replace-toggle'))
  expect(within(dialog).queryByTestId('genia-login-start')).not.toBeInTheDocument()
  expect(within(dialog).getByTestId('login-info-text')).toBeInTheDocument()
})
