// 설정 › API 토큰(TokenSettingsPage) — 화면 컴포넌트 테스트(WP-971, WP-995).
// 무기한 발급 표기·발급 상한 사유를 창 안에만 보임(WP-835)·만료된 토큰 「만료됨」(WP-702)·표 아래 「도구에 연결하기」 안내(WP-875)는
// 브라우저 없이 판정되므로 e2e/pages/settings/api-tokens.spec.ts 에서 옮겼다. 발급 → 평문 → 목록 → 폐기 배선과 실제 클립보드(@wiring)·
// 휴대폰 폭 가로 넘침(@layout)은 E2E 에 남는다. 설치 명령 복사는 userEvent 의 클립보드 대역으로 읽는다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { MCP_ENDPOINT } from '@/lib/mcpEndpoint'
import { renderScreen } from '@/test/renderScreen'

import TokenSettingsPage from './TokenSettingsPage'

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

/** 토큰 화면을 띄운다 — 발급(POST)은 issue 가 응답을 정하고(기본: 받은 값으로 발급), 발급한 토큰은 다음 목록에 실린다. */
async function openTokens(initial: Token[] = [], issue?: () => Response) {
  let tokens = [...initial]
  const posts: unknown[] = []
  const view = renderScreen(<TokenSettingsPage />, {
    path: '/settings/tokens',
    handlers: [
      http.get('/api/v1/users/me/api-tokens', () => HttpResponse.json(tokens)),
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
  const reason = '개인 API 토큰은 20개까지 쓸 수 있습니다. 쓰지 않는 토큰을 폐기한 뒤 다시 발급하세요'
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
})
