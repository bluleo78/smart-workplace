// 노트 상단 AI 요약 카드(WP-301) — 화면 컴포넌트 테스트(WP-971, WP-995, WP-983).
// 자동 생성 1회·로딩·목록/문단 렌더·비노출 상태(TOO_SHORT·UNAVAILABLE)·서버 STALE·실패 뒤 다시 시도·접근 상실·노트 이동 중 응답 격리·
// AI 불가 사용자는 브라우저 없이 판정되므로 e2e/pages/wiki/wiki-summary.spec.ts 에서 옮겼다.
// 카드 위치(제목 아래·본문 위)·목록 들여쓰기(@layout)와 본문 저장 → 낡음 배선(@platform)은 E2E 에 남는다. 카드만 renderScreen 으로 띄운다.
import { screen, waitFor } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { useState } from 'react'
import { expect, test } from 'vitest'

import { renderScreen } from '@/test/renderScreen'
import { testAuthValue } from '@/test/renderWithProviders'
import type { WikiPageSummaryState, WikiSummaryStatus } from '@/types/wiki'

import { WikiSummaryCard } from './WikiSummaryCard'

const PAGE_ID = 300
const OTHER_ID = 301

const state = (status: WikiSummaryStatus, over: Partial<WikiPageSummaryState> = {}): WikiPageSummaryState => ({
  summary: null,
  status,
  summaryVersion: null,
  pageVersion: 1,
  summarizedAt: null,
  ...over,
})
const ready = (summary = '배포를 10/9 로 확정했다.') =>
  state('READY', { summary, summaryVersion: 1, summarizedAt: '2026-10-08T05:20:00Z' })

/** 요약 조회·생성 목 — 초기 GET 응답과 POST 결과(또는 502 실패), POST 를 붙잡아 둘 hold 를 받는다. 호출 수를 센다. */
function summaryHandlers(pageId: number, opts: { initial: WikiPageSummaryState; post?: WikiPageSummaryState | 'fail'; hold?: Promise<void> }) {
  let current = opts.initial
  const calls = { get: 0, post: 0 }
  const handlers = [
    http.get(`/api/v1/wiki/pages/${pageId}/summary`, () => {
      calls.get++
      return HttpResponse.json(current)
    }),
    http.post(`/api/v1/wiki/pages/${pageId}/summary`, async () => {
      calls.post++
      if (opts.hold) await opts.hold
      if (!opts.post || opts.post === 'fail') return HttpResponse.json({ message: '노트 요약 AI 요청에 실패했습니다.' }, { status: 502 })
      current = opts.post
      return HttpResponse.json(current)
    }),
  ]
  return { handlers, calls }
}

/**
 * 카드의 props 를 바꾸는 받침 — renderScreen 의 감싸개(QueryClient 등)를 유지한 채 노트 이동·접근 상실을 흉내 낸다.
 * 「바꾸기」 버튼을 누르면 next 의 props 로 다시 그린다(같은 카드 인스턴스).
 */
function Switcher({ first, next }: { first: Props; next: Props }) {
  const [props, setProps] = useState(first)
  return (
    <>
      <WikiSummaryCard {...props} />
      <button type="button" onClick={() => setProps(next)}>
        바꾸기
      </button>
    </>
  )
}
type Props = { pageId: number; accessLost?: boolean }

function gate() {
  let release!: () => void
  const held = new Promise<void>((r) => (release = r))
  return { held, release }
}

test('요약이 없는(MISSING) 노트는 한 번만 자동 생성하고, 생성 중엔 로딩을 보이다가 요약·시각으로 바꾼다', async () => {
  const post = gate()
  const { handlers, calls } = summaryHandlers(PAGE_ID, { initial: state('MISSING'), post: ready(), hold: post.held })
  renderScreen(<WikiSummaryCard pageId={PAGE_ID} />, { handlers })
  expect(await screen.findByTestId('wiki-ai-summary-loading')).toBeInTheDocument()
  post.release()
  const card = await screen.findByTestId('wiki-ai-summary')
  await waitFor(() => expect(card).toHaveTextContent('배포를 10/9 로 확정했다.'))
  expect(card).toHaveTextContent('10/8')
  expect(screen.queryByTestId('wiki-ai-summary-loading')).not.toBeInTheDocument()
  expect(calls.post).toBe(1)
})

test('목록형 요약(• 줄)은 기호를 뗀 항목의 목록으로, 옛 문단형 요약은 원문 그대로 그린다', async () => {
  const items = ['배포를 10/9 로 확정했다.', 'QA 는 수요일까지 마친다.', '롤백 기준은 오류율 2%.']
  const list = summaryHandlers(PAGE_ID, { initial: ready(items.map((t) => `• ${t}`).join('\n')) })
  const first = renderScreen(<WikiSummaryCard pageId={PAGE_ID} />, { handlers: list.handlers })
  const ul = await screen.findByTestId('wiki-ai-summary-text')
  expect([...ul.querySelectorAll('li')].map((li) => li.textContent)).toEqual(items)
  first.unmount()
  const para = summaryHandlers(OTHER_ID, { initial: ready('배포를 10/9 로 확정했다. QA 는 수요일까지 마친다.') })
  renderScreen(<WikiSummaryCard pageId={OTHER_ID} />, { handlers: para.handlers })
  const text = await screen.findByTestId('wiki-ai-summary-text')
  expect(text).toHaveTextContent('배포를 10/9 로 확정했다. QA 는 수요일까지 마친다.')
  expect(text.querySelectorAll('li')).toHaveLength(0)
})

test.each(['TOO_SHORT', 'UNAVAILABLE'] as const)('%s 면 카드를 그리지 않고 생성도 요청하지 않는다', async (status) => {
  const { handlers, calls } = summaryHandlers(PAGE_ID, { initial: state(status) })
  renderScreen(<WikiSummaryCard pageId={PAGE_ID} />, { handlers })
  await waitFor(() => expect(calls.get).toBe(1))
  await delay(50)
  expect(screen.queryByTestId('wiki-ai-summary')).not.toBeInTheDocument()
  expect(calls.post).toBe(0)
})

test('서버가 STALE 로 알려 주면 낡음 표시와 다시 요약을 보이고, 다시 요약하면 새 요약으로 바뀐다', async () => {
  const { handlers, calls } = summaryHandlers(PAGE_ID, {
    initial: { ...ready(), status: 'STALE', pageVersion: 2 },
    post: { ...ready('새 요약'), summaryVersion: 2, pageVersion: 2 },
  })
  const { user } = renderScreen(<WikiSummaryCard pageId={PAGE_ID} />, { handlers })
  expect(await screen.findByTestId('wiki-ai-summary-stale')).toBeInTheDocument()
  expect(screen.getByTestId('wiki-ai-summary')).toHaveTextContent('배포를 10/9 로 확정했다.')
  await user.click(screen.getByTestId('wiki-ai-summary-refresh'))
  await waitFor(() => expect(screen.getByTestId('wiki-ai-summary')).toHaveTextContent('새 요약'))
  expect(screen.queryByTestId('wiki-ai-summary-stale')).not.toBeInTheDocument()
  expect(calls.post).toBe(1)
})

test('생성에 실패하면 자동 재시도 없이 오류 표시와 다시 시도를 보이고, 누르면 다시 요청한다', async () => {
  const { handlers, calls } = summaryHandlers(PAGE_ID, { initial: state('MISSING'), post: 'fail' })
  const { user } = renderScreen(<WikiSummaryCard pageId={PAGE_ID} />, { handlers })
  expect(await screen.findByTestId('wiki-ai-summary-failed')).toHaveTextContent('요약하지 못했어요')
  await delay(300)
  expect(calls.post).toBe(1)
  await user.click(screen.getByTestId('wiki-ai-summary-retry'))
  await waitFor(() => expect(calls.post).toBe(2))
})

test('실패 뒤 노트가 삭제·접근 불가(accessLost)면 다시 시도를 거두고 실패 문구는 남긴다(WP-296)', async () => {
  const { handlers } = summaryHandlers(PAGE_ID, { initial: state('MISSING'), post: 'fail' })
  const { user } = renderScreen(<Switcher first={{ pageId: PAGE_ID }} next={{ pageId: PAGE_ID, accessLost: true }} />, { handlers })
  expect(await screen.findByTestId('wiki-ai-summary-retry')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '바꾸기' }))
  expect(screen.queryByTestId('wiki-ai-summary-retry')).not.toBeInTheDocument()
  expect(screen.getByTestId('wiki-ai-summary-failed')).toBeInTheDocument()
})

test('생성 중 다른 노트로 바뀌면 이전 노트의 로딩·요약이 새 노트에 새지 않는다', async () => {
  const postA = gate()
  const a = summaryHandlers(PAGE_ID, { initial: state('MISSING'), post: ready('A 요약'), hold: postA.held })
  const b = summaryHandlers(OTHER_ID, { initial: state('TOO_SHORT') })
  const { user } = renderScreen(<Switcher first={{ pageId: PAGE_ID }} next={{ pageId: OTHER_ID }} />, { handlers: [...a.handlers, ...b.handlers] })
  expect(await screen.findByTestId('wiki-ai-summary-loading')).toBeInTheDocument()
  // 노트 화면은 카드를 그대로 두고 pageId 만 바꾼다.
  await user.click(screen.getByRole('button', { name: '바꾸기' }))
  await waitFor(() => expect(b.calls.get).toBe(1))
  postA.release()
  await waitFor(() => expect(a.calls.post).toBe(1))
  await delay(100)
  expect(screen.queryByTestId('wiki-ai-summary')).not.toBeInTheDocument()
  expect(screen.queryByText('A 요약')).not.toBeInTheDocument()
})

test('AI 를 쓸 수 없는 사용자는 요약 조회 자체를 하지 않는다', async () => {
  const { handlers, calls } = summaryHandlers(PAGE_ID, { initial: ready() })
  renderScreen(<WikiSummaryCard pageId={PAGE_ID} />, {
    handlers,
    auth: { user: { ...testAuthValue.user!, aiAvailable: false } },
  })
  await delay(200)
  expect(calls.get).toBe(0)
  expect(screen.queryByTestId('wiki-ai-summary')).not.toBeInTheDocument()
})
