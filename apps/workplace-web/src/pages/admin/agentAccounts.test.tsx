// 에이전트 › 계정 탭(WP-1451) — 화면 컴포넌트 테스트. 에이전트 화면 셸(AgentManagementPage, 주소 /settings/agents/accounts)을 renderScreen 으로 띄운다.
// 응답 → 표 셀: 상태 칸 문구(우선순위), 막대 색(75%·100% 기준), 한도 없는 줄(「한도 없음」·마지막 사용), 초기화 시각(남은 시간·주간 날짜),
// 갱신 상대 시각, 빈 목록·오류, 탭 주소·머리 단추·60초 다시 받기를 본다. 표시 규칙의 경계값은 lib/agentAccountUsage.test.ts 가 본다.
// 시각은 결정적으로 — vitest 는 TZ=Asia/Seoul 고정(vitest.config.ts), Date 는 2026-11-09(월) 10:00 KST 로 고정한다.
import { act, screen, waitFor, within } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { afterAll, beforeAll, expect, test, vi } from 'vitest'

import { agentAccountKeys } from '@/hooks/queries/useAgentAccounts'
import { renderScreen, type ScreenUser } from '@/test/renderScreen'
import type { AgentAccountResponse } from '@/types/agentAccount'

import { createAccount, createUsage } from '../../test/kits/admin/agentAccounts'
import AgentManagementPage from './AgentManagementPage'

const API = '/api/v1/admin/agent-accounts'
// 2026-11-09(월) 10:00 KST
const NOW = new Date('2026-11-09T01:00:00Z')

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterAll(() => vi.useRealTimers())

const DEV_AI = { userId: 11, username: 'dev-ai', name: '개발 AI' }

/** 상태마다 한 줄 — 여유·곧 한도·한도 도달·확인 실패·한도 없음(쓰는 AI 있음/없음)·다시 로그인 필요·확인 전. */
function accounts(): AgentAccountResponse[] {
  return [
    createAccount({
      id: 1,
      label: 'Claude 팀 A',
      usage: createUsage({
        status: 'OK',
        fiveHour: { usedPercent: 42.5, resetsAt: '2026-11-09T03:25:00Z', observedAt: '2026-11-09T00:58:00Z' },
        // 11/12 15:00Z = 11/13(금) 00:00 KST — 브라우저 시간대 날짜로 보여야 한다
        weekly: { usedPercent: 30, resetsAt: '2026-11-12T15:00:00Z', observedAt: '2026-11-09T00:58:00Z' },
        checkedAt: '2026-11-09T00:58:00Z',
        succeededAt: '2026-11-09T00:58:00Z',
      }),
    }),
    createAccount({
      id: 2,
      provider: 'chatgpt',
      label: 'ChatGPT 개발',
      accountEmail: 'dev@example.com',
      usage: createUsage({
        status: 'NEAR_LIMIT',
        fiveHour: { usedPercent: 80, resetsAt: '2026-11-09T01:40:00Z', observedAt: null },
        weekly: { usedPercent: 60, resetsAt: '2026-11-11T05:00:00Z', observedAt: null },
        checkedAt: '2026-11-09T00:30:00Z',
      }),
    }),
    createAccount({
      id: 3,
      label: 'Claude 팀 B',
      usage: createUsage({
        status: 'LIMIT_REACHED',
        fiveHour: { usedPercent: 104.2, resetsAt: '2026-11-09T01:30:00Z', observedAt: null },
        weekly: { usedPercent: 74.99, resetsAt: '2026-11-12T05:00:00Z', observedAt: null },
        checkedAt: '2026-11-08T22:00:00Z',
      }),
    }),
    createAccount({
      id: 4,
      label: 'Claude 팀 C',
      usage: createUsage({ status: 'CHECK_FAILED', checkedAt: '2026-11-09T00:59:40Z', errorCode: 'UNAUTHORIZED', errorMessage: '토큰이 만료됐어요' }),
    }),
    createAccount({
      id: 5,
      provider: 'opencode',
      label: '사내 모델',
      usage: createUsage({ status: 'UNLIMITED', lastUsedAt: '2026-11-09T00:57:00Z' }),
    }),
    createAccount({ id: 6, provider: 'genia', label: 'Gen:iA 예비', agents: [], usage: createUsage({ status: 'UNLIMITED' }) }),
    createAccount({
      id: 7,
      provider: 'chatgpt',
      label: 'ChatGPT 옛 계정',
      status: 'RELOGIN_REQUIRED',
      // 사용량은 OK 여도 계정의 다시 로그인이 먼저
      usage: createUsage({ status: 'OK', checkedAt: '2026-11-09T00:00:00Z' }),
    }),
    createAccount({
      id: 8,
      label: '새 Claude',
      agents: [DEV_AI, { userId: 12, username: 'qa-ai', name: '검수 AI' }, { userId: 13, username: 'doc-ai', name: '문서 AI' }, { userId: 14, username: 'ops-ai', name: '운영 AI' }],
      usage: createUsage({ status: 'UNKNOWN' }),
    }),
  ]
}

async function renderAccounts(list: AgentAccountResponse[] = accounts()) {
  const view = renderScreen(<AgentManagementPage />, { path: '/settings/agents/accounts', handlers: [http.get(API, () => HttpResponse.json(list))] })
  return view
}

const status = (id: number) => screen.getByTestId(`agent-account-status-${id}`)
const fiveHour = (id: number) => screen.getByTestId(`agent-account-five-hour-${id}`)
const weekly = (id: number) => screen.getByTestId(`agent-account-weekly-${id}`)
const refreshed = (id: number) => screen.getByTestId(`agent-account-refreshed-${id}`)
const bar = (cell: HTMLElement) => within(cell).getByRole('progressbar')

test('계정 탭 — 주소 /settings/agents/accounts 에서 「계정」 탭이 골라지고 머리 단추는 「+ 계정 추가」', async () => {
  const { queryClient } = await renderAccounts()
  await screen.findByTestId('agent-account-row-1')
  expect(screen.getByTestId('agent-tab-accounts')).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByTestId('agent-account-new')).toHaveTextContent('+ 계정 추가')
  // 「N분 전」·남은 시간이 낡지 않게 목록은 60초마다 다시 받는다
  expect(queryClient.getQueryCache().find({ queryKey: agentAccountKeys.list() })?.options).toMatchObject({ refetchInterval: 60_000 })
})

test('다른 탭에서 「계정」 탭을 누르면 /settings/agents/accounts 로 간다', async () => {
  const { user, location } = renderScreen(<AgentManagementPage />, {
    path: '/settings/agents/locations',
    handlers: [
      http.get('/api/v1/admin/agent-locations', () => HttpResponse.json([])),
      http.get('/api/v1/admin/agent-runtime-summaries', () => HttpResponse.json([])),
      http.get(API, () => HttpResponse.json(accounts())),
    ],
  })
  await user.click(await screen.findByRole('tab', { name: '계정' }))
  expect(await screen.findByTestId('agent-account-row-1')).toHaveTextContent('Claude 팀 A')
  expect(location()).toBe('/settings/agents/accounts')
  expect(screen.getByTestId('agent-account-new')).toHaveTextContent('+ 계정 추가')
})

test('계정 칸 — 라벨·종류 배지·로그인 계정 이메일', async () => {
  await renderAccounts()
  const r2 = await screen.findByTestId('agent-account-row-2')
  expect(r2).toHaveTextContent('ChatGPT 개발')
  expect(r2).toHaveTextContent('ChatGPT 로그인')
  expect(r2).toHaveTextContent('dev@example.com')
  expect(screen.getByTestId('agent-account-row-5')).toHaveTextContent('OpenAI 호환')
})

test('상태 칸 — 상태마다 문구, 확인 실패는 이유를 함께, 계정의 다시 로그인이 사용량보다 먼저', async () => {
  await renderAccounts()
  await screen.findByTestId('agent-account-row-1')
  expect(status(1)).toHaveTextContent('여유')
  expect(status(2)).toHaveTextContent('곧 한도')
  expect(status(3)).toHaveTextContent('한도 도달')
  expect(status(4)).toHaveTextContent('확인 실패')
  expect(status(4)).toHaveTextContent('토큰이 만료됐어요')
  expect(within(status(4)).getByText('확인 실패')).toHaveAttribute('title', '토큰이 만료됐어요')
  expect(status(5)).toHaveTextContent('정상')
  expect(status(6)).toHaveTextContent('쓰는 AI 없음')
  expect(status(7)).toHaveTextContent('다시 로그인 필요')
  expect(status(8)).toHaveTextContent('확인 전')
  // 배지 색 — 의미 단위(StatusBadge data-status)
  expect(within(status(1)).getByText('여유')).toHaveAttribute('data-status', 'success')
  expect(within(status(2)).getByText('곧 한도')).toHaveAttribute('data-status', 'warning')
  expect(within(status(3)).getByText('한도 도달')).toHaveAttribute('data-status', 'error')
  expect(within(status(7)).getByText('다시 로그인 필요')).toHaveAttribute('data-status', 'error')
  expect(within(status(6)).getByText('쓰는 AI 없음')).toHaveAttribute('data-status', 'unknown')
})

test('사용률 막대 — 75% 미만 primary, 75% 이상 warning, 100% 이상 destructive(막대는 가득까지만)', async () => {
  await renderAccounts()
  await screen.findByTestId('agent-account-row-1')
  expect(fiveHour(1)).toHaveTextContent('42%')
  expect(bar(fiveHour(1))).toHaveAttribute('data-tone', 'primary')
  expect(bar(fiveHour(1)).firstElementChild).toHaveClass('bg-primary')

  expect(fiveHour(2)).toHaveTextContent('80%')
  expect(bar(fiveHour(2)).firstElementChild).toHaveClass('bg-warning')

  expect(fiveHour(3)).toHaveTextContent('104%')
  expect(bar(fiveHour(3)).firstElementChild).toHaveClass('bg-destructive')
  expect(bar(fiveHour(3))).toHaveAttribute('aria-valuenow', '100')
  // 74.99 는 74% · primary — 「곧 한도」 기준과 어긋나 보이지 않게 내림
  expect(weekly(3)).toHaveTextContent('74%')
  expect(bar(weekly(3)).firstElementChild).toHaveClass('bg-primary')
})

test('초기화 시각 — 5시간은 남은 시간, 주간은 브라우저 시간대(KST)의 M/D (요일)', async () => {
  await renderAccounts()
  await screen.findByTestId('agent-account-row-1')
  expect(fiveHour(1)).toHaveTextContent('2시간 25분 뒤 초기화')
  expect(fiveHour(2)).toHaveTextContent('40분 뒤 초기화')
  // UTC 날짜(11/12 목)가 아니라 KST 날짜
  expect(weekly(1)).toHaveTextContent('11/13 (금)')
  expect(weekly(2)).toHaveTextContent('11/11 (수)')
})

test('한도 없는 줄 — 5시간·주간 「한도 없음」, 갱신 칸은 마지막 사용(없으면 「사용 기록 없음」)', async () => {
  await renderAccounts()
  await screen.findByTestId('agent-account-row-5')
  for (const id of [5, 6]) {
    expect(fiveHour(id)).toHaveTextContent('한도 없음')
    expect(weekly(id)).toHaveTextContent('한도 없음')
    expect(within(fiveHour(id)).queryByRole('progressbar')).toBeNull()
  }
  expect(refreshed(5)).toHaveTextContent('마지막 사용 3분 전')
  expect(refreshed(6)).toHaveTextContent('사용 기록 없음')
})

test('갱신 칸·빈 창 — 마지막 조회의 상대 시각, 사용량이 아직 없으면 막대 없이 「—」', async () => {
  await renderAccounts()
  await screen.findByTestId('agent-account-row-1')
  expect(refreshed(1)).toHaveTextContent('2분 전')
  expect(refreshed(2)).toHaveTextContent('30분 전')
  expect(refreshed(3)).toHaveTextContent('3시간 전')
  expect(refreshed(4)).toHaveTextContent('방금 전')
  expect(refreshed(8)).toHaveTextContent('—')
  expect(fiveHour(8)).toHaveTextContent('—')
  expect(within(fiveHour(8)).queryByRole('progressbar')).toBeNull()
})

test('쓰는 AI — 이름 칩은 상세 링크, 셋을 넘으면 「외 N명」', async () => {
  await renderAccounts()
  const cell = await screen.findByTestId('agent-account-agents-8')
  expect(within(cell).getAllByRole('link').map((a) => a.textContent)).toEqual(['개발 AI', '검수 AI', '문서 AI'])
  expect(within(cell).getByRole('link', { name: '개발 AI' })).toHaveAttribute('href', '/settings/agents/11')
  expect(cell).toHaveTextContent('외 1명')
  expect(screen.getByTestId('agent-account-agents-6')).toHaveTextContent('—')
})

test('좁은 폭 카드 — 계정 칸 안에 상태·사용률·쓰는 AI·갱신을 쌓는다', async () => {
  await renderAccounts()
  const meta = await screen.findByTestId('agent-account-meta-1')
  expect(meta).toHaveClass('md:hidden')
  expect(meta).toHaveTextContent('여유')
  expect(meta).toHaveTextContent('42%')
  expect(meta).toHaveTextContent('2시간 25분 뒤 초기화')
  expect(meta).toHaveTextContent('11/13 (금)')
  expect(meta).toHaveTextContent('개발 AI')
  expect(meta).toHaveTextContent('2분 전')
})

test('계정이 없으면 빈 안내', async () => {
  await renderAccounts([])
  expect(await screen.findByText(/아직 계정이 없어요/)).toBeInTheDocument()
})

test('목록을 못 받으면 오류 문구 — 「다시 시도」로 다시 받으면 줄이 보인다', async () => {
  let fail = true
  const { user } = renderScreen(<AgentManagementPage />, {
    path: '/settings/agents/accounts',
    handlers: [
      http.get(API, () => (fail ? HttpResponse.json({ message: '서버 오류' }, { status: 500 }) : HttpResponse.json(accounts()))),
    ],
  })
  expect(await screen.findByTestId('agent-account-error')).toHaveTextContent('계정 목록을 불러오지 못했습니다')
  fail = false
  await user.click(screen.getByTestId('agent-account-error-retry'))
  expect(await screen.findByTestId('agent-account-row-1')).toBeInTheDocument()
  expect(screen.queryByTestId('agent-account-error')).not.toBeInTheDocument()
})

test('다시 받기가 실패해도 이미 받은 줄은 그대로 둔다(표 전체를 오류 문구로 바꾸지 않는다)', async () => {
  let fail = false
  const { queryClient } = renderScreen(<AgentManagementPage />, {
    path: '/settings/agents/accounts',
    handlers: [
      http.get(API, () => (fail ? HttpResponse.json({ message: '서버 오류' }, { status: 500 }) : HttpResponse.json(accounts()))),
    ],
  })
  await screen.findByTestId('agent-account-row-1')
  fail = true
  await act(async () => {
    await queryClient.refetchQueries({ queryKey: agentAccountKeys.list() })
  })
  await waitFor(() => expect(queryClient.getQueryState(agentAccountKeys.list())?.status).toBe('error'))
  expect(screen.getByTestId('agent-account-row-1')).toBeInTheDocument()
  expect(screen.queryByTestId('agent-account-error')).not.toBeInTheDocument()
})

test('초기화 시각이 지난 창 — % 는 흐리게, 지난 날짜·남은 시간 대신 「초기화됨 · 다음 확인 때 갱신」, 막대는 경고 색 없이(5시간·주간 모두)', async () => {
  await renderAccounts([
    createAccount({
      id: 1,
      label: '지난 창',
      usage: createUsage({
        status: 'OK',
        // 둘 다 지금(10:00 KST)보다 앞 — 마지막 조회 뒤 초기화됐다
        fiveHour: { usedPercent: 104, resetsAt: '2026-11-09T00:30:00Z', observedAt: null },
        weekly: { usedPercent: 90, resetsAt: '2026-11-08T15:00:00Z', observedAt: null },
        checkedAt: '2026-11-08T20:00:00Z',
      }),
    }),
  ])
  await screen.findByTestId('agent-account-row-1')
  for (const cell of [fiveHour(1), weekly(1)]) {
    expect(cell).toHaveTextContent('초기화됨 · 다음 확인 때 갱신')
    expect(within(cell).getByText(/^\d+%$/)).toHaveClass('text-muted-foreground')
    expect(bar(cell)).toHaveAttribute('data-tone', 'muted')
    expect(bar(cell).firstElementChild).not.toHaveClass('bg-destructive')
    expect(bar(cell).firstElementChild).not.toHaveClass('bg-warning')
  }
  expect(fiveHour(1)).toHaveTextContent('104%')
  // 지난 날짜(11/9 (월))는 보이지 않는다
  expect(weekly(1)).not.toHaveTextContent('11/9')
})

test('남은 시간·갱신 시각은 1분마다 도는 화면 시계로 — 다시 받기가 멈춰도 굳지 않는다', async () => {
  // 이 테스트만 setInterval 까지 가짜로 — 화면 시계(useMinuteNow)와 60초 다시 받기를 손으로 1분 넘긴다.
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(NOW)
  try {
    let calls = 0
    const list = [
      createAccount({
        id: 1,
        usage: createUsage({
          status: 'OK',
          fiveHour: { usedPercent: 10, resetsAt: '2026-11-09T01:40:00Z', observedAt: null },
          checkedAt: '2026-11-09T00:30:00Z',
        }),
      }),
    ]
    renderScreen(<AgentManagementPage />, {
      path: '/settings/agents/accounts',
      // 첫 응답만 오고 그 뒤 다시 받기는 끝나지 않는다(멈춘 다시 받기) — 받은 시각(dataUpdatedAt)이 그대로 남는다
      handlers: [
        http.get(API, async () => {
          if (calls++ === 0) return HttpResponse.json(list)
          await delay('infinite')
          return HttpResponse.json(list)
        }),
      ],
    })
    await screen.findByTestId('agent-account-row-1')
    expect(fiveHour(1)).toHaveTextContent('40분 뒤 초기화')
    expect(refreshed(1)).toHaveTextContent('30분 전')
    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })
    await waitFor(() => expect(fiveHour(1)).toHaveTextContent('39분 뒤 초기화'))
    expect(refreshed(1)).toHaveTextContent('31분 전')
  } finally {
    vi.useRealTimers()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  }
})

// ── 계정 추가·수정·삭제 창 ───────────────────────────────────────────────────────
// 창 입력 → 보내는 본문(종류마다 원문 한 칸, 라벨은 적었을 때만 / 수정은 바뀐 칸만), 서버 거절(409 중복·쓰는 AI 있음) 문구를 본다.

const TOKEN_64 = 'sk-ant-oat01-' + 'a'.repeat(51)
// 가짜 ChatGPT 로그인 정보 — 계정은 서명 없는 JWT 가운데 부분에서 읽는다.
const jwt = (p: object) => `h.${btoa(JSON.stringify(p)).replace(/=+$/, '')}.s`
const CHATGPT_LOGIN = JSON.stringify({
  auth_mode: 'chatgpt',
  tokens: { id_token: jwt({ email: 'ai-dev@example.com' }), access_token: jwt({ exp: 1_800_000_000 }), refresh_token: 'rt-fake' },
})
const GENIA_LOGIN = JSON.stringify({ genia: { type: 'oauth', refresh: 'rt-genia', access: 'at-genia', expires: 1_800_000_000_000 } })

type Calls = { creates: unknown[]; updates: unknown[]; deletes: string[] }

/** 쓰기 요청을 모으는 계정 탭 — create/update/remove 로 응답(상태·본문)을 바꿀 수 있다. */
function renderWritable(
  opts: {
    list?: AgentAccountResponse[]
    create?: { status: number; body?: object }
    update?: { status: number; body?: object }
    remove?: { status: number; body?: object }
    probe?: { status: number; body?: object }
  } = {},
) {
  const calls: Calls = { creates: [], updates: [], deletes: [] }
  const reply = (r: { status: number; body?: object } | undefined, fallback: object) =>
    r && r.status >= 400 ? HttpResponse.json(r.body ?? {}, { status: r.status }) : HttpResponse.json(r?.body ?? fallback)
  const view = renderScreen(<AgentManagementPage />, {
    path: '/settings/agents/accounts',
    handlers: [
      http.get(API, () => HttpResponse.json(opts.list ?? [createAccount({ id: 1, label: 'Claude 팀 A' })])),
      http.post(API, async ({ request }) => {
        calls.creates.push(await request.json())
        return reply(opts.create, createAccount({ id: 99 }))
      }),
      http.patch(`${API}/:id`, async ({ request }) => {
        calls.updates.push(await request.json())
        return reply(opts.update, createAccount({ id: 1 }))
      }),
      http.delete(`${API}/:id`, ({ params }) => {
        calls.deletes.push(String(params.id))
        return opts.remove && opts.remove.status >= 400 ? HttpResponse.json(opts.remove.body ?? {}, { status: opts.remove.status }) : new HttpResponse(null, { status: 204 })
      }),
      http.post('/api/v1/admin/agents/models/probe', () =>
        opts.probe && opts.probe.status >= 400
          ? HttpResponse.json(opts.probe.body ?? {}, { status: opts.probe.status })
          : HttpResponse.json({ models: [{ id: 'm1', label: 'M1' }, { id: 'm2', label: 'M2' }] }),
      ),
    ],
  })
  return { ...view, calls }
}

/** 머리 「+ 계정 추가」로 추가 창을 연다. */
async function openCreate(user: ScreenUser) {
  await screen.findByTestId('agent-account-row-1')
  await user.click(screen.getByTestId('agent-account-new'))
  return screen.findByTestId('agent-account-dialog')
}

/** 줄의 ⋯ 메뉴에서 항목을 고른다. */
async function pickRowMenu(user: ScreenUser, id: number, item: 'edit' | 'delete') {
  await user.click(await screen.findByTestId(`agent-account-menu-${id}`))
  await user.click(await screen.findByTestId(`agent-account-${item}-${id}`))
}

test('추가 — Claude 구독: 토큰과 적은 라벨을 보내고, 성공하면 창을 닫고 알린다', async () => {
  const { user, calls } = renderWritable()
  const dialog = await openCreate(user)
  // 기본 종류는 Claude 구독, 라벨 칸은 비우면 붙는 이름을 알려 준다
  expect(within(dialog).getByTestId('agent-account-kind-anthropic')).toBeChecked()
  expect(within(dialog).getByTestId('agent-account-label')).toHaveAttribute('placeholder', '비우면 「Claude 구독 계정」')
  expect(within(dialog).getByTestId('agent-account-submit')).toBeDisabled()
  await user.click(within(dialog).getByTestId('agent-account-label'))
  await user.paste('  팀 Claude  ')
  await user.click(within(dialog).getByLabelText('토큰'))
  await user.paste(TOKEN_64)
  await user.click(within(dialog).getByTestId('agent-account-submit'))
  await waitFor(() => expect(calls.creates).toEqual([{ provider: 'anthropic', label: '팀 Claude', token: TOKEN_64 }]))
  expect(await screen.findByText('계정을 추가했습니다.')).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByTestId('agent-account-dialog')).not.toBeInTheDocument())
})

test('추가 — Claude 구독 토큰이 짧으면 보내지 않고 알린다', async () => {
  const { user, calls } = renderWritable()
  const dialog = await openCreate(user)
  await user.click(within(dialog).getByLabelText('토큰'))
  await user.paste('short-token')
  await user.click(within(dialog).getByTestId('agent-account-submit'))
  expect(await screen.findByText('토큰이 너무 짧습니다 (최소 32자)')).toBeInTheDocument()
  expect(calls.creates).toEqual([])
})

test('추가 — OpenAI 호환: 라벨을 비우면 빼고 providerConfig(프리셋·주소·키)만, 모델은 받지 않는다', async () => {
  const { user, calls } = renderWritable()
  const dialog = await openCreate(user)
  await user.click(within(dialog).getByTestId('agent-account-kind-opencode'))
  expect(within(dialog).getByTestId('agent-account-label')).toHaveAttribute('placeholder', '비우면 「OpenAI 호환 계정」')
  const baseUrl = within(dialog).getByTestId('credential-base-url')
  await user.clear(baseUrl)
  await user.click(baseUrl)
  await user.paste('https://llm.example.com/v1')
  await user.click(within(dialog).getByTestId('credential-api-key'))
  await user.paste('sk-test-key')
  // 연결 확인 — 받은 모델 수로 연결을 알려 주되 모델은 고르지 않는다
  await user.click(within(dialog).getByTestId('agent-account-probe'))
  expect(await within(dialog).findByTestId('agent-account-probe-result')).toHaveTextContent('연결됐어요 · 모델 2개')
  expect(within(dialog).queryByTestId('credential-model-select')).not.toBeInTheDocument()
  await user.click(within(dialog).getByTestId('agent-account-submit'))
  await waitFor(() =>
    expect(calls.creates).toEqual([
      {
        provider: 'opencode',
        providerConfig: { providerId: 'amazon-bedrock-openai', options: { baseURL: 'https://llm.example.com/v1', apiKey: 'sk-test-key' } },
      },
    ]),
  )
})

test('추가 — ChatGPT 로그인: 목록 전용 로그인 안내를 보이고 loginInfo 를 보낸다', async () => {
  const { user, calls } = renderWritable()
  const dialog = await openCreate(user)
  // 키 종류에는 로그인 파일 안내가 없다
  expect(within(dialog).queryByTestId('agent-account-login-warning')).not.toBeInTheDocument()
  await user.click(within(dialog).getByTestId('agent-account-kind-chatgpt'))
  expect(within(dialog).getByTestId('agent-account-login-warning')).toHaveTextContent(
    '내 컴퓨터에서 쓰던 로그인 파일을 그대로 넣지 마세요. 이 계정용으로 새로 로그인한 파일을 넣어야 해요. 같은 로그인을 두 곳에서 쓰면 한쪽이 로그아웃돼요.',
  )
  expect(dialog).toHaveTextContent('브라우저에서 이 목록 전용 ChatGPT 계정으로 로그인')
  await user.click(within(dialog).getByTestId('login-info-text'))
  await user.paste(CHATGPT_LOGIN)
  expect(within(dialog).getByTestId('login-info-check')).toHaveTextContent('ChatGPT 로그인 정보예요 · ai-dev@example.com')
  expect(dialog).not.toHaveTextContent('rt-fake')
  await user.click(within(dialog).getByTestId('agent-account-submit'))
  await waitFor(() => expect(calls.creates).toEqual([{ provider: 'chatgpt', loginInfo: CHATGPT_LOGIN }]))
})

test('추가 — Gen:iA 로그인: 같은 안내, 다른 프로그램의 파일이면 막고 맞는 파일이면 보낸다', async () => {
  const { user, calls } = renderWritable()
  const dialog = await openCreate(user)
  await user.click(within(dialog).getByTestId('agent-account-kind-genia'))
  expect(within(dialog).getByTestId('agent-account-login-warning')).toBeInTheDocument()
  await user.click(within(dialog).getByTestId('login-info-text'))
  await user.paste(CHATGPT_LOGIN)
  expect(within(dialog).getByTestId('agent-account-submit')).toBeDisabled()
  await user.click(within(within(dialog).getByTestId('login-info-filled')).getByRole('button', { name: '지우기' }))
  await user.click(within(dialog).getByTestId('login-info-text'))
  await user.paste(GENIA_LOGIN)
  await user.click(within(dialog).getByTestId('agent-account-submit'))
  await waitFor(() => expect(calls.creates).toEqual([{ provider: 'genia', loginInfo: GENIA_LOGIN }]))
})

test('추가 — 로그인 정보를 직접 타이핑하면 칸이 그대로 남고, 붙여 넣어야 요약·「지우기」로 바뀐다', async () => {
  // AI 상세의 옛 로그인 정보 연결 창에서 옮겼다(WP-1451 — 작업 공간 AI 는 이제 계정 목록에서 고른다). 입력부는 같은 LoginInfoField 다.
  const { user } = renderWritable()
  const dialog = await openCreate(user)
  await user.click(within(dialog).getByTestId('agent-account-kind-chatgpt'))
  const area = within(dialog).getByTestId('login-info-text')
  await user.type(area, '{{"a')
  expect(within(dialog).getByTestId('login-info-text')).toHaveValue('{"a')
  expect(within(dialog).queryByTestId('login-info-filled')).not.toBeInTheDocument()
  // 이어서 붙여 넣으면 요약으로 바뀌고, 「지우기」는 내용과 요약을 함께 비운다
  await user.paste('":1}')
  expect(within(dialog).getByTestId('login-info-filled')).toBeInTheDocument()
  // 타이핑한 앞부분과 붙여 넣은 글이 이어져 {"a":1} 로 읽힌다(읽지 못했어요가 아니라 다른 프로그램 파일로)
  expect(within(dialog).getByTestId('login-info-check')).toHaveTextContent('다른 프로그램의 파일 같아요')
  await user.click(within(within(dialog).getByTestId('login-info-filled')).getByRole('button', { name: '지우기' }))
  expect(within(dialog).getByTestId('login-info-text')).toHaveValue('')
  expect(within(dialog).queryByTestId('login-info-check')).not.toBeInTheDocument()
})

test('추가 — 같은 키가 이미 있으면(409) 서버 문구를 보이고 창은 남는다', async () => {
  const { user } = renderWritable({
    create: { status: 409, body: { status: 409, message: '같은 키의 계정이 이미 있어요 — 목록의 그 계정을 써 주세요', errors: { code: 'AGENT_ACCOUNT_DUPLICATE' } } },
  })
  const dialog = await openCreate(user)
  await user.click(within(dialog).getByLabelText('토큰'))
  await user.paste(TOKEN_64)
  await user.click(within(dialog).getByTestId('agent-account-submit'))
  expect(await screen.findByText('같은 키의 계정이 이미 있어요 — 목록의 그 계정을 써 주세요')).toBeInTheDocument()
  expect(screen.getByTestId('agent-account-dialog')).toBeInTheDocument()
})

test('수정 — 종류는 표시만, 라벨은 지금 값, 비밀값은 채우지 않고 라벨만 바꾸면 라벨만 보낸다', async () => {
  const { user, calls } = renderWritable({ list: [createAccount({ id: 1, provider: 'opencode', label: '사내 모델' })] })
  await screen.findByTestId('agent-account-row-1')
  await pickRowMenu(user, 1, 'edit')
  const dialog = await screen.findByTestId('agent-account-dialog')
  expect(within(dialog).getByTestId('agent-account-kind-fixed')).toHaveTextContent('OpenAI 호환')
  expect(within(dialog).queryByTestId('agent-account-kind-opencode')).not.toBeInTheDocument()
  expect(within(dialog).getByTestId('agent-account-label')).toHaveValue('사내 모델')
  // 키 칸은 「키 교체」를 열기 전엔 없다 — 바꾼 것이 없으면 저장도 막힌다
  expect(within(dialog).queryByTestId('agent-account-secret')).not.toBeInTheDocument()
  expect(within(dialog).getByTestId('agent-account-submit')).toBeDisabled()
  const label = within(dialog).getByTestId('agent-account-label')
  await user.clear(label)
  await user.click(label)
  await user.paste('사내 모델 2')
  await user.click(within(dialog).getByTestId('agent-account-submit'))
  await waitFor(() => expect(calls.updates).toEqual([{ label: '사내 모델 2' }]))
  expect(await screen.findByText('계정을 수정했습니다.')).toBeInTheDocument()
})

test('수정 — 키 교체를 열면 빈 칸에서 시작하고, 라벨을 그대로 두면 원문만 보낸다', async () => {
  const { user, calls } = renderWritable()
  await screen.findByTestId('agent-account-row-1')
  await pickRowMenu(user, 1, 'edit')
  const dialog = await screen.findByTestId('agent-account-dialog')
  await user.click(within(dialog).getByTestId('agent-account-replace-toggle'))
  expect(within(dialog).getByLabelText('토큰')).toHaveValue('')
  await user.click(within(dialog).getByLabelText('토큰'))
  await user.paste(TOKEN_64)
  await user.click(within(dialog).getByTestId('agent-account-submit'))
  await waitFor(() => expect(calls.updates).toEqual([{ token: TOKEN_64 }]))
})

test('수정 — 라벨과 로그인 정보를 함께 바꾸면 둘 다 보낸다(로그인 계정은 비밀값을 채우지 않는다)', async () => {
  const { user, calls } = renderWritable({ list: [createAccount({ id: 1, provider: 'chatgpt', label: 'ChatGPT 개발', accountEmail: 'dev@example.com' })] })
  await screen.findByTestId('agent-account-row-1')
  await pickRowMenu(user, 1, 'edit')
  const dialog = await screen.findByTestId('agent-account-dialog')
  const label = within(dialog).getByTestId('agent-account-label')
  await user.clear(label)
  await user.click(label)
  await user.paste('ChatGPT 개발 2')
  await user.click(within(dialog).getByTestId('agent-account-replace-toggle'))
  expect(within(dialog).getByTestId('agent-account-login-warning')).toBeInTheDocument()
  expect(within(dialog).getByTestId('login-info-text')).toHaveValue('')
  await user.click(within(dialog).getByTestId('login-info-text'))
  await user.paste(CHATGPT_LOGIN)
  await user.click(within(dialog).getByTestId('agent-account-submit'))
  await waitFor(() => expect(calls.updates).toEqual([{ label: 'ChatGPT 개발 2', loginInfo: CHATGPT_LOGIN }]))
})

test('수정 — 붙여 넣은 로그인 정보는 「교체 안 함」으로 접으면 비워져, 다시 열어도 원문이 화면에 펼쳐지지 않는다', async () => {
  const { user, calls } = renderWritable({ list: [createAccount({ id: 1, provider: 'chatgpt', label: 'ChatGPT 개발', accountEmail: 'dev@example.com' })] })
  await screen.findByTestId('agent-account-row-1')
  await pickRowMenu(user, 1, 'edit')
  const dialog = await screen.findByTestId('agent-account-dialog')
  const toggle = within(dialog).getByTestId('agent-account-replace-toggle')
  await user.click(toggle)
  await user.click(within(dialog).getByTestId('login-info-text'))
  await user.paste(CHATGPT_LOGIN)
  expect(within(dialog).getByTestId('login-info-filled')).toBeInTheDocument()
  // 교체 안 함 → 키 교체: 빈 칸에서 다시 시작하고 원문(토큰 조각)이 어디에도 없다
  await user.click(toggle)
  expect(toggle).toHaveTextContent('키 교체')
  await user.click(toggle)
  expect(within(dialog).getByTestId('login-info-text')).toHaveValue('')
  expect(within(dialog).queryByTestId('login-info-filled')).not.toBeInTheDocument()
  expect(within(dialog).queryByTestId('login-info-check')).not.toBeInTheDocument()
  expect(document.body.innerHTML).not.toContain('rt-fake')
  // 바꾼 것이 없으니 저장도 막힌다
  expect(within(dialog).getByTestId('agent-account-submit')).toBeDisabled()
  expect(calls.updates).toEqual([])
})

test('수정 — Claude 토큰도 「교체 안 함」으로 접으면 비워진다', async () => {
  const { user } = renderWritable()
  await screen.findByTestId('agent-account-row-1')
  await pickRowMenu(user, 1, 'edit')
  const dialog = await screen.findByTestId('agent-account-dialog')
  const toggle = within(dialog).getByTestId('agent-account-replace-toggle')
  await user.click(toggle)
  await user.click(within(dialog).getByLabelText('토큰'))
  await user.paste(TOKEN_64)
  await user.click(toggle)
  await user.click(toggle)
  expect(within(dialog).getByLabelText('토큰')).toHaveValue('')
  expect(document.body.innerHTML).not.toContain(TOKEN_64)
})

test('추가 — 서버 상한(2048자)을 넘는 토큰은 칸 아래에 알리고 보내지 않는다', async () => {
  const { user, calls } = renderWritable()
  const dialog = await openCreate(user)
  await user.click(within(dialog).getByLabelText('토큰'))
  await user.paste('sk-ant-oat01-' + 'a'.repeat(2048))
  expect(within(dialog).getByTestId('agent-account-token-too-long')).toHaveTextContent('토큰이 너무 깁니다 (최대 2048자)')
  expect(within(dialog).getByTestId('agent-account-submit')).toBeDisabled()
  await user.click(within(dialog).getByTestId('agent-account-submit'))
  expect(calls.creates).toEqual([])
  // 상한 안으로 줄이면 알림이 사라지고 보낼 수 있다
  await user.clear(within(dialog).getByLabelText('토큰'))
  await user.click(within(dialog).getByLabelText('토큰'))
  await user.paste(TOKEN_64)
  expect(within(dialog).queryByTestId('agent-account-token-too-long')).not.toBeInTheDocument()
  expect(within(dialog).getByTestId('agent-account-submit')).toBeEnabled()
})

test('추가 — 서버 상한(16384자)을 넘는 로그인 정보는 미리 확인 자리에 알리고 보내지 않는다', async () => {
  const { user, calls } = renderWritable()
  const dialog = await openCreate(user)
  await user.click(within(dialog).getByTestId('agent-account-kind-chatgpt'))
  await user.click(within(dialog).getByTestId('login-info-text'))
  // 형식은 맞는 ChatGPT 로그인 정보지만 군더더기로 상한을 넘긴다
  const big = JSON.stringify({ ...JSON.parse(CHATGPT_LOGIN), pad: 'x'.repeat(16384) })
  await user.paste(big)
  expect(within(dialog).getByTestId('login-info-check')).toHaveTextContent('로그인 정보가 너무 깁니다 (최대 16384자)')
  expect(within(dialog).getByTestId('agent-account-submit')).toBeDisabled()
  expect(calls.creates).toEqual([])
})

test('삭제 — 확인 창에서 삭제하면 DELETE 를 보내고 알린다', async () => {
  const { user, calls } = renderWritable({ list: [createAccount({ id: 1, label: 'Claude 팀 A', agents: [] })] })
  await screen.findByTestId('agent-account-row-1')
  await pickRowMenu(user, 1, 'delete')
  const confirm = await screen.findByTestId('agent-account-delete-dialog')
  expect(confirm).toHaveTextContent('「Claude 팀 A」 계정을 삭제해요')
  await user.click(within(confirm).getByTestId('agent-account-delete-confirm'))
  await waitFor(() => expect(calls.deletes).toEqual(['1']))
  expect(await screen.findByText('계정을 삭제했습니다.')).toBeInTheDocument()
})

test('삭제 — 쓰는 AI 가 있어 거절되면(409) 다른 계정으로 바꾸라고 알린다', async () => {
  const { user, calls } = renderWritable({
    remove: { status: 409, body: { status: 409, message: '이 계정을 쓰는 AI 가 있어요 — AI 를 다른 계정으로 옮긴 뒤 폐기해 주세요', errors: { code: 'AGENT_ACCOUNT_IN_USE' } } },
  })
  await screen.findByTestId('agent-account-row-1')
  await pickRowMenu(user, 1, 'delete')
  const confirm = await screen.findByTestId('agent-account-delete-dialog')
  // 쓰는 AI 가 보이면 확인 창에서도 미리 알린다
  expect(within(confirm).getByTestId('delete-impact')).toHaveTextContent('이 계정을 쓰는 AI 가 1명 있어요')
  await user.click(within(confirm).getByTestId('agent-account-delete-confirm'))
  await waitFor(() => expect(calls.deletes).toEqual(['1']))
  expect(await screen.findByText('쓰는 AI 에서 먼저 다른 계정으로 바꿔 주세요')).toBeInTheDocument()
})

test('수정 — 「키 교체」를 열어 둔 채 키가 비면 라벨만 바꿔도 저장을 막고 안내한다, 「교체 안 함」을 누르면 라벨만 보낸다', async () => {
  const { user, calls } = renderWritable()
  await screen.findByTestId('agent-account-row-1')
  await pickRowMenu(user, 1, 'edit')
  const dialog = await screen.findByTestId('agent-account-dialog')
  const label = within(dialog).getByTestId('agent-account-label')
  await user.clear(label)
  await user.click(label)
  await user.paste('Claude 팀 A2')
  const toggle = within(dialog).getByTestId('agent-account-replace-toggle')
  await user.click(toggle)
  // 키 칸이 비어 있다 — 라벨이 바뀌었어도 저장은 막히고 안내가 보인다
  expect(within(dialog).getByTestId('agent-account-submit')).toBeDisabled()
  expect(within(dialog).getByTestId('agent-account-replace-hint')).toHaveTextContent('키를 넣거나 「교체 안 함」을 눌러 주세요')
  await user.click(toggle)
  expect(within(dialog).queryByTestId('agent-account-replace-hint')).not.toBeInTheDocument()
  await user.click(within(dialog).getByTestId('agent-account-submit'))
  await waitFor(() => expect(calls.updates).toEqual([{ label: 'Claude 팀 A2' }]))
})

test('수정 — OpenAI 호환 키 교체에서 키만 비우고 라벨을 바꿔도 반쪽 연결 정보를 보내지 않는다', async () => {
  const { user, calls } = renderWritable({ list: [createAccount({ id: 1, provider: 'opencode', label: '사내 모델' })] })
  await screen.findByTestId('agent-account-row-1')
  await pickRowMenu(user, 1, 'edit')
  const dialog = await screen.findByTestId('agent-account-dialog')
  await user.click(within(dialog).getByTestId('agent-account-replace-toggle'))
  // 주소는 기본값이 채워져 있지만 키가 없다 — 반쪽
  const label = within(dialog).getByTestId('agent-account-label')
  await user.clear(label)
  await user.click(label)
  await user.paste('사내 모델 2')
  expect(within(dialog).getByTestId('agent-account-submit')).toBeDisabled()
  await user.click(within(dialog).getByTestId('credential-api-key'))
  await user.paste('sk-new')
  await user.click(within(dialog).getByTestId('agent-account-submit'))
  await waitFor(() => expect(calls.updates).toHaveLength(1))
  expect(calls.updates[0]).toMatchObject({ label: '사내 모델 2', providerConfig: { options: { apiKey: 'sk-new' } } })
})

test('추가 — 「연결 확인」 결과는 Base URL·API Key 를 바꾸면 지워진다(지금 값의 결과가 아니므로)', async () => {
  const { user } = renderWritable()
  const dialog = await openCreate(user)
  await user.click(within(dialog).getByTestId('agent-account-kind-opencode'))
  await user.click(within(dialog).getByTestId('credential-api-key'))
  await user.paste('sk-test-key')
  await user.click(within(dialog).getByTestId('agent-account-probe'))
  expect(await within(dialog).findByTestId('agent-account-probe-result')).toHaveTextContent('연결됐어요')
  // 키를 고치면 결과가 사라진다
  await user.type(within(dialog).getByTestId('credential-api-key'), 'x')
  expect(within(dialog).queryByTestId('agent-account-probe-result')).not.toBeInTheDocument()
  // 다시 확인한 뒤 주소를 고쳐도 사라진다
  await user.click(within(dialog).getByTestId('agent-account-probe'))
  expect(await within(dialog).findByTestId('agent-account-probe-result')).toBeInTheDocument()
  await user.type(within(dialog).getByTestId('credential-base-url'), '/')
  expect(within(dialog).queryByTestId('agent-account-probe-result')).not.toBeInTheDocument()
})
