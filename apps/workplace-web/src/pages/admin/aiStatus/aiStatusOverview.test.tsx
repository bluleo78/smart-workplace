// 「AI 현황 › 개요」 화면(WP-1824) — 서버 개요 응답이 지표 6장·경고 목록(계정 경고는 한 줄)·처리량 막대·작은 그래프 5·종류별 표로
// 이어지는지, 기간·단위 단추가 화면에 반영되는지, 모바일 폭에서 처리량 재묶음·종류별 목록으로 갈라지는지를 MSW 네트워크 계층에서 본다.
import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterAll, beforeAll, expect, test, vi } from 'vitest'

import type { AiStatusAlert, AiStatusOverview, KindRow, Throughput } from '@/api/aiStatus'
import { formatCompactNumber, formatDateTime } from '@/lib/formatters'
import { stubChartResize } from '@/test/kits/chartResize'
import { renderScreen } from '@/test/renderScreen'
import { mockResizableViewport } from '@/test/viewport'

import AiStatusOverviewPage from './AiStatusOverviewPage'

/** 차트 축·막대는 jsdom 에서 리사이즈를 받아야 그려진다 — 차트 단언이 있는 이 파일 전체에 적용. */
beforeAll(() => stubChartResize())
afterAll(() => vi.unstubAllGlobals())

/** 데스크톱 폭(1024)에서 시작하는 뷰포트 — 모바일 재묶음 테스트가 390 으로 좁혔다가 되돌린다(파일당 한 뷰포트). */
const viewport = mockResizableViewport({ width: 1024, height: 768, pointer: 'fine' })

/** 구간 키 — 서버는 ISO Instant 로 보낸다(축·툴팁이 이를 시각으로 바꿔 그리는지 본다). */
const ISO_BUCKETS = ['2026-11-22T22:00:00Z', '2026-11-22T22:15:00Z']

/** 로컬 시각 HH:mm — 차트 축 눈금의 기대값(타임존에 상관없이 같은 식으로 계산). */
function localClock(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 머리 갱신 표기의 기준 시각 — 5초 전으로 두어 「갱신 n초 전」이 나온다. */
const GENERATED_AT = new Date(Date.now() - 5_000).toISOString()

/** 기본 경고 — 위험(DANGER)·주의(WARNING) 한 개씩, 경고가 필요한 테스트가 기본으로 받는다. */
const DEFAULT_ALERTS: AiStatusAlert[] = [
  { code: 'KIND_FAILURE', severity: 'DANGER', kind: 'MAIL', accountId: null, label: null, value: 0.5, threshold: 0.1 },
  { code: 'ACCOUNT_USAGE', severity: 'WARNING', kind: null, accountId: 3, label: '운영 · 5h', value: 85, threshold: 75 },
]

/** 개요 응답 픽스처 — 지표·경고 단언에 쓰는 값을 실제 응답 모양 그대로 둔다(나머지 블록 값은 최소). */
function overviewFixture(overrides: Partial<AiStatusOverview> = {}): AiStatusOverview {
  return {
    period: '24h',
    bucketSeconds: 900,
    from: '2026-11-21T22:00:00Z',
    to: '2026-11-22T22:00:00Z',
    generatedAt: GENERATED_AT,
    metrics: {
      runCount: { current: 12, previous: 8 },
      tokens: { current: { input: 1200, output: 300 }, previous: { input: 1000, output: 200 } },
      failureRate: { current: 0.1, previous: 0.08 },
      responseTime: { current: { p50: 800, p95: 1500 }, previous: { p50: 700, p95: 1200 } },
      waitTime: { current: { p95: 2500, queueWaiting: 3 }, previous: { p95: 2000, queueWaiting: 2 } },
      slotUsage: { current: { used: 3, limit: 8 }, previous: { used: 2, limit: 8 } },
    },
    throughput: {
      buckets: ISO_BUCKETS,
      kinds: ['MAIL'],
      values: { MAIL: [{ tokens: 100, count: 5 }, { tokens: 120, count: 6 }] },
      otherKindCount: 0,
    },
    series: {
      buckets: ISO_BUCKETS,
      responseP50: [800, 850],
      responseP95: [1500, 1600],
      failures: [1, 0],
      queueWaiting: [3, 2],
      slotUsed: [3, 3],
      slotLimit: [8, 8],
      backlog: {},
    },
    kinds: [
      { kind: 'MAIL', count: 11, failureRate: 0.1, p50: 800, p95: 1500, inputTokens: 1000, outputTokens: 300, lastFailure: null },
    ],
    alerts: DEFAULT_ALERTS,
    ...overrides,
  }
}

/** 종류 한 행 만들기 — 종류별 표 테스트용 8종을 실패율 다르게(마지막 하나는 실패율 없음) 만든다. */
function kindRow(kind: string, count: number, failureRate: number | null, extra: Partial<KindRow> = {}): KindRow {
  return { kind, count, failureRate, p50: 800, p95: 1500, inputTokens: 1000, outputTokens: 300, lastFailure: null, ...extra }
}

/** 종류별 표 픽스처 — 실패율 내림차순 상위 6 + 「나머지 2종」 이 나오게 MAIL 부터 순서를 엇갈려 둔다. */
const KINDS: KindRow[] = [
  kindRow('MAIL', 11, 0.5, { lastFailure: { at: '2026-11-22T10:00:00Z', reason: 'TIMEOUT' } }),
  kindRow('CHAT', 10, 0.4),
  kindRow('ISSUE', 9, 0.3),
  kindRow('DOC', 8, 0.2),
  kindRow('SEARCH', 7, 0.1),
  kindRow('DRIVE', 6, 0.09),
  kindRow('CALENDAR', 5, 0.05),
  kindRow('NOTE', 4, null),
]

/** 처리량 24구간 — 모바일에서 12 막대로 다시 묶이는지(24 → 12) 를 막대 수로 본다. 값은 전부 있다(0·null 구분 없이). */
function throughput24(): Throughput {
  const buckets = Array.from({ length: 24 }, (_, i) => `t${i}`)
  return {
    buckets,
    kinds: ['MAIL'],
    values: { MAIL: buckets.map((_, i) => ({ tokens: 100 + i, count: 5 })) },
    otherKindCount: 0,
  }
}

/** 개요 화면을 MSW 응답과 함께 띄운다 — 나간 요청 주소를 모아 기간 파라미터를 단언한다(helpMetrics.test.tsx 패턴). */
function renderOverview(
  opts: { fail?: boolean; failAfterFirst?: boolean; gateSecond?: Promise<void>; alerts?: AiStatusAlert[]; fixture?: Partial<AiStatusOverview> } = {},
) {
  const urls: URL[] = []
  const handlers = [
    http.get('/api/v1/admin/ai-status/overview', async ({ request }) => {
      urls.push(new URL(request.url))
      // gateSecond: 두 번째 요청(기간 전환)은 게이트가 열릴 때까지 응답을 미뤄 전환 중 화면을 관찰한다
      if (opts.gateSecond && urls.length > 1) await opts.gateSecond
      // failAfterFirst: 첫 조회만 성공, 그 뒤 재조회는 실패 — 보유 데이터가 있는 중 오류가 난 상황을 만든다
      if (opts.fail || (opts.failAfterFirst && urls.length > 1)) {
        return HttpResponse.json({ message: 'boom' }, { status: 500 })
      }
      return HttpResponse.json(overviewFixture({
          // 서버는 요청한 기간을 응답 period 로 되돌려 준다 — 화면은 이 값으로 지금 데이터의 기간을 안다
          period: new URL(request.url).searchParams.get('period') ?? '24h',
          alerts: opts.alerts ?? DEFAULT_ALERTS,
          ...opts.fixture,
        }))
    }),
  ]
  const view = renderScreen(<AiStatusOverviewPage />, { path: '/settings/ai-status', handlers })
  return { ...view, last: () => urls.at(-1), count: () => urls.length }
}

test('지표 6장이 서버 값을 제목·아랫줄과 함께 그려진다 — card-runs … card-slot-usage', async () => {
  renderOverview()
  const expected: [string, string][] = [
    ['card-runs', '처리 건수'],
    ['card-tokens', '토큰'],
    ['card-failure-rate', '실패율'],
    ['card-response-time', '응답 시간'],
    ['card-wait-time', '대기 시간'],
    ['card-slot-usage', '동시 처리'],
  ]
  for (const [testId, title] of expected) {
    const card = await screen.findByTestId(testId)
    expect(within(card).getByText(title)).toBeInTheDocument()
  }
  // 처리 건수 — 서버 값 12 와 아랫줄 「직전 8」
  const runs = screen.getByTestId('card-runs')
  expect(within(runs).getByText('12')).toBeInTheDocument()
  expect(within(runs).getByText('직전 8')).toBeInTheDocument()
  // 동시 처리 — 「3 / 8건」 과 아랫줄 「진행 중 / 한도 · 직전 2 / 8건」
  const slot = screen.getByTestId('card-slot-usage')
  expect(within(slot).getByText('3 / 8건')).toBeInTheDocument()
  expect(within(slot).getByText('진행 중 / 한도 · 직전 2 / 8건')).toBeInTheDocument()
  // 응답·대기 카드는 p95 임을 아랫줄에 밝히고, 대기 카드는 줄 선 건수도 보인다
  expect(within(screen.getByTestId('card-response-time')).getByText('p95 · 직전 1.2초')).toBeInTheDocument()
  expect(within(screen.getByTestId('card-wait-time')).getByText('p95 · 직전 2초 · 대기 3건')).toBeInTheDocument()
  // 토큰 — 머리글은 합(compact), 아랫줄은 직전 합·입력·출력 분해
  const tokens = screen.getByTestId('card-tokens')
  expect(within(tokens).getByText(formatCompactNumber(1500))).toBeInTheDocument()
  expect(
    within(tokens).getByText(
      `직전 ${formatCompactNumber(1200)} · 입력 ${formatCompactNumber(1200)} · 출력 ${formatCompactNumber(300)}`,
    ),
  ).toBeInTheDocument()
})

test('경고가 AlertList 로 그려지고(위험·주의 구분), 없으면 「이상 없음」 이다', async () => {
  const first = renderOverview({ alerts: DEFAULT_ALERTS })
  const list = await screen.findByRole('list')
  expect(within(list).getByText('위험')).toBeInTheDocument()
  expect(within(list).getByText('주의')).toBeInTheDocument()
  expect(within(list).getByText('MAIL 실패율 50% · 기준 10%')).toBeInTheDocument()
  // 계정 경고가 하나면 묶지 않고 계정·창·사용률·기준을 그대로 보인다
  expect(within(list).getByText(/운영 5시간 사용률 85% · 기준 75%/)).toBeInTheDocument()
  first.unmount()
  renderOverview({ alerts: [] })
  expect(await screen.findByText('이상 없음')).toBeInTheDocument()
})

test('사용률 패널이 없다 — 막대·「사용률」 제목·계정 5시간 목록이 없다', async () => {
  renderOverview()
  await screen.findByTestId('ai-status-alert-usage')
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: '사용률' })).not.toBeInTheDocument()
  expect(screen.queryByTestId('usage-slot')).not.toBeInTheDocument()
})

test('계정 경고 여러 개는 한 줄로 묶인다 — 계정 수·기준과 「계정 보기」 링크만 남는다', async () => {
  const acct = (accountId: number, label: string, value: number): AiStatusAlert => ({
    code: 'ACCOUNT_USAGE', severity: 'WARNING', kind: null, accountId, label, value, threshold: 80,
  })
  renderOverview({
    alerts: [
      { code: 'KIND_FAILURE', severity: 'DANGER', kind: 'MAIL', accountId: null, label: null, value: 0.5, threshold: 0.1 },
      acct(1, '운영 · 5h', 85),
      acct(1, '운영 · 7d', 82),
      acct(2, '개발 · 5h', 90),
    ],
  })
  const list = await screen.findByRole('list')
  expect(within(list).getAllByRole('listitem')).toHaveLength(2)
  const row = within(list).getByText('AI 계정 2개 한도 근접(80% 이상)').closest('li') as HTMLElement
  expect(within(row).getByRole('link', { name: '계정 보기' })).toHaveAttribute('href', '/settings/agents/accounts')
  expect(within(list).queryByText(/사용률 85% · 기준/)).not.toBeInTheDocument()
})

test('기간 단추를 7일로 바꾸면 period=7d 요청이 가고 주소에 ?period=7d 가 남는다', async () => {
  const { user, last, location } = renderOverview()
  await screen.findByTestId('card-runs')
  await user.click(screen.getByRole('button', { name: '7일' }))
  await waitFor(() => expect(last()?.searchParams.get('period')).toBe('7d'))
  await waitFor(() => expect(location()).toBe('/settings/ai-status?period=7d'))
})

test('기간 전환 중에는 이전 데이터의 차트가 이전 기간 제목·눈금을 유지하다가 새 응답이 오면 바뀐다', async () => {
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const { user } = renderOverview({ gateSecond: gate })
  const chart = await screen.findByRole('group', { name: '24시간 처리량' })
  await waitFor(() => expect(Array.from(chart.querySelectorAll('text')).map((n) => n.textContent)).toContain(localClock(ISO_BUCKETS[0])))
  await user.click(screen.getByRole('button', { name: '7일' }))
  // 두 번째 응답이 막힌 동안 — 이전(24시간) 데이터가 남아 있으니 제목·눈금도 24시간 그대로(30일/7일 표기로 어긋나지 않는다)
  await waitFor(() => expect(screen.getByRole('button', { name: '7일' })).toHaveAttribute('aria-pressed', 'true'))
  const during = screen.getByRole('group', { name: '24시간 처리량' })
  expect(screen.queryByRole('group', { name: '7일 처리량' })).not.toBeInTheDocument()
  expect(Array.from(during.querySelectorAll('text')).map((n) => n.textContent)).toContain(localClock(ISO_BUCKETS[0]))
  // 이전 기간 값이 보인다는 안내 — 7일 단추가 눌려 있는데 숫자는 24시간 것임을 알린다(WP-1824 리뷰 3)
  expect(screen.getByTestId('ai-status-previous-period')).toHaveTextContent('7일 값을 불러오는 중 — 지금은 24시간 값을 보여 줍니다')
  // 새 응답이 오면 새 기간 제목으로 바뀌고 안내는 사라진다
  release()
  expect(await screen.findByRole('group', { name: '7일 처리량' })).toBeInTheDocument()
  expect(screen.queryByRole('group', { name: '24시간 처리량' })).not.toBeInTheDocument()
  expect(screen.queryByTestId('ai-status-previous-period')).not.toBeInTheDocument()
})

test('기간 전환 요청이 실패하면 이전 기간 값을 남기지 않고 오류(다시 시도)로 바뀐다', async () => {
  // 첫 조회(24시간)만 성공하고 7일 조회는 실패 — 실패한 뒤에도 24시간 지표가 7일인 척 남아 있으면 안 된다(WP-1824 리뷰 3)
  const { user } = renderOverview({ failAfterFirst: true })
  await screen.findByTestId('card-runs')
  await user.click(screen.getByRole('button', { name: '7일' }))
  const error = await screen.findByTestId('ai-status-load-error')
  expect(within(error).getByRole('button', { name: /다시 시도/ })).toBeInTheDocument()
  expect(screen.queryByTestId('card-runs')).not.toBeInTheDocument()
  expect(screen.queryByTestId('ai-status-previous-period')).not.toBeInTheDocument()
  // 단추는 사용자가 고른 7일 그대로다
  expect(screen.getByRole('button', { name: '7일' })).toHaveAttribute('aria-pressed', 'true')
})

test('머리에 「갱신 n초 전」 이 보인다', async () => {
  renderOverview()
  expect(await screen.findByText(/갱신 \d+초 전/)).toBeInTheDocument()
})

test('오류 응답이면 LoadErrorState 가 보이고 지표는 그려지지 않는다', async () => {
  renderOverview({ fail: true })
  const error = await screen.findByTestId('ai-status-load-error')
  expect(within(error).getByText('AI 현황 개요를 불러오지 못함')).toBeInTheDocument()
  expect(within(error).getByRole('button', { name: /다시 시도/ })).toBeInTheDocument()
  expect(screen.queryByTestId('card-runs')).not.toBeInTheDocument()
  expect(screen.queryByTestId('card-slot-usage')).not.toBeInTheDocument()
})

test('보유 데이터가 있는 재조회가 실패해도 지표는 그대로이고 오류 안내로 바뀌지 않는다', async () => {
  const { queryClient, count } = renderOverview({ failAfterFirst: true })
  await screen.findByTestId('card-runs')
  // 30초 자동 갱신과 같은 재조회를 직접 부른다 — 두 번째 요청은 실패 응답
  await act(async () => {
    await queryClient.refetchQueries({ queryKey: ['aiStatus', 'overview', '24h'] })
  })
  await waitFor(() => expect(count()).toBe(2))
  // 쿼리는 오류 상태지만 data 는 남아 있다 — 그때도 본문은 이전 지표를 그대로 둔다(오류 안내는 data 없을 때만)
  await waitFor(() => expect(queryClient.getQueryState(['aiStatus', 'overview', '24h'])?.status).toBe('error'))
  expect(screen.getByTestId('card-runs')).toBeInTheDocument()
  expect(screen.getByTestId('card-slot-usage')).toBeInTheDocument()
  expect(screen.queryByTestId('ai-status-load-error')).not.toBeInTheDocument()
})

test('처리량 막대가 토큰 기본으로 그려지고, 「건수」 로 바꾸면 값이 바뀐다', async () => {
  const { user } = renderOverview()
  const chart = await screen.findByRole('group', { name: '24시간 처리량' })
  const ticks = () => Array.from(chart.querySelectorAll('text')).map((n) => n.textContent)
  // x 축 눈금은 ISO 원문이 아니라 로컬 시각 HH:mm
  await waitFor(() => expect(ticks()).toContain(localClock(ISO_BUCKETS[0])))
  expect(ticks().some((x) => x?.includes('T22:00'))).toBe(false)
  // 기본 단위는 토큰 — Y 축 눈금에 토큰 최댓값(120) 이 나온다
  await waitFor(() => expect(ticks()).toContain('120'))
  await user.click(screen.getByRole('button', { name: '건수' }))
  // 값을 바꾼다 — 같은 눈금 자리가 건수(6) 로 다시 그려지고 토큰 눈금은 없어진다
  await waitFor(() => expect(ticks()).toContain('6'))
  expect(ticks()).not.toContain('120')
})

test('처리량 단추는 토큰·건수 두 개다', async () => {
  renderOverview()
  const block = await screen.findByTestId('ai-status-throughput')
  const group = within(block).getByRole('group', { name: '단위' })
  const buttons = within(group).getAllByRole('button')
  expect(buttons.map((b) => b.textContent)).toEqual(['토큰', '건수'])
  // 기본값은 토큰
  expect(buttons[0]).toHaveAttribute('aria-pressed', 'true')
  expect(buttons[1]).toHaveAttribute('aria-pressed', 'false')
})

test('작은 그래프 5개가 모두 그려진다 — graph-response … graph-slot', async () => {
  renderOverview({
    fixture: {
      series: {
        buckets: ISO_BUCKETS,
        responseP50: [800, 850],
        responseP95: [1500, 1600],
        failures: [1, 0],
        queueWaiting: [3, 2],
        slotUsed: [3, 3],
        slotLimit: [8, 8],
        backlog: { MAIL: [1, 2] },
      },
    },
  })
  const expected: [string, string][] = [
    ['graph-response', '기간별 응답 시간(p95·p50)'],
    ['graph-failures', '기간별 실패 건수'],
    ['graph-queue-wait', '기간별 대기 건수'],
    ['graph-backlog', '기간별 밀린 건수(종류별)'],
    ['graph-slot', '기간별 동시 처리(한도 포함)'],
  ]
  for (const [testId, ariaLabel] of expected) {
    const card = await screen.findByTestId(testId)
    expect(await within(card).findByRole('img', { name: ariaLabel })).toBeInTheDocument()
  }
  // 데스크톱 그리드 — 2열(sm) · 3열(xl)
  const grid = screen.getByTestId('ai-status-small-graphs')
  expect(grid.className).toContain('sm:grid-cols-2')
  expect(grid.className).toContain('xl:grid-cols-3')
  // 기준선 라벨 — 동시 처리는 「한도」, 계정 5시간 그래프는 없다
  expect(within(screen.getByTestId('graph-slot')).getByText('한도')).toBeInTheDocument()
  expect(screen.queryByTestId('graph-account-5h')).not.toBeInTheDocument()
})

test('종류별 표는 실패율 내림차순 상위 6행만 보이고 「나머지 n종 보기」 를 누르면 남은 행이 펼쳐진다', async () => {
  const { user } = renderOverview({ fixture: { kinds: KINDS } })
  const section = await screen.findByTestId('ai-status-kinds')
  const table = within(section).getByRole('table', { name: '종류별' })
  // 여덟 열 — 종류·건수·실패율·p50·p95·입력 토큰·출력 토큰·최근 실패
  expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
    '종류',
    '건수',
    '실패율',
    'p50',
    'p95',
    '입력 토큰',
    '출력 토큰',
    '최근 실패',
  ])
  // 실패율 내림차순 상위 6행 만 보인다
  for (const kind of ['MAIL', 'CHAT', 'ISSUE', 'DOC', 'SEARCH', 'DRIVE']) {
    expect(within(table).getByTestId(`kind-row-${kind}`)).toBeInTheDocument()
  }
  expect(screen.queryByTestId('kind-row-CALENDAR')).not.toBeInTheDocument()
  expect(screen.queryByTestId('kind-row-NOTE')).not.toBeInTheDocument()
  // 셀은 서버 값을 포매터로 — MAIL 실패율 50% · 최근 실패 시각과 사유
  const mail = within(table).getByTestId('kind-row-MAIL')
  expect(within(mail).getByText('50%')).toBeInTheDocument()
  expect(within(mail).getByText(`${formatDateTime('2026-11-22T10:00:00Z')} · TIMEOUT`)).toBeInTheDocument()
  // 「나머지 2종 보기」 를 누르면 남은 두 행이 이어 그려진다
  await user.click(screen.getByRole('button', { name: '나머지 2종 보기' }))
  expect(await screen.findByTestId('kind-row-CALENDAR')).toBeInTheDocument()
  expect(screen.getByTestId('kind-row-NOTE')).toBeInTheDocument()
})

test('모바일 폭에서는 처리량이 12개 이하 막대로 다시 묶이고 종류별은 목록이 된다', async () => {
  renderOverview({ fixture: { throughput: throughput24(), kinds: KINDS } })
  const chart = await screen.findByRole('group', { name: '24시간 처리량' })
  // 데스크톱 — 구간 24개를 그대로 24 막대
  await waitFor(() => expect(chart.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(24))
  expect(screen.getByRole('table', { name: '종류별' })).toBeInTheDocument()
  expect(screen.getByTestId('ai-status-small-graphs').className).toContain('xl:grid-cols-3')
  try {
    act(() => viewport.setWidth(390))
    // 모바일 폭 — 12개 이하로 다시 묶인다(24 → 12)
    await waitFor(() =>
      expect(screen.getByRole('group', { name: '24시간 처리량' }).querySelectorAll('.recharts-bar-rectangle')).toHaveLength(12),
    )
    // 작은 그래프는 한 열로 갈라진다
    const grid = screen.getByTestId('ai-status-small-graphs')
    expect(grid.className).toContain('grid-cols-1')
    expect(grid.className).not.toContain('xl:grid-cols-3')
    // 종류별은 표 대신 목록 — 상위 6종 만
    expect(screen.queryByRole('table', { name: '종류별' })).not.toBeInTheDocument()
    const list = screen.getByRole('list', { name: '종류별' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(6)
    expect(within(list).getByTestId('kind-row-MAIL')).toBeInTheDocument()
    expect(within(list).queryByTestId('kind-row-CALENDAR')).not.toBeInTheDocument()
  } finally {
    act(() => viewport.setWidth(1024))
  }
})

test('기간에 값이 하나도 없으면 처리량·작은 그래프가 「데이터 없음」 으로 그려진다', async () => {
  renderOverview({
    fixture: {
      // 구간은 잡혀 있지만 값이 전부 null — 서버가 처리 기록이 없을 때 주는 모양(설계 §5-6 4 빈 상태)
      throughput: {
        buckets: ISO_BUCKETS,
        kinds: ['MAIL'],
        values: { MAIL: [null, null] },
        otherKindCount: 0,
      },
      series: {
        buckets: ISO_BUCKETS,
        responseP50: [null, null],
        responseP95: [null, null],
        failures: [null, null],
        queueWaiting: [null, null],
        slotUsed: [null, null],
        slotLimit: [null, null],
        backlog: {},
      },
    },
  })
  // 처리량 — 머리(제목·단위 단추)는 그대로, 본문 자리만 「데이터 없음」 (막대는 안 그려진다)
  const throughput = await screen.findByTestId('ai-status-throughput')
  expect(within(throughput).getByText('데이터 없음')).toBeInTheDocument()
  expect(within(throughput).queryByRole('img')).not.toBeInTheDocument()
  // 작은 그래프 5장 모두 같은 빈 상태
  const graphIds = ['graph-response', 'graph-failures', 'graph-queue-wait', 'graph-backlog', 'graph-slot']
  for (const testId of graphIds) {
    const card = screen.getByTestId(testId)
    expect(within(card).getByText('데이터 없음')).toBeInTheDocument()
    expect(within(card).queryByRole('img')).not.toBeInTheDocument()
  }
  // 빈 차트는 오류가 아니다 — 지표는 그대로이고 LoadErrorState 로 바뀌지 않는다
  expect(screen.getByTestId('card-runs')).toBeInTheDocument()
  expect(screen.queryByTestId('ai-status-load-error')).not.toBeInTheDocument()
})

test('종류별 표의 종류 링크를 누르면 그 종류와 지금 기간의 처리 이력 주소로 간다', async () => {
  const { user, location } = renderOverview({ fixture: { kinds: KINDS } })
  const section = await screen.findByTestId('ai-status-kinds')
  const table = within(section).getByRole('table', { name: '종류별' })
  // 종류 이름은 링크 — 키보드·보조기기가 닿는 이동 수단(기본 기간 24h 는 주소에 넣지 않는다)
  expect(within(table).getByRole('link', { name: 'MAIL' })).toHaveAttribute('href', '/settings/ai-status/history?kind=MAIL')
  // 링크를 누르면 그 주소로 간다(행 전체를 덮는 것은 ::after 레이아웃이라 jsdom 밖)
  await user.click(within(table).getByRole('link', { name: 'CHAT' }))
  expect(location()).toBe('/settings/ai-status/history?kind=CHAT')
})

test('7일로 본 뒤 종류 링크는 period=7d 를 함께 넘긴다', async () => {
  const { user } = renderOverview({ fixture: { kinds: KINDS } })
  await screen.findByTestId('ai-status-kinds')
  await user.click(screen.getByRole('button', { name: '7일' }))
  await waitFor(() =>
    expect(within(screen.getByRole('table', { name: '종류별' })).getByRole('link', { name: 'MAIL' })).toHaveAttribute(
      'href',
      '/settings/ai-status/history?period=7d&kind=MAIL',
    ),
  )
})

test('경고의 「이력 보기」 는 그 종류의 실패 이력으로, 「계정 보기」 는 AI 계정 관리로 간다', async () => {
  const { user, location } = renderOverview({ alerts: DEFAULT_ALERTS })
  const list = await screen.findByRole('list')
  expect(within(list).getByRole('link', { name: '계정 보기' })).toHaveAttribute('href', '/settings/agents/accounts')
  await user.click(within(list).getByRole('link', { name: '이력 보기' }))
  expect(location()).toBe('/settings/ai-status/history?kind=MAIL&status=FAILED')
})

test('처리량 막대를 누르면 그 구간(from 포함 ~ to 미포함)의 처리 이력 주소로 간다', async () => {
  // 개요 창의 끝을 두 구간 뒤로 둔다(창 끝에서 자르는 것은 bucketHistoryHref 단위 테스트가 본다)
  const { user, location } = renderOverview({ fixture: { to: '2026-11-22T22:30:00Z' } })
  const chart = await screen.findByRole('group', { name: '24시간 처리량' })
  // 키보드로 첫 막대(22:00 구간)를 고른다 — 마우스 클릭과 같은 onBarClick 경로다
  const bars = await within(chart).findAllByRole('button')
  bars[0].focus()
  await user.keyboard('{Enter}')
  expect(location()).toBe(
    `/settings/ai-status/history?${new URLSearchParams({ from: '2026-11-22T22:00:00.000Z', to: '2026-11-22T22:15:00.000Z' })}`,
  )
})

test('모바일에서 묶인 막대를 누르면 묶인 구간 전체가 이력 주소의 from~to 가 된다', async () => {
  // 15분 구간 24개 → 모바일 12 막대(2개씩) — 첫 막대는 30분을 덮는다
  const buckets = Array.from({ length: 24 }, (_, i) => new Date(Date.parse('2026-11-22T00:00:00Z') + i * 900_000).toISOString())
  const throughput: Throughput = {
    buckets,
    kinds: ['MAIL'],
    values: { MAIL: buckets.map(() => ({ tokens: 100, count: 5 })) },
    otherKindCount: 0,
  }
  try {
    act(() => viewport.setWidth(390))
    const { user, location } = renderOverview({ fixture: { throughput } })
    const chart = await screen.findByRole('group', { name: '24시간 처리량' })
    await waitFor(() => expect(chart.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(12))
    const bars = within(chart).getAllByRole('button')
    bars[0].focus()
    await user.keyboard('{Enter}')
    expect(location()).toBe(
      `/settings/ai-status/history?${new URLSearchParams({ from: '2026-11-22T00:00:00.000Z', to: '2026-11-22T00:30:00.000Z' })}`,
    )
  } finally {
    act(() => viewport.setWidth(1024))
  }
})
