// 메일 AI 비서(목록 배지·요약·AI 답장 초안) — 화면 테스트(WP-984, WP-995).
// 배지 문구·행/배지 클릭 분리·요약 자동 조회·SKIPPED 버튼 생성·EMPTY·옮긴 뒤 결과 격리·실패 토스트·답장 초안 프리필/이스케이프/로딩·
// 손대지 않은 초안의 ✕·aiAvailable=false 게이트는 브라우저 없이 판정되므로 e2e/pages/mail/mail-ai.spec.ts 에서 옮겼다.
// 긴 초안에서 에디터 높이가 묶여 스크롤되는지는 그 E2E(@layout)가 지킨다.
// 메일 모듈 + 작성 도크만 renderScreen 으로 띄운다(testkit-b4).
import { act, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, expect, test, vi } from 'vitest'

import { testAuthValue } from '@/test/renderWithProviders'
import type { EmailMessageSummary } from '@/types/mailMessage'

import { detail, mailAccount, summary } from '../../../e2e/factories/mail.factory'
import { record, renderMail } from './testkit-b4'

afterEach(() => {
  vi.restoreAllMocks()
})

const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)))
const aiAccount = [mailAccount({ aiEnabled: true })]

/** AI 켠 계정 + 목록 + 7번(·8번) 상세. extra 가 기본보다 우선한다. */
function renderAi(rows: EmailMessageSummary[] = [summary({ id: 7, fromAddress: 'alice@example.com' })], extra: NonNullable<Parameters<typeof renderMail>[1]>['handlers'] = [], auth?: NonNullable<Parameters<typeof renderMail>[1]>['auth']) {
  return renderMail('/mail/1', {
    accounts: aiAccount,
    auth,
    handlers: [
      ...(extra ?? []),
      http.get('/api/v1/mail/accounts/1/messages', () => HttpResponse.json(rows)),
      http.get('/api/v1/mail/messages/:id', ({ params }) =>
        HttpResponse.json(detail({ id: Number(params.id), fromAddress: 'alice@example.com', bodyText: `본문 ${String(params.id)}` })),
      ),
    ],
  })
}

// ── 목록 배지 ─────────────────────────────────────────────

test('목록 배지 — 카테고리 칩과 답장필요 점', async () => {
  renderAi([summary({ id: 7, aiCategory: '업무', aiNeedsReply: true })])
  expect(await screen.findByTestId('mail-badge-category-7')).toHaveTextContent('업무')
  expect(screen.getByTestId('mail-badge-needsreply-7')).toBeInTheDocument()
})

test('목록 배지 클릭 — 행은 role=button div, 배지는 독립 button 이라 필터만 걸리고 행은 열리지 않으며 중첩 경고가 없다(#577)', async () => {
  const errors = vi.spyOn(console, 'error')
  const { user, location } = renderAi([summary({ id: 7, aiCategory: '개인', aiNeedsReply: true })])
  const row = await screen.findByTestId('mail-row-7')
  expect(row.tagName).toBe('DIV')
  const badge = screen.getByTestId('mail-badge-category-7')
  expect(badge.tagName).toBe('BUTTON')
  await user.click(badge)
  await waitFor(() => expect(location()).toMatch(/category=/))
  await wait(50)
  expect(location()).not.toMatch(/messageId=/)
  expect(screen.getByTestId('mail-detail-empty')).toBeInTheDocument()
  await user.click(screen.getByTestId('mail-row-7'))
  expect(await screen.findByTestId('mail-detail')).toBeInTheDocument()
  const nested = errors.mock.calls.map((c) => c.map(String).join(' ')).filter((m) => /cannot (be|contain) a( nested)? <?button/i.test(m))
  expect(nested).toEqual([])
})

// ── 요약 ─────────────────────────────────────────────

test('열람하면 요약을 자동으로 불러와 「AI 요약」 라벨 카드에 보인다', async () => {
  const { user } = renderAi(undefined, [http.get('/api/v1/mail/messages/7/summary', () => HttpResponse.json({ summary: '• AI 아우라 요약 텍스트' }))])
  await user.click(await screen.findByTestId('mail-row-7'))
  await waitFor(() => expect(screen.getByTestId('mail-ai-summary')).toHaveTextContent('AI 아우라 요약 텍스트'))
  expect(screen.getByTestId('mail-ai-summary')).toHaveTextContent('AI 요약')
})

/** 요약 GET(상태)·POST(생성) — POST 요청을 기록한다(WP-149). */
function summaryFlow(getBody: { summary: string | null; status: 'READY' | 'SKIPPED' | 'EMPTY' }, post: () => Response) {
  const gets = record('get', '/api/v1/mail/messages/7/summary', () => HttpResponse.json(getBody))
  const posts = record('post', '/api/v1/mail/messages/7/summary', post)
  return { gets, posts, handlers: [gets.handler, posts.handler] }
}

test('요약 생략(SKIPPED) 메일 — 「AI 요약」 버튼을 누르면 만든 요약이 카드로 보이고 버튼은 사라진다', async () => {
  const flow = summaryFlow({ summary: null, status: 'SKIPPED' }, () => HttpResponse.json({ summary: '• 버튼으로 만든 요약', status: 'READY' }))
  const { user } = renderAi(undefined, flow.handlers)
  await user.click(await screen.findByTestId('mail-row-7'))
  const button = await screen.findByTestId('mail-ai-summary-generate')
  expect(button).toHaveTextContent('AI 요약')
  expect(screen.queryByTestId('mail-ai-summary')).not.toBeInTheDocument()
  await user.click(button)
  await waitFor(() => expect(screen.getByTestId('mail-ai-summary')).toHaveTextContent('버튼으로 만든 요약'))
  expect(screen.queryByTestId('mail-ai-summary-generate')).not.toBeInTheDocument()
  expect(flow.posts.calls).toHaveLength(1)
})

test('요약 없음(EMPTY) — 카드도 버튼도 없다', async () => {
  const flow = summaryFlow({ summary: null, status: 'EMPTY' }, () => HttpResponse.json({}))
  const { user } = renderAi(undefined, flow.handlers)
  await user.click(await screen.findByTestId('mail-row-7'))
  await screen.findByTestId('mail-detail')
  await waitFor(() => expect(flow.gets.calls.length).toBeGreaterThan(0))
  await wait(50)
  expect(screen.queryByTestId('mail-ai-summary')).not.toBeInTheDocument()
  expect(screen.queryByTestId('mail-ai-summary-generate')).not.toBeInTheDocument()
})

test('「AI 요약」 생성 중 다른 메일로 옮기면 결과는 원래 메일에만 들어간다', async () => {
  let release!: () => void
  const held = new Promise<void>((r) => (release = r))
  const { user } = renderAi(
    [summary({ id: 7 }), summary({ id: 8 })],
    [
      http.post('/api/v1/mail/messages/:id/summary', async () => {
        await held
        return HttpResponse.json({ summary: '• 7번 요약', status: 'READY' })
      }),
      http.get('/api/v1/mail/messages/:id/summary', () => HttpResponse.json({ summary: null, status: 'SKIPPED' })),
    ],
  )
  await user.click(await screen.findByTestId('mail-row-7'))
  await user.click(await screen.findByTestId('mail-ai-summary-generate'))
  await user.click(screen.getByTestId('mail-row-8'))
  await waitFor(() => expect(screen.getByTestId('mail-detail')).toHaveTextContent('본문 8'))
  expect(await screen.findByTestId('mail-ai-summary-generate')).toBeInTheDocument()
  release()
  await wait(100)
  expect(screen.queryByTestId('mail-ai-summary')).not.toBeInTheDocument()
  await user.click(screen.getByTestId('mail-row-7'))
  await waitFor(() => expect(screen.getByTestId('mail-ai-summary')).toHaveTextContent('7번 요약'))
})

test('「AI 요약」 실패 — 서버 문구 토스트, 버튼은 남는다', async () => {
  const msg = 'AI 요청에 실패했어요. 잠시 후 다시 시도해주세요.'
  const flow = summaryFlow({ summary: null, status: 'SKIPPED' }, () => HttpResponse.json({ message: msg }, { status: 502 }))
  const { user } = renderAi(undefined, flow.handlers)
  await user.click(await screen.findByTestId('mail-row-7'))
  await user.click(await screen.findByTestId('mail-ai-summary-generate'))
  expect(await screen.findByText(msg)).toBeInTheDocument()
  expect(screen.getByTestId('mail-ai-summary-generate')).toBeInTheDocument()
})

test('aiAvailable=false — 요약 카드·답장 초안 버튼이 없고 요약 API 를 부르지 않는다', async () => {
  const sums = record('get', '/api/v1/mail/messages/:id/summary', () => HttpResponse.json({ summary: '요약' }))
  const { user } = renderAi(undefined, [sums.handler], { user: { ...testAuthValue.user!, aiAvailable: false } })
  await user.click(await screen.findByTestId('mail-row-7'))
  await screen.findByTestId('mail-detail')
  await wait(100)
  expect(sums.calls).toHaveLength(0)
  expect(screen.queryByTestId('mail-ai-summary')).not.toBeInTheDocument()
  expect(screen.queryByTestId('mail-ai-reply-draft')).not.toBeInTheDocument()
})

// ── AI 답장 초안 ─────────────────────────────────────────────

const replyDraft = (draftBody: string, gate?: Promise<void>) =>
  http.post('/api/v1/mail/messages/7/reply-draft', async () => {
    if (gate) await gate
    return HttpResponse.json({ draftBody })
  })

test('AI 답장 초안 — 생성 중엔 「초안 작성 중」 비활성, 응답이 오면 작성 도크 본문에 채운다', async () => {
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  const { user } = renderAi(undefined, [replyDraft('AI가 작성한 답장', gate)])
  await user.click(await screen.findByTestId('mail-row-7'))
  const btn = await screen.findByTestId('mail-ai-reply-draft')
  await user.click(btn)
  await waitFor(() => expect(btn).toHaveTextContent('초안 작성 중'))
  expect(btn).toBeDisabled()
  release()
  expect(await screen.findByTestId('mail-compose-dock')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByTestId('mail-composer-body')).toHaveTextContent('AI가 작성한 답장'))
})

test('AI 답장 초안의 HTML 특수문자는 이스케이프돼 글자 그대로 보인다', async () => {
  // 「<b」처럼 태그로 읽힐 수 있는 꼴 — 이스케이프 없이 넣으면 '<' 뒤가 태그로 먹혀 글자가 사라진다.
  const { user } = renderAi(undefined, [replyDraft('조건은 a<b & c 입니다')])
  await user.click(await screen.findByTestId('mail-row-7'))
  await user.click(await screen.findByTestId('mail-ai-reply-draft'))
  await waitFor(() => expect(screen.getByTestId('mail-composer-body')).toHaveTextContent('조건은 a<b & c 입니다'))
})

test('손대지 않은 AI 답장 초안은 ✕ 로 저장 없이 닫고, 고친 뒤엔 임시저장하고 닫는다(WP-577)', async () => {
  const drafts = record<{ bodyHtml: string }>('post', '/api/v1/mail/drafts', () =>
    HttpResponse.json({ id: 77, version: 1, updatedAt: '2026-10-21T01:00:00Z' }),
  )
  const { user } = renderAi(undefined, [drafts.handler, replyDraft('AI가 작성한 답장')])
  await user.click(await screen.findByTestId('mail-row-7'))
  await user.click(await screen.findByTestId('mail-ai-reply-draft'))
  await waitFor(() => expect(screen.getByTestId('mail-composer-body')).toHaveTextContent('AI가 작성한 답장'))
  await user.click(screen.getByTestId('mail-compose-close'))
  await waitFor(() => expect(screen.queryByTestId('mail-compose-dock')).not.toBeInTheDocument())
  await wait(100)
  expect(drafts.calls).toHaveLength(0)

  await user.click(screen.getByTestId('mail-ai-reply-draft'))
  await waitFor(() => expect(screen.getByTestId('mail-composer-body')).toHaveTextContent('AI가 작성한 답장'))
  await user.click(screen.getByTestId('mail-composer-body'))
  await user.keyboard(' 덧붙임')
  await user.click(screen.getByTestId('mail-compose-close'))
  await waitFor(() => expect(screen.queryByTestId('mail-compose-dock')).not.toBeInTheDocument())
  await waitFor(() => expect(drafts.calls).toHaveLength(1))
  expect(drafts.last().body.bodyHtml).toContain('AI가 작성한 답장')
  expect(drafts.last().body.bodyHtml).toContain('덧붙임')
})
