// 설정 › API 토큰(TokenSettingsPage) — 화면 컴포넌트 테스트(WP-971, WP-995).
// 무기한 발급 표기·발급 상한 사유를 창 안에만 보임(WP-835)·만료된 토큰 「만료됨」(WP-702)·표 아래 「도구에 연결하기」 안내(WP-875)는
// 브라우저 없이 판정되므로 e2e/pages/settings/api-tokens.spec.ts 에서 옮겼다. 발급 → 평문 → 목록 → 폐기 배선과 실제 클립보드(@wiring)·
// 휴대폰 폭 가로 넘침(@layout)은 E2E 에 남는다. 설치 명령 복사는 userEvent 의 클립보드 대역으로 읽는다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, expect, test, vi } from 'vitest'

import { oauthConnectionKeys } from '@/hooks/queries/useOAuthConnections'
import { MCP_ENDPOINT } from '@/lib/mcpEndpoint'
import { renderScreen } from '@/test/renderScreen'
import type { OAuthConnection } from '@/types/oauth'

import { oauthConnection } from '../../../e2e/factories/oauth.factory'
import TokenSettingsPage from './TokenSettingsPage'

// scrollIntoView 스파이를 되돌린다.
afterEach(() => {
  vi.restoreAllMocks()
})

interface Token {
  id: number
  name: string
  tokenPrefix: string
  tenantId: number
  expiresAt: string | null
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

const base = { tenantId: 1, createdAt: '2026-09-01T00:00:00Z', lastUsedAt: null, revokedAt: null }
const INSTALL = `/plugin marketplace add ${window.location.origin}/claude/marketplace.json\n/plugin install genia-works@genia-works`
// 활성 토큰 20개 상한(WP-818)에 걸렸을 때 서버가 돌려주는 사유 — 서버 거절을 다루는 여러 테스트가 같은 문구를 쓴다.
const LIMIT_REASON = '개인 API 토큰은 20개까지 쓸 수 있습니다. 쓰지 않는 토큰을 폐기한 뒤 다시 발급하세요'

/** 토큰 화면을 띄운다 — 발급(POST)은 issue 가 응답을 정하고(기본: 받은 값으로 발급), 발급한 토큰은 다음 목록에 실린다.
 *  connections 는 「연결된 앱」 절(WP-1687)이 읽는 내 앱 연결 목록(기본 빈 목록 — 절이 숨는다). 이 GET 이 없으면 처리 못 한 요청으로 실패한다. */
async function openTokens(initial: Token[] = [], issue?: () => Response | Promise<Response>, connections: OAuthConnection[] = []) {
  let tokens = [...initial]
  const posts: unknown[] = []
  const view = renderScreen(<TokenSettingsPage />, {
    path: '/settings/tokens',
    handlers: [
      http.get('/api/v1/users/me/api-tokens', () => HttpResponse.json(tokens)),
      http.get('/api/v1/users/me/oauth-connections', () => HttpResponse.json(connections)),
      http.post('/api/v1/users/me/api-tokens', async ({ request }) => {
        const body = (await request.json()) as { name: string; expiresAt: string | null }
        posts.push(body)
        if (issue) return issue()
        const t: Token = { ...base, id: tokens.length + 1, name: body.name, tokenPrefix: 'swp_test1', expiresAt: body.expiresAt }
        tokens = [...tokens, t]
        return HttpResponse.json({ ...t, plaintextToken: 'swp_PLAINTEXT_1_abcdefg' })
      }),
    ],
  })
  await screen.findByRole('table', { name: 'API 토큰 목록' })
  return { ...view, posts }
}

type User = Awaited<ReturnType<typeof openTokens>>['user']

/** 발급 창을 열고 이름을 넣는다. expiry 를 주면 유효기간을 고른다. */
async function fillIssueForm(user: User, name: string, expiry?: string) {
  await user.click(screen.getByTestId('token-issue-open'))
  const form = within(await screen.findByTestId('token-issue-form-dialog'))
  await user.click(form.getByLabelText('토큰 이름'))
  await user.paste(name)
  if (expiry) {
    await user.click(form.getByTestId('token-expiry-select'))
    await user.click(await screen.findByRole('option', { name: expiry }))
  }
  return form
}

test('유효기간을 무기한으로 발급하면 발급 창과 목록에 무기한으로 보인다', async () => {
  const { user, posts } = await openTokens()
  const form = await fillIssueForm(user, 'no-expiry-token', '무기한')
  await user.click(form.getByTestId('token-issue-submit'))
  expect(await screen.findByTestId('token-issue-expiry')).toHaveTextContent('무기한')
  expect(posts).toEqual([{ name: 'no-expiry-token', expiresAt: null }])
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByTestId('token-issue-dialog')).not.toBeInTheDocument())
  expect(await screen.findByTestId('token-row-1')).toHaveTextContent('무기한')
})

// WP-835 — 활성 토큰 20개 상한(WP-818)에 걸리면 서버 사유를 발급 창 안에 보이고, 같은 내용을 토스트로 한 번 더 띄우지 않는다.
test('발급이 상한에 걸리면 서버 사유를 발급 창 안에 보이고 토스트는 띄우지 않는다 (WP-835)', async () => {
  const reason = LIMIT_REASON
  const { user } = await openTokens([], () => HttpResponse.json({ message: reason }, { status: 400 }))
  const form = await fillIssueForm(user, 'one-too-many')
  await user.click(form.getByTestId('token-issue-submit'))
  // 창 안에 사유 그대로(스크린리더가 읽게 role=alert) — 사유 없는 「토큰 발급에 실패했습니다.」가 아니다.
  const error = await form.findByTestId('token-issue-error')
  expect(error).toHaveTextContent(reason)
  expect(error).toHaveAttribute('role', 'alert')
  // 창은 열린 채이고 같은 사유의 토스트는 없다.
  expect(screen.getByTestId('token-issue-form-dialog')).toBeInTheDocument()
  expect(document.querySelectorAll('[data-sonner-toast]')).toHaveLength(0)
})

// WP-1776 — 빈 이름으로 발급하면 안내를 화면 읽기가 바로 읽고(role=alert), 이름 칸이 그 안내와 이어진다(aria-invalid·aria-describedby).
test('빈 이름으로 발급하면 안내가 role=alert 로 뜨고 이름 칸에 aria-invalid·aria-describedby 가 이어진다 (WP-1776)', async () => {
  const { user, posts } = await openTokens()
  await user.click(screen.getByTestId('token-issue-open'))
  const form = within(await screen.findByTestId('token-issue-form-dialog'))
  const input = form.getByLabelText('토큰 이름')
  expect(input).not.toHaveAttribute('aria-invalid')
  await user.click(form.getByTestId('token-issue-submit'))
  const alert = await form.findByRole('alert')
  expect(alert).toHaveTextContent('토큰 이름을 입력하세요')
  expect(input).toHaveAttribute('aria-invalid', 'true')
  expect(input).toHaveAttribute('aria-describedby', alert.id)
  expect(input).toHaveAccessibleDescription('토큰 이름을 입력하세요')
  expect(posts).toEqual([])
})

// WP-1776 — 공백만 넣은 이름은 trim 뒤 비므로 빈 이름과 같은 안내가 뜨고 서버로 나가지 않는다.
test('공백만 있는 이름도 빈 이름과 같은 안내를 alert 로 보이고 발급하지 않는다 (WP-1776)', async () => {
  const { user, posts } = await openTokens()
  const form = await fillIssueForm(user, '   ')
  await user.click(form.getByTestId('token-issue-submit'))
  const alert = await form.findByRole('alert')
  expect(alert).toHaveTextContent('토큰 이름을 입력하세요')
  expect(form.getByLabelText('토큰 이름')).toHaveAttribute('aria-invalid', 'true')
  expect(posts).toEqual([])
})

// WP-1776 — 안내는 고쳐 다시 보내면 거두어진다. 낡은 안내가 남으면 성공했는데도 오류로 읽힌다.
test('안내가 뜬 뒤 이름을 채워 다시 보내면 안내가 사라지고 발급된다 (WP-1776)', async () => {
  const { user, posts } = await openTokens()
  await user.click(screen.getByTestId('token-issue-open'))
  const form = within(await screen.findByTestId('token-issue-form-dialog'))
  await user.click(form.getByTestId('token-issue-submit'))
  expect(await form.findByRole('alert')).toHaveTextContent('토큰 이름을 입력하세요')
  await user.click(form.getByLabelText('토큰 이름'))
  await user.paste('claude-code')
  // 이름을 채운 직후(발급 전)에도 안내와 aria-invalid 가 거두어져 있어야 한다.
  await waitFor(() => expect(form.queryByRole('alert')).not.toBeInTheDocument())
  expect(form.getByLabelText('토큰 이름')).not.toHaveAttribute('aria-invalid')
  await user.click(form.getByTestId('token-issue-submit'))
  await waitFor(() => expect(posts).toHaveLength(1))
  // 발급되면 이름 입력 창은 닫히고 결과 창으로 바뀐다 — 이름 창이 사라졌고 alert 도 남지 않는다.
  await waitFor(() => expect(screen.queryByTestId('token-issue-form-dialog')).not.toBeInTheDocument())
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

// WP-1776 — 발급 요청이 도는 동안 이름·유효기간을 막아, 늦게 온 서버 사유가 바뀐 값 아래에 붙는 경쟁을 없앤다.
test('발급 요청 중에는 이름 칸과 유효기간이 막히고 거절 뒤 다시 편집된다 (WP-1776)', async () => {
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const { user } = await openTokens([], async () => {
    await gate
    return HttpResponse.json({ message: '거절' }, { status: 400 })
  })
  const form = await fillIssueForm(user, 'slow-one')
  await user.click(form.getByTestId('token-issue-submit'))
  await waitFor(() => expect(form.getByLabelText('토큰 이름')).toBeDisabled())
  expect(form.getByTestId('token-expiry-select')).toBeDisabled()
  release()
  expect(await form.findByTestId('token-issue-error')).toHaveTextContent('거절')
  expect(form.getByLabelText('토큰 이름')).toBeEnabled()
  expect(form.getByTestId('token-expiry-select')).toBeEnabled()
})

// WP-1776 — 오류 상태로 닫은 창을 다시 열면 이전 안내·aria-invalid 가 이월되지 않는다.
test('오류 상태에서 창을 닫았다 다시 열면 안내가 없다 (WP-1776)', async () => {
  const { user } = await openTokens()
  await user.click(screen.getByTestId('token-issue-open'))
  const first = within(await screen.findByTestId('token-issue-form-dialog'))
  await user.click(first.getByTestId('token-issue-submit'))
  expect(await first.findByRole('alert')).toBeInTheDocument()
  await user.click(first.getByRole('button', { name: '취소' }))
  await waitFor(() => expect(screen.queryByTestId('token-issue-form-dialog')).not.toBeInTheDocument())
  await user.click(screen.getByTestId('token-issue-open'))
  const form = within(await screen.findByTestId('token-issue-form-dialog'))
  expect(form.queryByRole('alert')).not.toBeInTheDocument()
  expect(form.getByLabelText('토큰 이름')).not.toHaveAttribute('aria-invalid')
})

// WP-1776 — 서버가 거절한 뒤 이름을 비우고 다시 보내면 클라이언트 검증이 먼저 막아 제출 함수가 불리지 않는다.
// 그때 지난 서버 사유가 남으면 이름 안내와 함께 alert 두 개가 읽혀 지금 입력과 모순된다.
test('서버 거절 뒤 이름을 비우고 다시 보내면 이름 안내만 alert 로 읽힌다 (WP-1776)', async () => {
  const reason = LIMIT_REASON
  const { user } = await openTokens([], () => HttpResponse.json({ message: reason }, { status: 400 }))
  const form = await fillIssueForm(user, 'one-too-many')
  await user.click(form.getByTestId('token-issue-submit'))
  expect(await form.findByTestId('token-issue-error')).toHaveTextContent(reason)
  await user.clear(form.getByLabelText('토큰 이름'))
  await user.click(form.getByTestId('token-issue-submit'))
  await waitFor(() => expect(form.getAllByRole('alert')).toHaveLength(1))
  expect(form.getByRole('alert')).toHaveTextContent('토큰 이름을 입력하세요')
  expect(form.queryByTestId('token-issue-error')).not.toBeInTheDocument()
})

// WP-1776 — 서버 사유는 「그때 보낸 값」에 대한 답이라 유효기간만 바꿔도 더는 맞지 않아 지운다.
test('서버 거절 뒤 유효기간만 바꿔도 지난 서버 사유가 사라진다 (WP-1776)', async () => {
  const reason = LIMIT_REASON
  const { user } = await openTokens([], () => HttpResponse.json({ message: reason }, { status: 400 }))
  const form = await fillIssueForm(user, 'one-too-many')
  await user.click(form.getByTestId('token-issue-submit'))
  expect(await form.findByTestId('token-issue-error')).toHaveTextContent(reason)
  await user.click(form.getByTestId('token-expiry-select'))
  // Radix Select 의 옵션은 포털에 그려져 form 범위 밖이므로 screen 에서 찾는다.
  await user.click(await screen.findByRole('option', { name: '60일' }))
  await waitFor(() => expect(form.queryByTestId('token-issue-error')).not.toBeInTheDocument())
})

// WP-702 — 만료일이 지난 토큰은 서버가 거절하므로 「활성」이 아니라 「만료됨」으로 보이고, 폐기 버튼은 남는다.
test('만료일이 지난 토큰은 「만료됨」으로 표시되고 폐기 버튼은 남는다 (WP-702)', async () => {
  await openTokens([
    { ...base, id: 1, name: 'expired-token', tokenPrefix: 'swp_old', expiresAt: '2020-01-01T00:00:00Z' },
    { ...base, id: 2, name: 'live-token', tokenPrefix: 'swp_new', expiresAt: '2999-01-01T00:00:00Z' },
  ])
  const expired = within(await screen.findByTestId('token-row-1'))
  expect(expired.getByText('만료됨', { exact: true })).toBeInTheDocument()
  expect(expired.queryByText('활성', { exact: true })).not.toBeInTheDocument()
  expect(screen.getByTestId('token-revoke-1')).toBeInTheDocument()
  expect(within(screen.getByTestId('token-row-2')).getByText('활성', { exact: true })).toBeInTheDocument()
})

// WP-875 — 발급 모달을 닫은 뒤에도 표 아래 「도구에 연결하기」에서 같은 연결 안내를 본다. 토큰 값은 다시 보이지 않으므로
// 2단계는 「발급 때 복사한 토큰」·새로 발급 안내로 바뀐다. 평문 토큰·토큰이 든 명령은 어디에도 없다.
test('토큰 화면에서 발급 없이도 연결 안내를 늘 볼 수 있다 (WP-875)', async () => {
  const { user } = await openTokens([{ ...base, id: 1, name: 'claude-code', tokenPrefix: 'swp_abc', expiresAt: null }])
  const guideEl = await screen.findByRole('region', { name: '도구에 연결하기' })
  const guide = within(guideEl)
  expect(guide.getByTestId('connect-guide-plugin-install-command')).toHaveTextContent(
    `/plugin marketplace add ${window.location.origin}/claude/marketplace.json`,
  )
  const tokenStep = guide.getByTestId('connect-guide-plugin-token-step')
  expect(tokenStep).toHaveTextContent('발급 때 복사한 토큰')
  expect(tokenStep).not.toHaveTextContent('위 토큰')
  expect(guideEl).toHaveTextContent('잃어버렸으면 새로 발급하세요')
  // 운영 기본 주소가 아닌 배포라 서버 주소 바꾸기 안내가 보이고, 바꿀 주소는 이 배포의 MCP 주소다(모달과 같은 값, WP-387).
  expect(guide.getByTestId('connect-guide-server-url')).toHaveTextContent(MCP_ENDPOINT)
  expect(guideEl).not.toHaveTextContent('swp_')
  expect(guideEl).not.toHaveTextContent('--header')

  // 다른 도구 안내는 접혀 있다가 펼치면 모달과 같은 연결 주소가 보인다(WP-387).
  expect(guide.queryByTestId('connect-guide-mcp-endpoint')).not.toBeInTheDocument()
  await user.click(guide.getByTestId('connect-guide-other-tools'))
  expect(guide.getByTestId('connect-guide-mcp-endpoint')).toHaveTextContent(MCP_ENDPOINT)

  // 설치 명령 복사 — 클립보드에 모달과 같은 설치 명령 두 줄이 들어간다.
  await user.click(guide.getByTestId('connect-guide-plugin-install-command-copy'))
  await waitFor(async () => expect(await navigator.clipboard.readText()).toBe(INSTALL))

  // 두 복사 버튼은 무엇을 복사하는지 접근 이름으로 구분된다 — 둘 다 「명령 복사」라 주소 버튼도 명령이라 읽혔다(WP-1434).
  expect(guide.getByRole('button', { name: '설치 명령 복사' })).toBe(guide.getByTestId('connect-guide-plugin-install-command-copy'))
  await user.click(guide.getByRole('button', { name: '연결 주소 복사' }))
  await waitFor(async () => expect(await navigator.clipboard.readText()).toBe(MCP_ENDPOINT))
  expect(guide.queryByRole('button', { name: '명령 복사' })).not.toBeInTheDocument()
})

// WP-1506 — 도움말 문맥 고르기의 예시 화면. 화면 칸·대화상자의 data-help 가 매뉴얼 12장 도움말 id(tokens 층)와 짝을 이룬다.
test('화면 칸과 발급·폐기 대화상자에 도움말 id(data-help)가 달려 있다 (WP-1506)', async () => {
  const { user } = await openTokens([{ ...base, id: 1, name: 'ci', tokenPrefix: 'swp_ci', expiresAt: null }])
  expect(document.querySelector('[data-help="tokens"]')).toContainElement(screen.getByRole('table', { name: 'API 토큰 목록' }))
  expect(screen.getByRole('table', { name: 'API 토큰 목록' }).closest('[data-help]')).toHaveAttribute('data-help', 'tokens.list')
  expect(screen.getByTestId('token-connect-guide')).toHaveAttribute('data-help', 'tokens.connect')
  expect(screen.getByTestId('token-issue-open')).toHaveAttribute('data-help', 'tokens.issue')
  await user.click(screen.getByTestId('token-issue-open'))
  expect(await screen.findByRole('dialog')).toHaveAttribute('data-help', 'tokens.issue')
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await user.click(screen.getByTestId('token-revoke-1'))
  expect(await screen.findByRole('alertdialog')).toHaveAttribute('data-help', 'tokens.list')
})

// WP-1687 — 「연결된 앱」 절은 토큰 표 아래·「도구에 연결하기」 위에 놓이고, 도움말 칸(tokens) 안에 든다. 연결이 없으면 절이 없다.
test('연결이 있으면 「연결된 앱」 절이 토큰 표와 「도구에 연결하기」 사이에 있다 (WP-1687)', async () => {
  await openTokens([], undefined, [oauthConnection()])
  const apps = await screen.findByRole('region', { name: '연결된 앱' })
  const tokens = screen.getByRole('table', { name: 'API 토큰 목록' })
  const guide = screen.getByRole('region', { name: '도구에 연결하기' })
  expect(tokens.compareDocumentPosition(apps) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(apps.compareDocumentPosition(guide) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(document.querySelector('[data-help="tokens"]')).toContainElement(apps)
})

test('연결이 없으면 「연결된 앱」 절이 없다 (WP-1687)', async () => {
  const { queryClient } = await openTokens()
  // 연결 목록 응답이 쿼리에 실려 빈 목록으로 확정된 뒤에 본다 — 응답 전(로딩 중 숨김)에 보면 거짓으로 통과한다.
  await waitFor(() => expect(queryClient.getQueryState(oauthConnectionKeys.mine)?.status).toBe('success'))
  expect(screen.getByRole('region', { name: '도구에 연결하기' })).toBeInTheDocument()
  expect(screen.queryByRole('region', { name: '연결된 앱' })).not.toBeInTheDocument()
})

// WP-1687 — 알림·푸시가 여는 #connected-apps 는 토큰 표가 처음 불러오기를 마친 뒤에 스크롤한다(표가 길어지며 절이 밀리지 않게).
// 토큰 쿼리는 이 페이지가 가지고 절에는 scrollReady 로 넘기므로, 두 칸이 이어진 배선은 페이지에서 본다.
test('#connected-apps 로 열면 토큰 목록이 늦게 와도 그 뒤에 절로 한 번 스크롤한다 (WP-1687)', async () => {
  const spy = vi.spyOn(Element.prototype, 'scrollIntoView')
  let release: () => void = () => {}
  const opened = new Promise<void>((resolve) => {
    release = resolve
  })
  renderScreen(<TokenSettingsPage />, {
    path: '/settings/tokens#connected-apps',
    handlers: [
      http.get('/api/v1/users/me/api-tokens', async () => {
        await opened
        return HttpResponse.json([])
      }),
      http.get('/api/v1/users/me/oauth-connections', () => HttpResponse.json([oauthConnection()])),
    ],
  })
  await screen.findByTestId('oauth-connection-row-1')
  expect(spy).not.toHaveBeenCalled()
  release()
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
  expect(spy.mock.contexts[0]).toBe(screen.getByTestId('connected-apps'))
})

// WP-1687 — 토큰 없이 OAuth 로 연결하는 Claude 앱 커넥터 주소를 토큰 화면 「도구에 연결하기」에서 복사한다.
test('「Claude 앱에 연결」이 Claude Code 안내 뒤·다른 도구 접힘 앞에 있고 커넥터 주소를 복사한다 (WP-1687)', async () => {
  const { user } = await openTokens()
  const guide = within(await screen.findByRole('region', { name: '도구에 연결하기' }))
  const block = guide.getByTestId('connect-guide-claude-app')
  expect(block).toHaveAttribute('data-help', 'tokens.claude-app')
  expect(within(block).getByText('Claude 앱에 연결')).toBeInTheDocument()
  expect(block).toHaveTextContent(
    'Claude 앱(데스크톱·웹)의 커넥터 추가 화면에 아래 주소를 넣으세요. 토큰은 필요 없어요 — 로그인한 뒤 동의 화면에서 워크스페이스를 고르고 허용하면 연결됩니다.',
  )
  // 연결이 없으면 「연결된 앱」 절이 없으니 「위」라고 가리키지 않는다 — 늘 보여도 맞는 말(코드 리뷰 #5).
  expect(block).toHaveTextContent('연결하면 이 화면의 「연결된 앱」에서 보고 끊을 수 있어요.')
  expect(guide.getByTestId('connect-guide-claude-app-url')).toHaveTextContent(MCP_ENDPOINT)
  // 순서: 3단계 확인 → Claude 앱 → 다른 도구 접힘
  const step3 = guide.getByText('3. 확인')
  const other = guide.getByTestId('connect-guide-other-tools')
  expect(step3.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(block.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(other).toHaveTextContent('다른 도구로 연결 (ChatGPT 등)')
  await user.click(guide.getByRole('button', { name: '커넥터 주소 복사' }))
  await waitFor(async () => expect(await navigator.clipboard.readText()).toBe(MCP_ENDPOINT))
  expect(await screen.findByText('커넥터 주소를 복사했습니다')).toBeInTheDocument()
})

// 발급 결과 창은 토큰을 막 발급한 사람에게 토큰 없는 연결을 섞지 않으려 Claude 앱 블록을 두지 않는다.
test('토큰 발급 결과 창에는 Claude 앱 블록이 없다 (WP-1687)', async () => {
  const { user } = await openTokens()
  const form = await fillIssueForm(user, 'for-modal')
  await user.click(form.getByTestId('token-issue-submit'))
  const dialog = within(await screen.findByTestId('token-issue-dialog'))
  expect(dialog.queryByText('Claude 앱에 연결')).toBeNull()
  expect(dialog.queryByTestId(/claude-app/)).toBeNull()
})
