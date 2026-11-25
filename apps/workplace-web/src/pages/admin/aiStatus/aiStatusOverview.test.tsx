// 「AI 현황 › 개요」 화면(WP-1824) — 서버 개요 응답이 지표 6장·경고 목록(계정 경고는 한 줄)·처리량 막대·작은 그래프 5·종류별 표로
// 이어지는지, 기간·단위 단추가 화면에 반영되는지, 모바일 폭에서 처리량 재묶음·종류별 목록으로 갈라지는지를 MSW 네트워크 계층에서 본다.
// 데이터가 도착한 뒤 블록이 지표 → 경고 → 처리량 → 작은 그래프 → 종류별 순서로 한 단계씩 늘어나는지(WP-2079) 같은 계층에서 본다(맨 아래).
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'

import type { AiStatusAlert, AiStatusOverview, KindRow, Throughput } from '@/api/aiStatus'
import { formatCompactNumber, formatDateTime } from '@/lib/formatters'
import { stubChartResize } from '@/test/kits/chartResize'
import { renderScreen } from '@/test/renderScreen'
import { mockResizableViewport } from '@/test/viewport'

import { CHART_STAGE_MAX_WAIT_MS, isChartStageOpen } from './aiStatusModel'
import AiStatusOverviewPage from './AiStatusOverviewPage'

/** 차트 축·막대는 jsdom 에서 리사이즈를 받아야 그려진다 — 차트 단언이 있는 이 파일 전체에 적용. */
beforeAll(() => stubChartResize())
afterAll(() => vi.unstubAllGlobals())

/**
 * 같은 태스크(동기 실행) 안에서 지표 계산(statCards)이 몇 번 이어 불렸는지 기록한다 —
 * 렌더 중 setState 는 컴포넌트 함수를 같은 태스크에 두 번 돌려 본문 계산을 두 번 만든다(WP-2079 2라운드).
 * 동기 실행이 마이크로태스크 경계에서 끝날 때마다 그 태스크의 호출 횟수를 하나씩 쌓는다.
 */
const metricProbe = vi.hoisted(() => {
  const state = {
    /** 방금 시작한 태스크에서 statCards 가 불린 횟수 */
    callsInTask: 0,
    /** 태스크마다 하나씩 쌓은 호출 횟수(마지막 원소가 방금 확정된 태스크) */
    taskBatches: [] as number[],
    /** 지금 태스크의 확정(마이크로태스크)을 예약했는지 */
    flushScheduled: false,
  }
  return {
    state,
    /** statCards 호출을 기록하고, 동기 실행이 끝나면 그 태스크의 횟수를 확정한다 */
    record(): void {
      state.callsInTask += 1
      if (state.flushScheduled) return
      state.flushScheduled = true
      queueMicrotask(() => {
        state.taskBatches.push(state.callsInTask)
        state.callsInTask = 0
        state.flushScheduled = false
      })
    },
  }
})

// 지표 계산만 실제 구현 그대로 두고 호출을 기록한다 — 화면 동작은 바꾸지 않고 렌더 횟수만 잡는다(WP-2079 2라운드).
vi.mock('./aiStatusModel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./aiStatusModel')>()
  return {
    ...actual,
    statCards: vi.fn((metrics: Parameters<typeof actual.statCards>[0]) => {
      metricProbe.record()
      return actual.statCards(metrics)
    }),
  }
})

/**
 * 준비 자리 제어(WP-2079 3라운드) — 준비 완료(onWarmed) 신호 시점을 테스트가 정할 수 있게 하는 가짜 자리.
 * 기본은 실제 컴포넌트 그대로라 나머지 테스트는 화면을 바꾸지 않고, 신호가 필요한 테스트만 이 플래그를 켠다.
 */
const warmupControl = vi.hoisted(() => ({
  fake: false,
  /** 가짜 자리가 페이지에 전한 준비 완료 신호 — 테스트가 직접 불러 신호 시점을 만든다 */
  signal: null as null | (() => void),
}))

vi.mock('./AiStatusChartWarmup', async () => {
  const actualWarmup = await vi.importActual<typeof import('./AiStatusChartWarmup')>('./AiStatusChartWarmup')
  // 가짜 자리 — 차트를 그리는 대신 신호만 받아 둔다(그려지는 시점 대신 신호 시점을 시험하기 위함)
  function fakeWarmup({ onWarmed }: { onWarmed?: () => void }) {
    warmupControl.signal = onWarmed ?? null
    return <div data-testid="ai-status-chart-warmup" aria-hidden="true" />
  }
  return {
    AiStatusChartWarmup: (props: { onWarmed?: () => void }) =>
      warmupControl.fake ? fakeWarmup(props) : actualWarmup.AiStatusChartWarmup(props),
  }
})

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
      limited: 0,
      limitedCredentials: [],
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
      { kind: 'MAIL', count: 11, failureRate: 0.1, p50: 800, p95: 1500, inputTokens: 1000, outputTokens: 300, lastFailure: null, limited: 0 },
    ],
    alerts: DEFAULT_ALERTS,
    ...overrides,
  }
}

/** 종류 한 행 만들기 — 종류별 표 테스트용 8종을 실패율 다르게(마지막 하나는 실패율 없음) 만든다. */
function kindRow(kind: string, count: number, failureRate: number | null, extra: Partial<KindRow> = {}): KindRow {
  return { kind, count, failureRate, p50: 800, p95: 1500, inputTokens: 1000, outputTokens: 300, lastFailure: null, limited: 0, ...extra }
}

/** 종류별 표 픽스처 — 실패율 내림차순 상위 6 + 「나머지 2종」 이 나오게 MAIL 부터 순서를 엇갈려 둔다. */
const KINDS: KindRow[] = [
  kindRow('MAIL_ANALYZE_PERSONAL', 11, 0.5, { lastFailure: { at: '2026-11-22T10:00:00Z', reason: 'timeout' }, limited: 3 }),
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
  opts: {
    fail?: boolean
    failAfterFirst?: boolean
    /** 첫 조회는 성공, 두 번째(기간 전환)만 실패 — 그 뒤 다시 시도는 성공해 재시도 흐름을 만든다 */
    failSecond?: boolean
    /** 첫 조회는 게이트가 열릴 때까지 응답을 미뤄 「응답 대기 중」 화면을 오래 관찰한다 */
    gateFirst?: Promise<void>
    gateSecond?: Promise<void>
    alerts?: AiStatusAlert[]
    fixture?: Partial<AiStatusOverview>
    path?: string
  } = {},
) {
  const urls: URL[] = []
  const handlers = [
    http.get('/api/v1/admin/ai-status/overview', async ({ request }) => {
      urls.push(new URL(request.url))
      // gateFirst: 첫 요청은 게이트가 열릴 때까지 응답을 미룬다 — 준비 자리(차트 준비)가 데이터보다 먼저 일어나는지를 본다
      if (opts.gateFirst && urls.length === 1) await opts.gateFirst
      // gateSecond: 두 번째 요청(기간 전환)은 게이트가 열릴 때까지 응답을 미뤄 전환 중 화면을 관찰한다
      if (opts.gateSecond && urls.length > 1) await opts.gateSecond
      // failAfterFirst: 첫 조회만 성공, 그 뒤 재조회는 실패 — 보유 데이터가 있는 중 오류가 난 상황을 만든다
      if (opts.fail || (opts.failAfterFirst && urls.length > 1)) {
        return HttpResponse.json({ message: 'boom' }, { status: 500 })
      }
      // failSecond: 두 번째 요청만 실패 — data 가 없어졌다가 다시 시도로 돌아오는 경로(단계 리셋)를 만든다
      if (opts.failSecond && urls.length === 2) {
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
  const view = renderScreen(<AiStatusOverviewPage />, { path: opts.path ?? '/settings/ai-status', handlers })
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

test('실패율 카드에 한도 초과 건수와 계정 이름이 붙는다 — metricCards_showLimitedWithCredentials', async () => {
  const base = overviewFixture()
  renderOverview({ fixture: { metrics: { ...base.metrics, limited: 4, limitedCredentials: ['Claude 팀 계정', '운영 계정'] } } })
  const card = await screen.findByTestId('card-failure-rate')
  expect(within(card).getByText('한도 초과 4건 · Claude 팀 계정 · 운영 계정')).toBeInTheDocument()
})

test('한도 초과가 0건이면 카드에 보이지 않는다 — metricCards_hideLimitedWhenZero', async () => {
  renderOverview()
  const card = await screen.findByTestId('card-failure-rate')
  expect(within(card).queryByText(/한도 초과/)).not.toBeInTheDocument()
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
  for (const kind of ['MAIL_ANALYZE_PERSONAL', 'CHAT', 'ISSUE', 'DOC', 'SEARCH', 'DRIVE']) {
    expect(within(table).getByTestId(`kind-row-${kind}`)).toBeInTheDocument()
  }
  expect(screen.queryByTestId('kind-row-CALENDAR')).not.toBeInTheDocument()
  expect(screen.queryByTestId('kind-row-NOTE')).not.toBeInTheDocument()
  // 셀은 서버 값을 포매터로 — MAIL 실패율 50% · 최근 실패 시각과 사유
  const mail = within(table).getByTestId('kind-row-MAIL_ANALYZE_PERSONAL')
  expect(within(mail).getByText('50%')).toBeInTheDocument()
  expect(within(mail).getByText(`${formatDateTime('2026-11-22T10:00:00Z')} · 시간 초과`)).toBeInTheDocument()
  // 종류는 한글 이름 — 한도 초과 건수는 0 보다 클 때만 실패율 아래에 작게
  expect(within(mail).getByText('메일 개인 분석')).toBeInTheDocument()
  expect(within(mail).getByText('한도 초과 3건')).toBeInTheDocument()
  expect(within(table).getAllByText(/한도 초과/)).toHaveLength(1)
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
  // 블록이 단계적으로 늘어나므로(WP-2079) 작은 그래프·종류별은 기다려서 본다 — 마지막 단계(종류별)가 나오면 앞 블록도 다 나온 뒤다
  await screen.findByTestId('ai-status-kinds')
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
    expect(within(list).getByTestId('kind-row-MAIL_ANALYZE_PERSONAL')).toBeInTheDocument()
    expect(within(list).getByText('메일 개인 분석')).toBeInTheDocument()
    expect(within(list).getByText('한도 초과 3건')).toBeInTheDocument()
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
  // 작은 그래프 5장 모두 같은 빈 상태 — 카드는 단계를 거쳐 한 장씩 나오므로(WP-2079) 기다려서 본다
  const graphIds = ['graph-response', 'graph-failures', 'graph-queue-wait', 'graph-backlog', 'graph-slot']
  for (const testId of graphIds) {
    const card = await screen.findByTestId(testId)
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
  expect(within(table).getByRole('link', { name: '메일 개인 분석' })).toHaveAttribute('href', '/settings/ai-status/history?kind=MAIL_ANALYZE_PERSONAL')
  // 링크를 누르면 그 주소로 간다(행 전체를 덮는 것은 ::after 레이아웃이라 jsdom 밖)
  await user.click(within(table).getByRole('link', { name: 'CHAT' }))
  expect(location()).toBe('/settings/ai-status/history?kind=CHAT')
})

test('7일로 본 뒤 종류 링크는 period=7d 를 함께 넘긴다', async () => {
  const { user } = renderOverview({ fixture: { kinds: KINDS } })
  await screen.findByTestId('ai-status-kinds')
  await user.click(screen.getByRole('button', { name: '7일' }))
  await waitFor(() =>
    expect(within(screen.getByRole('table', { name: '종류별' })).getByRole('link', { name: '메일 개인 분석' })).toHaveAttribute(
      'href',
      '/settings/ai-status/history?period=7d&kind=MAIL_ANALYZE_PERSONAL',
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
  // 블록 단계가 끝날 때까지 기다렸다가 막대를 집는다 — 블록이 늘며 차트가 다시 그려지는 중에는 초점이 흐르지 않게(WP-2079)
  await screen.findByTestId('ai-status-kinds')
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
    // 블록 단계가 끝날 때까지 기다렸다가 막대를 집는다 — 블록이 늘며 차트가 다시 그려지는 중에는 초점이 흐르지 않게(WP-2079)
    await screen.findByTestId('ai-status-kinds')
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

test('개요 화면에도 탭이 있고 「처리 이력」 은 기간을 가지고 처리 이력 주소로 간다 (WP-1825)', async () => {
  const { user, location } = renderOverview({ path: '/settings/ai-status?period=7d' })
  await screen.findByTestId('ai-status-alert-usage')
  await user.click(screen.getByTestId('ai-status-tab-history'))
  expect(location()).toBe('/settings/ai-status/history?period=7d')
})

/**
 * 체인 타이머(0ms setTimeout)를 굴려 조건이 될 때까지 진행한다 — 한 회차에 지금 걸린 타이머를 굴리고,
 * 약속 체인(응답 → 쿼리 상태 → 렌더)이 act 안에서 흐르게 한 틱 비운다. 네트워크(MSW)·쿼리·setInterval 은
 * 진짜 타이머로 흘려보내 환경을 적게 바꾼다. 준비 신호가 없어 아무리 굴려도 진행하지 않는 것을 확인하는 데도 쓴다.
 * `runAllTimers` 라 준비 대기 상한(CHART_STAGE_MAX_WAIT_MS) 타이머까지 함께 굴린다 — 그래서 이 헬퍼를 쓰는 테스트는
 * 게이트가 「무엇으로」 열렸는지(워밍 신호든 상한이든)를 단언하지 않고, 상한 전/후를 나눠 보는 테스트는
 * 아래 `rollChain` 을 쓴다(아래 WP-2079 두 절이 함께 쓴다 — 굴리는 방식이 갈리면 단계 판정이 흔들린다).
 */
async function rollUntil(done: () => boolean, limit = 50): Promise<void> {
  for (let i = 0; i < limit && !done(); i++) {
    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })
  }
}

// ——— 블록 단계 노출(WP-2079) ———
// 데이터 도착 직후 지표·경고·처리량·작은 그래프·종류별을 한 번에 그리면 메인 스레드가 막히므로, 페이지는
// 블록을 한 단계씩 늘려 그린다. 체인 타이머(0ms setTimeout)만 가려 두고 테스트가 직접 굴려 단계를 재는데,
// 네트워크(MSW)·쿼리·setInterval 은 진짜 타이머로 흘려보내 환경을 적게 바꾼다.
// 데이터 도착에도 응답 전달에 쓰인 타이머가 필요하므로 findBy 대신 타이머를 굴려 기다린다 — 굴리는 동안
// 단계 타이머는 아직 걸리지 않기 때문에(데이터가 와야 비로소 effect 가 단계 타이머를 건다) 도착 시점이 정해지게 한다.
describe('블록 단계 노출 (WP-2079)', () => {
  // 가짜 타이머를 쓰는 테스트가 타임아웃으로 중단돼도, 들고 있은 채 다음 테스트로 새지 않게 다시 한 번 끈다
  afterEach(() => {
    vi.useRealTimers()
  })

  /**
   * 단계 마커 다섯 개 — 지표 카드(0) → 경고 usage(1) → 처리량(2) → 작은 그래프(3) → 종류별 표(4) 순서로 나타난다.
   * 지표 카드는 data 가 오는 렌더에서 바로 그려지고, 나머지는 각자 자기 태스크(체인 틱)에서 늘어난다.
   */
  const STAGE_MARKERS = [
    'card-runs',
    'ai-status-alert-usage',
    'ai-status-throughput',
    'ai-status-small-graphs',
    'ai-status-kinds',
  ] as const

  /** 지금 그려진 단계 수 — 마커가 화면에 있는 개수(0..5). */
  function drawnStages(): number {
    return STAGE_MARKERS.filter((id) => screen.queryByTestId(id)).length
  }

  /** 타이머를 굴려 지표 카드가 나올 때까지 기다린다 — 응답 전달에 쓰인 타이머도 함께 흘려보낸다. */
  async function runUntilData(): Promise<void> {
    await rollUntil(() => !!screen.queryByTestId('card-runs'))
    expect(screen.getByTestId('card-runs')).toBeInTheDocument()
  }

  /** 타이머를 굴려 오류 안내(다시 시도)가 나올 때까지 기다린다 — 실패 응답도 같은 타이머로 전달된다. */
  async function runUntilError(): Promise<void> {
    await rollUntil(() => !!screen.queryByTestId('ai-status-load-error'))
    expect(screen.getByTestId('ai-status-load-error')).toBeInTheDocument()
  }

  /**
   * 블록을 정확히 한 단계 늘릴 때까지 타이머를 굴린다 — runAllTimers 가 지금 걸린 체인 타이머를 굴리고,
   * act 가 effects 를 플러시할 때 다음 타이머가 다시 걸리므로 한 회차에 한 블록씩만 늘어난다.
   * 준비(차트 impl 청크 선로딩)가 아직 안 끝나 걸 타이머가 없으면 다음 회차에서 굴린다.
   */
  async function stepBlock(): Promise<void> {
    const before = drawnStages()
    await rollUntil(() => drawnStages() !== before)
    expect(drawnStages()).toBe(before + 1)
  }

  test('데이터가 도착하면 지표 → 경고 → 처리량 → 작은 그래프 → 종류별 순서로 한 단계씩 늘어난다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    renderOverview()
    // 데이터가 도착해도 아직 타이머를 굴리기 전 — 지표 카드만 있고 경고·차트·종류별은 아직 없다
    await runUntilData()
    expect(screen.queryByTestId('ai-status-alert-usage')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-status-throughput')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-status-small-graphs')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-status-kinds')).not.toBeInTheDocument()
    // 한 단계 — 경고 usage 만, 차트·종류별은 아직 없다
    await stepBlock()
    expect(screen.getByTestId('ai-status-alert-usage')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-status-throughput')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-status-small-graphs')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-status-kinds')).not.toBeInTheDocument()
    // 다음 단계 — 처리량, 작은 그래프·종류별은 아직 없다
    await stepBlock()
    expect(screen.getByTestId('ai-status-throughput')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-status-small-graphs')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-status-kinds')).not.toBeInTheDocument()
    // 다음 단계 — 작은 그래프, 종류별은 아직 없다
    await stepBlock()
    expect(screen.getByTestId('ai-status-small-graphs')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-status-kinds')).not.toBeInTheDocument()
    // 마지막 단계 — 종류별 표까지 그려진다
    await stepBlock()
    expect(screen.getByTestId('ai-status-kinds')).toBeInTheDocument()
  })

  test('타이머를 끝까지 진행하면 지표·경고·처리량·작은 그래프·종류별이 모두 그려진다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    renderOverview()
    // 데이터 도착 — 지표 카드만 바로 보이고 나머지 블록은 아직 없다
    await runUntilData()
    expect(drawnStages()).toBe(1)
    // 남은 네 단계를 끝까지 진행하면 다섯 블록이 모두 나온다
    for (let i = 0; i < 4; i++) await stepBlock()
    expect(drawnStages()).toBe(5)
    // 도움말 래퍼는 처리량·작은 그래프를 감싼 채 남아 있고, 종류별 표는 래퍼 밖 원래 자리에 있다
    const wrapper = document.querySelector('div[data-help="ai-status.charts"]')
    expect(wrapper).toBeInTheDocument()
    expect(wrapper).toContainElement(screen.getByTestId('ai-status-throughput'))
    expect(wrapper).toContainElement(screen.getByTestId('ai-status-small-graphs'))
    expect(wrapper).not.toContainElement(screen.getByTestId('ai-status-kinds'))
  })

  test('오류로 data 가 없어졌다가 다시 시도로 다시 오면 단계가 처음부터 다시 진행한다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    renderOverview({ failSecond: true })
    await runUntilData()
    // 단계를 두 칸 진행해 둔다 — data 가 없어져도 단계가 남아 있으면 복귀 뒤 블록이 한 번에 다 나온다
    await stepBlock()
    await stepBlock()
    expect(screen.getByTestId('ai-status-throughput')).toBeInTheDocument()
    // 기간 전환(7일) — 두 번째 요청이 실패해 data 가 없어지고 오류(다시 시도)로 바뀐다
    fireEvent.click(screen.getByRole('button', { name: '7일' }))
    await runUntilError()
    // data 가 없어진 동안 단계는 0 으로 되돌아간다 — 오류 화면에는 블록이 없다
    expect(screen.queryByTestId('card-runs')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-status-throughput')).not.toBeInTheDocument()
    // 다시 시도 — 세 번째 요청은 성공해 data 가 다시 온다
    fireEvent.click(within(screen.getByTestId('ai-status-load-error')).getByRole('button', { name: /다시 시도/ }))
    await runUntilData()
    // 단계가 처음부터 다시 — 지표 카드만, 경고·차트·종류별은 아직 없다
    expect(screen.queryByTestId('ai-status-alert-usage')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-status-throughput')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-status-small-graphs')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-status-kinds')).not.toBeInTheDocument()
    // 끝까지 진행하면 다섯 블록이 모두 다시 그려진다
    for (let i = 0; i < 4; i++) await stepBlock()
    expect(drawnStages()).toBe(5)
  })

  test('성공하는 기간 전환에서도 이미 그린 블록이 내려가지 않는다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    renderOverview()
    await runUntilData()
    // 다섯 블록까지 끝까지 그려 둔다
    for (let i = 0; i < 4; i++) await stepBlock()
    expect(drawnStages()).toBe(5)
    // 7일로 전환 — 새 기간 응답이 성공해 data 참조가 바뀌어도(keepPreviousData) 단계는 유지된다
    fireEvent.click(screen.getByRole('button', { name: '7일' }))
    await rollUntil(() => !!screen.queryByRole('group', { name: '7일 처리량' }))
    // 새 데이터가 반영됐다 — 처리량 제목이 7일로 바뀌었다
    expect(screen.getByRole('group', { name: '7일 처리량' })).toBeInTheDocument()
    // 이미 그린 블록이 내려가지 않는다 — 경고 usage · 처리량 · 종류 표가 계속 화면에 있다
    expect(screen.getByTestId('ai-status-alert-usage')).toBeInTheDocument()
    expect(screen.getByTestId('ai-status-throughput')).toBeInTheDocument()
    expect(screen.getByTestId('ai-status-kinds')).toBeInTheDocument()
    expect(drawnStages()).toBe(5)
  })

  test('데이터가 처음 도착할 때 본문(지표 카드) 계산은 한 태스크에 한 번만 일어난다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    // 이전 테스트가 남긴 기록을 비운다 — 묶음뿐 아니라 방금 시작한 태스크의 카운트·확정 예약도 함께 초기화해
    // 앞 테스트의 마이크로태스크 드레인 시점에 기대지 않게 한다. 이 테스트는 첫 도착 태스크만 본다.
    metricProbe.state.taskBatches.length = 0
    metricProbe.state.callsInTask = 0
    metricProbe.state.flushScheduled = false
    renderOverview()
    // 데이터가 오기 전(스켈레톤)에는 지표 계산이 없다 — 첫 기록이 곧 데이터 도착 태스크다
    await runUntilData()
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    // 전제: 지표 계산은 data 가 있는 본문에서만 불리므로(골격 단계에서는 부르지 않는다) 첫 묶음이 곧 도착 태스크이고,
    // chartsReady 는 마운트 effect 에서 차트 impl 청크를 미리 불러 골격 단계에 풀리므로 도착 태스크와 겹치지 않는다.
    // 첫 본문 계산 묶음 = 데이터 도착 태스크 — 렌더 중 setState 는 같은 태스크에 두 번 쌓여 이 단언이 깨진다
    expect(metricProbe.state.taskBatches[0]).toBe(1)
  })

  test('데이터가 오기 전 골격 자리에서 감춘 차트 준비가 그려지고, 데이터가 오면 화면에서 없어진다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    renderOverview()
    // 첫 렌더(골격)부터 준비 자리가 함께 그려진다 — Recharts 첫 실행 비용(최초 컴파일)을 데이터보다 먼저 치르기 위함(WP-2079)
    expect(screen.getByTestId('ai-status-skeleton')).toBeInTheDocument()
    const warmupSlot = screen.getByTestId('ai-status-chart-warmup')
    expect(warmupSlot).toBeInTheDocument()
    // 보조기기·검색에는 드러나지 않는 감친 자리다 — 화면 문구·레이아웃에 끼어들지 않는 것을 속성으로 못 박는다
    expect(warmupSlot).toHaveAttribute('aria-hidden', 'true')
    // 본문 흐름에 끼어들지 않는 자리다 — 고정 위치로 화면 밖에 두어야 문구·레이아웃이 밀리지 않는다(WP-2079 리뷰 2)
    expect(warmupSlot.style.position).toBe('fixed')
    expect(warmupSlot.style.insetInlineStart).toBe('-10000px')
    // 데이터가 오면 본문으로 갈아 끼고, 준비가 끝나면(두 차트가 그려지면) 준비 자리는 저절로 없어진다 —
    // 남아 있으면 실제 차트 자리와 겹쳐 testid 가 중복된다
    await runUntilData()
    await rollUntil(() => !screen.queryByTestId('ai-status-chart-warmup'))
    expect(screen.queryByTestId('ai-status-chart-warmup')).not.toBeInTheDocument()
  })
})

// ——— 차트 준비 자리(WP-2079 3라운드) ———
// 준비 자리가 응답 대기 중에 실제로 그려지는지(자리만 있는 것이 아니라 출력이 나와야 첫 실행 비용을 미리 치른다),
// 페이지가 그 준비 신호로 차트 단계를 여는지(신호 전에는 닫혀 있고, 청크 로드 실패면 데드락 없이 여는지)를 본다.
// 신호 시점은 가짜 준비 자리로 정해, 청크 로드 속도 같은 요인에 흔들리지 않게 한다.
describe('차트 준비 자리 (WP-2079 3라운드)', () => {
  afterEach(() => {
    vi.useRealTimers()
    warmupControl.fake = false
    warmupControl.signal = null
  })

  test('응답이 오기 전 골격 자리에서 준비 차트 출력이 실제로 그려진다', async () => {
    let releaseFirst: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    renderOverview({ gateFirst: gate })
    const warmupSlot = screen.getByTestId('ai-status-chart-warmup')
    // 응답은 아직 없다 — 지금은 골격과 준비 자리뿐이다
    expect(screen.queryByTestId('card-runs')).not.toBeInTheDocument()
    // 자리만 있는(스켈레톤) 상태로는 부족하다 — 차트 출력이 실제로 나와야 Recharts 첫 실행 비용을 미리 치른다(WP-2079)
    await waitFor(() => expect(warmupSlot.querySelectorAll('svg').length).toBeGreaterThan(0))
    // 두 차트(선·막대)가 모두 그려졌다
    expect(within(warmupSlot).getAllByRole('img', { hidden: true })).toHaveLength(2)
    // 그려진 뒤에는 준비가 끝난 것이므로 응답을 기다리지 않고 자리를 저절로 없앤다 —
    // 두 차트의 출력이 페이지의 준비 완료 신호까지 이어졌다는 증거다(WP-2079 3라운드)
    await waitFor(() => expect(screen.queryByTestId('ai-status-chart-warmup')).not.toBeInTheDocument())
    // 그 동안 응답은 계속 대기 중이다 — 준비는 데이터보다 먼저 일어난다
    expect(screen.queryByTestId('card-runs')).not.toBeInTheDocument()
    releaseFirst()
    await waitFor(() => expect(screen.getByTestId('card-runs')).toBeInTheDocument())
  })

  /**
   * 0ms 체인 타이머만 한 틱씩 굴린다 — `runAllTimers` 는 4초 대기 상한(CHART_STAGE_MAX_WAIT_MS) 타이머까지
   * 다 굴려 「상한 전」 창을 만들 수 없다. 1ms 씩만 앞으로 밀어 상한에는 닿지 않게 한다(WP-2079 5라운드).
   */
  async function rollChain(limit = 50): Promise<void> {
    for (let i = 0; i < limit; i++) {
      await act(async () => {
        vi.advanceTimersByTime(1)
        await Promise.resolve()
        await Promise.resolve()
      })
    }
  }

  test('차트 단계는 준비 신호가 오기 전에는 열리지 않고, 신호를 보내면 데드락 없이 열린다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    // 준비 신호를 보내지 않는 가짜 자리 — 준비가 끝나기 전의 창을 테스트가 만든다
    warmupControl.fake = true
    warmupControl.signal = null
    renderOverview()
    await rollChain()
    expect(screen.getByTestId('card-runs')).toBeInTheDocument()
    // 준비 신호가 없으니 대기 상한이 오기 전까지는 차트 단계가 열리지 않는다 — 지표·경고 단계는 준비와 무관하게 열린다
    expect(screen.getByTestId('ai-status-alert-usage')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-status-throughput')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-status-small-graphs')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-status-kinds')).not.toBeInTheDocument()
    // 준비 신호 — 그제야 차트 단계가 이어지고 종류별 표까지 데드락 없이 진행한다
    await act(async () => {
      warmupControl.signal?.()
    })
    await rollChain()
    expect(screen.getByTestId('ai-status-throughput')).toBeInTheDocument()
    expect(screen.getByTestId('ai-status-small-graphs')).toBeInTheDocument()
    expect(screen.getByTestId('ai-status-kinds')).toBeInTheDocument()
  })

  test('청크가 멈춰 준비 신호가 끝내 안 오면 대기 상한이 지난 뒤에라도 본문이 모두 나온다(WP-2079 5라운드)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    // 신호를 보낼 수 없는 가짜 자리 — impl 청크 선로딩이 응답을 내지 못한(멈춘) 상태를 그대로 만든다
    warmupControl.fake = true
    warmupControl.signal = null
    renderOverview()
    await rollChain()
    // 상한 전 — 지표·경고만 있고 차트 단계 뒤 블록(처리량·작은 그래프·종류별 표)은 아직 닫혀 있다
    expect(screen.getByTestId('ai-status-alert-usage')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-status-throughput')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-status-kinds')).not.toBeInTheDocument()
    // 상한이 거의 다 될 때까지도 기다린다 — 늦게 여는 것이지 서두르지 않아야 첫 실행 비용이 데이터 뒤로 밀리지 않는다
    await act(async () => {
      vi.advanceTimersByTime(CHART_STAGE_MAX_WAIT_MS - 500)
    })
    expect(screen.queryByTestId('ai-status-throughput')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-status-kinds')).not.toBeInTheDocument()
    // 대기 상한 경과 — 신호 없이도 게이트가 열려 끝내 안 나오던 블록이 나온다(본문이 사라지지 않는 것이 목적)
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    await rollChain()
    expect(screen.getByTestId('ai-status-throughput')).toBeInTheDocument()
    expect(screen.getByTestId('ai-status-small-graphs')).toBeInTheDocument()
    expect(screen.getByTestId('ai-status-kinds')).toBeInTheDocument()
  })

  test('차트 단계 게이트 — 준비 완료 전에는 닫혀 있고, 청크 로드 실패·대기 상한 경과면 데드락 없이 연다', () => {
    // 청크는 준비됐고(warmup 이 실제로 그려졌거나) 실패까지 알아차렸지만 아직 준비 전 — 닫혀 있어야 첫 실행 비용이 데이터 뒤로 밀리지 않는다
    expect(isChartStageOpen({ chartsReady: true, warmed: false, chartsFailed: false, waitTimedOut: false })).toBe(false)
    // 준비 완료 — 연다
    expect(isChartStageOpen({ chartsReady: true, warmed: true, chartsFailed: false, waitTimedOut: false })).toBe(true)
    // 청크 로드 실패(오류 화면엔 그림이 없어 준비가 끝나지 않는다) — 기다려도 끝나지 않으므로 연다(데드락 방지)
    expect(isChartStageOpen({ chartsReady: true, warmed: false, chartsFailed: true, waitTimedOut: false })).toBe(true)
    // 청크가 아직 오지도 않았다 — 기존 조건(청크 준비) 그대로 닫혀 있다
    expect(isChartStageOpen({ chartsReady: false, warmed: true, chartsFailed: false, waitTimedOut: false })).toBe(false)
    // 대기 상한 경과(청크 선로딩 멈춤) — 준비 신호가 영영 없어도 늦게라도 연다(WP-2079 5라운드)
    expect(isChartStageOpen({ chartsReady: false, warmed: false, chartsFailed: false, waitTimedOut: true })).toBe(true)
    expect(isChartStageOpen({ chartsReady: true, warmed: false, chartsFailed: false, waitTimedOut: true })).toBe(true)
    // 아직 상한 전 — 기존 조건 그대로 닫혀 있다(waitTimedOut 이 false 여도 닫혀 있어야 한다)
    expect(isChartStageOpen({ chartsReady: true, warmed: false, chartsFailed: false, waitTimedOut: false })).toBe(false)
  })
})
