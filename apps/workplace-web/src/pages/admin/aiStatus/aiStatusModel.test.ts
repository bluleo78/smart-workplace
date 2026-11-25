// AI 현황 개요 응답 → 화면 조각 변환 모델 판정(WP-1824) — 서버 값을 집계 없이 옮기고, null 은 null 로, 계열 색은 고정 배정이라는 계약을 테스트로 고정한다.
import { afterEach, describe, expect, test, vi } from 'vitest'

import type { AiStatusAlert, AiStatusOverview, KindRow, Tokens } from '@/api/aiStatus'

import {
  alertItem,
  alertRows,
  alertTarget,
  bucketHistoryHref,
  chartIsEmpty,
  historyHref,
  mergeChartRows,
  mergeStep,
  PERIOD_OPTIONS,
  smallGraphs,
  sortKinds,
  statCards,
  throughputRows,
  throughputSeries,
  updatedAgoLabel,
  xFormatterFor,
} from './aiStatusModel'

/** 처리량 응답 — buckets 보다 values 배열을 길게 두어 이전 기간 데이터가 섞여도 행 수가 늘지 않음을 확인한다. */
function throughputFixture(): AiStatusOverview['throughput'] {
  return {
    buckets: ['2026-11-23T01:00:00Z', '2026-11-23T02:00:00Z', '2026-11-23T03:00:00Z'],
    kinds: ['MAIL_CLASSIFY', 'OTHER'],
    values: {
      MAIL_CLASSIFY: [
        { tokens: 100, count: 10 },
        null,
        { tokens: 30, count: null },
        { tokens: 9999, count: 999 },
        { tokens: 9999, count: 999 },
      ],
      OTHER: [null, { tokens: 5, count: 2 }, { tokens: null, count: 7 }, { tokens: 9999, count: 999 }],
    },
    otherKindCount: 3,
  }
}

/** 종류별 표 한 행 — 나머지 칸은 null 로 채운다. */
function kindRow(kind: string, o: Partial<KindRow>): KindRow {
  return {
    kind,
    count: 0,
    failureRate: null,
    p50: null,
    p95: null,
    inputTokens: null,
    outputTokens: null,
    lastFailure: null,
    limited: 0,
    ...o,
  }
}

/** 토큰 한 쌍. */
function tokens(input: number, output: number): Tokens {
  return { input, output }
}

describe('throughputRows', () => {
  test('throughputRows — 응답 buckets 길이로만 행을 만든다(이전 기간 데이터를 섞지 않는다)', () => {
    const tp = throughputFixture()
    const rows = throughputRows(tp, 'tokens')

    expect(rows).toHaveLength(tp.buckets.length)
    expect(rows.map((r) => r.t)).toEqual(tp.buckets)
    // 길게 온 값 배열의 끝(9999)은 행에 나타나지 않는다
    expect(rows.some((r) => r.MAIL_CLASSIFY === 9999)).toBe(false)
  })

  test('throughputRows — null 구간은 null 로 남는다(0 이 아니다)', () => {
    const tp = throughputFixture()

    const tokensRows = throughputRows(tp, 'tokens')
    expect(tokensRows[0].MAIL_CLASSIFY).toBe(100)
    expect(tokensRows[1].MAIL_CLASSIFY).toBeNull() // 칸 자체가 null
    expect(tokensRows[2].MAIL_CLASSIFY).toBe(30)
    expect(tokensRows[0].other).toBeNull()

    const countRows = throughputRows(tp, 'count')
    expect(countRows[0].MAIL_CLASSIFY).toBe(10)
    expect(countRows[2].MAIL_CLASSIFY).toBeNull() // count 만 없는 칸
    expect(countRows[2].other).toBe(7)
  })
})

describe('throughputSeries', () => {
  test('throughputSeries — 같은 종류는 다른 순서의 응답에서도 같은 색 번호를 받는다', () => {
    const base = { buckets: ['b0', 'b1'] }
    const first = throughputSeries({
      ...base,
      kinds: ['B_KIND', 'A_KIND', 'OTHER'],
      values: { B_KIND: [], A_KIND: [], OTHER: [] },
      otherKindCount: 4,
    })
    const second = throughputSeries({
      ...base,
      kinds: ['A_KIND', 'B_KIND'],
      values: { A_KIND: [], B_KIND: [] },
      otherKindCount: 0,
    })

    // 코드 오름차순 고정 배정 — 응답이 어떤 순서로 와도 A=1, B=2
    expect(first.find((s) => s.key === 'A_KIND')?.colorIndex).toBe(1)
    expect(first.find((s) => s.key === 'B_KIND')?.colorIndex).toBe(2)
    expect(second.find((s) => s.key === 'A_KIND')?.colorIndex).toBe(1)
    expect(second.find((s) => s.key === 'B_KIND')?.colorIndex).toBe(2)

    expect(first.find((s) => s.key === 'other')).toEqual({
      key: 'other',
      label: '기타 4종',
      colorIndex: 'other',
    })
    expect(second.some((s) => s.key === 'other')).toBe(false)

    // 행도 같은 키를 쓴다 — OTHER 칸의 필드 이름은 'other'
    expect(throughputRows(throughputFixture(), 'tokens')[0]).toHaveProperty('other')
  })
})

describe('mergeChartRows', () => {
  const rows = [
    { t: 'a', x: 10, y: null },
    { t: 'b', x: 20, y: 5 },
    { t: 'c', x: null, y: null },
    { t: 'd', x: 1, y: null },
  ]

  test('mergeChartRows — 묶은 행의 값은 그룹 합이고, 전부 null 이면 null 이다', () => {
    const merged = mergeChartRows(rows, 2)

    expect(merged).toEqual([
      { t: 'a', x: 30, y: 5 }, // 10+20, null+5
      { t: 'c', x: 1, y: null }, // null 은 합에 안 섞이고, 전부 null 이면 null
    ])
    // 원본은 바꾸지 않는다
    expect(rows).toHaveLength(4)
  })

  test('mergeChartRows — 묶기 단계는 Math.ceil(n/maxBars) 이라 막대 수가 maxBars 를 넘지 않는다', () => {
    const many = Array.from({ length: 28 }, (_, i) => ({ t: `t${i}`, x: 1 }))
    const merged = mergeChartRows(many, 12)

    expect(merged).toHaveLength(10) // step 3 → 3개씩 9묶음 + 1개 1묶음
    expect(merged.length).toBeLessThanOrEqual(12)
    expect(merged[0]).toEqual({ t: 't0', x: 3 })
    expect(merged[9]).toEqual({ t: 't27', x: 1 })
  })
})

describe('chartIsEmpty', () => {
  const series = [{ key: 'a', label: 'a', colorIndex: 1 as const }]
  test('chartIsEmpty — 행이 없거나 계열 값이 전부 null 이면 빈 차트다', () => {
    expect(chartIsEmpty([], series)).toBe(true)
    expect(chartIsEmpty([{ t: '22:00', a: null }, { t: '22:15', a: null }], series)).toBe(true)
  })

  test('chartIsEmpty — 값 0 도 있는 값으로 센다', () => {
    expect(chartIsEmpty([{ t: '22:00', a: 0 }], series)).toBe(false)
    expect(chartIsEmpty([{ t: '22:00', a: null }, { t: '22:15', a: 3 }], series)).toBe(false)
  })
})

describe('sortKinds', () => {
  test('sortKinds — 실패율 → 출력 토큰 → 건수 내림차순, 없는 값은 맨 뒤', () => {
    const kinds: KindRow[] = [
      kindRow('A', { count: 10, failureRate: 0.5, outputTokens: 100 }),
      kindRow('B', { count: 99, failureRate: 0.5, outputTokens: 200 }), // 같은 실패율 → 출력 토큰
      kindRow('C', { count: 5, failureRate: 0.4, outputTokens: null }),
      kindRow('D2', { count: 9, failureRate: 0.3, outputTokens: 50 }),
      kindRow('D', { count: 7, failureRate: 0.3, outputTokens: 50 }), // 같은 실패율·토큰 → 건수
      kindRow('E', { count: 8, failureRate: 0.2, outputTokens: 40 }),
      kindRow('F', { count: 9, failureRate: 0.1, outputTokens: 30 }),
      kindRow('G', { count: 500, failureRate: null, outputTokens: 99999 }), // 실패율 없음 → 맨 뒤
      kindRow('H', { count: 600, failureRate: null, outputTokens: null }),
    ]

    const sorted = sortKinds(kinds)

    expect(sorted.map((k) => k.kind)).toEqual(['B', 'A', 'C', 'D2', 'D', 'E', 'F', 'G', 'H'])
    expect(kinds).toHaveLength(9) // 원본 불변
  })
})

describe('alertItem', () => {
  const alerts: AiStatusAlert[] = [
    { code: 'KIND_FAILURE', severity: 'DANGER', kind: 'MAIL_CLASSIFY', accountId: null, label: null, value: 0.25, threshold: 0.09 },
    { code: 'QUEUE_WAIT', severity: 'WARNING', kind: null, accountId: null, label: null, value: 1900, threshold: 1800 },
    { code: 'ACCOUNT_USAGE', severity: 'WARNING', kind: null, accountId: 7, label: '운영 · 5h', value: 85, threshold: 80 },
    { code: 'BACKLOG_STUCK', severity: 'WARNING', kind: 'FILE_SUMMARY', accountId: null, label: null, value: 12, threshold: 10 },
    { code: 'SOMETHING_NEW', severity: 'INFO', kind: null, accountId: null, label: null, value: null, threshold: null },
  ]

  test('alertItem — 심각도를 AlertList 수준으로 옮기고 경고 종류별 문구를 만든다', () => {
    const items = alerts.map(alertItem)

    expect(items.map((i) => i.level)).toEqual(['danger', 'warning', 'warning', 'warning', 'info'])
    expect(items[0].label).toBe('MAIL_CLASSIFY 실패율 25% · 기준 9%')
    expect(items[1].label).toBe('최장 대기 31분 40초 · 기준 30분')
    expect(items[2].label).toBe('운영 5시간 사용률 85% · 기준 80%')
    expect(items[3].label).toBe('FILE_SUMMARY 밀린 건수 12건 · 60분 전 10건')
    expect(items[4].label).toBe('SOMETHING_NEW')
  })

  test('alertItem — 같은 계정이 5시간·7일 창에 모두 걸려도 id 가 겹치지 않는다', () => {
    const both: AiStatusAlert[] = [
      { code: 'ACCOUNT_USAGE', severity: 'WARNING', kind: null, accountId: 7, label: '운영 · 5h', value: 85, threshold: 80 },
      { code: 'ACCOUNT_USAGE', severity: 'WARNING', kind: null, accountId: 7, label: '운영 · 7d', value: 90, threshold: 80 },
    ]
    const items = both.map(alertItem)
    expect(new Set(items.map((i) => i.id)).size).toBe(2)
  })

  test('alertItem — id 는 중복 없고 이동 동작은 아직 없다(WP-1825)', () => {
    const items = alerts.map(alertItem)

    expect(new Set(items.map((i) => i.id)).size).toBe(items.length)
    expect(items.every((i) => i.action === undefined)).toBe(true)
  })
})

describe('alertRows', () => {
  const base: AiStatusAlert = { code: '', severity: 'WARNING', kind: null, accountId: null, label: null, value: null, threshold: null }
  const acct = (accountId: number, label: string, severity: string, value: number, threshold: number | null): AiStatusAlert => ({
    ...base,
    code: 'ACCOUNT_USAGE',
    severity,
    accountId,
    label,
    value,
    threshold,
  })

  test('계정 경고 여러 개는 첫 계정 경고 자리에 한 줄로 묶인다', () => {
    const alerts: AiStatusAlert[] = [
      { ...base, code: 'KIND_FAILURE', severity: 'DANGER', kind: 'MAIL', value: 0.25, threshold: 0.09 },
      { ...base, code: 'QUEUE_WAIT', value: 1900, threshold: 1800 },
      acct(1, '운영 · 5h', 'WARNING', 85, 80),
      acct(1, '운영 · 7d', 'WARNING', 90, 80),
      acct(2, '보조 · 7d', 'WARNING', 82, 80),
      { ...base, code: 'BACKLOG_STUCK', kind: 'MAIL', value: 12, threshold: 10 },
    ]
    const rows = alertRows(alerts, '24h')

    expect(rows).toHaveLength(4)
    expect(rows[2].item).toEqual({ id: 'ACCOUNT_USAGE-group', level: 'warning', label: 'AI 계정 2개 한도 근접(80% 이상)' })
    expect(rows[2].target).toEqual({ label: '계정 보기', href: '/settings/agents/accounts' })
    expect(rows[0].item.label).toBe(alertItem(alerts[0], 0).label)
    expect(rows[0].target).toEqual(alertTarget(alerts[0], '24h'))
    expect(rows[3].item.label).toBe(alertItem(alerts[5], 5).label)
    expect(rows[3].target).toEqual(alertTarget(alerts[5], '24h'))
  })

  test('묶인 것 중 위험이 있으면 위험이다', () => {
    const rows = alertRows([acct(1, '운영 · 5h', 'WARNING', 85, 80), acct(2, '보조 · 5h', 'DANGER', 100, 100)], '24h')
    expect(rows).toHaveLength(1)
    expect(rows[0].item.level).toBe('danger')
    expect(rows[0].item.label).toBe('AI 계정 2개 한도 근접(80% 이상) · 1개 도달')
  })

  test('계정 경고가 하나면 묶지 않고 상세 문구와 「계정 보기」 를 그대로 둔다', () => {
    const one = acct(3, '운영 · 5h', 'WARNING', 85, 80)
    const rows = alertRows([one], '24h')
    expect(rows).toHaveLength(1)
    expect(rows[0].item).toEqual(alertItem(one, 0))
    expect(rows[0].item.label).toContain('사용률 85%')
    expect(rows[0].item.label).not.toContain('AI 계정 1개')
    expect(rows[0].target).toEqual({ label: '계정 보기', href: '/settings/agents/accounts' })
  })

  test('accountId 가 없으면 라벨의 창 꼬리를 뗀 이름으로 한 계정을 센다', () => {
    const noId = (label: string): AiStatusAlert => ({ ...acct(0, label, 'WARNING', 85, 80), accountId: null })
    const rows = alertRows([noId('운영 · 5h'), noId('운영 · 7d')], '24h')
    expect(rows[0].item.label).toBe('운영 5시간·7일 한도 근접(80% 이상)')
  })

  test('한 계정이 5시간·7일 두 창에 함께 걸리면 묶어도 계정 이름과 창을 남긴다', () => {
    const rows = alertRows([acct(1, '운영 · 5h', 'DANGER', 100, 100), acct(1, '운영 · 7d', 'WARNING', 85, 80)], '24h')
    expect(rows).toHaveLength(1)
    expect(rows[0].item.level).toBe('danger')
    expect(rows[0].item.label).toBe('운영 5시간·7일 한도 근접(80% 이상) · 5시간 도달')
    expect(rows[0].item.label).not.toContain('AI 계정 1개')
    expect(rows[0].target).toEqual({ label: '계정 보기', href: '/settings/agents/accounts' })
  })

  test('한 계정의 두 창이 모두 기준 100% 이상이면 「한도 도달(100% 이상)」', () => {
    const rows = alertRows([acct(1, '운영 · 5h', 'DANGER', 100, 100), acct(1, '운영 · 7d', 'DANGER', 101, 100)], '24h')
    expect(rows[0].item.label).toBe('운영 5시간·7일 한도 도달(100% 이상)')
  })

  test('한 계정인데 라벨이 없어 이름을 모르면 「AI 계정 1개」 로 적는다', () => {
    const noLabel = (): AiStatusAlert => ({ ...acct(7, '', 'WARNING', 85, 80), label: null })
    const rows = alertRows([noLabel(), noLabel()], '24h')
    expect(rows[0].item.label).toBe('AI 계정 1개 한도 근접(80% 이상)')
  })

  test('기준이 모두 없으면 괄호를 뺀다', () => {
    const rows = alertRows([acct(1, '운영 · 5h', 'WARNING', 85, null), acct(2, '보조 · 5h', 'WARNING', 86, null)], '24h')
    expect(rows[0].item.label).toBe('AI 계정 2개 한도 근접')
  })

  test('모든 계정이 기준 100% 이상이면 「한도 도달」로 적는다', () => {
    const rows = alertRows([acct(1, '운영 · 5h', 'DANGER', 100, 100), acct(2, '보조 · 5h', 'DANGER', 105, 100)], '24h')
    expect(rows[0].item.label).toBe('AI 계정 2개 한도 도달(100% 이상)')
  })

  test('계정 경고가 없으면 묶은 줄도 없다', () => {
    const rows = alertRows([{ ...base, code: 'KIND_FAILURE', kind: 'MAIL', value: 0.25, threshold: 0.09 }], '24h')
    expect(rows).toHaveLength(1)
    expect(rows.some((r) => r.item.id.includes('ACCOUNT_USAGE-group'))).toBe(false)
  })
})

describe('xFormatterFor', () => {
  // 연도가 현재와 다르면 월·일 앞에 연도가 붙으므로 시각을 고정해 해가 바뀌어도 판정이 같게 한다
  afterEach(() => vi.useRealTimers())

  /** 로컬 HH:mm — 기대값을 타임존과 무관하게 같은 식으로 만든다. */
  const hhmmOf = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

  test('구간 길이로 고른다 — 1시간 미만·15분 구간은 HH:mm, 6시간 구간은 M/D HH:mm, 하루 구간은 월·일, 해석 못 하는 값은 원문', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-23T12:00:00Z'))
    const iso = '2026-11-23T01:00:00Z'
    const d = new Date(iso)
    expect(xFormatterFor(60)(iso)).toBe(hhmmOf(d))
    expect(xFormatterFor(900)(iso)).toBe(hhmmOf(d))
    expect(xFormatterFor(21_600)(iso)).toBe(`${d.getMonth() + 1}/${d.getDate()} ${hhmmOf(d)}`)
    expect(xFormatterFor(86_400)(iso)).toBe(`${d.getMonth() + 1}월 ${d.getDate()}일`)
    expect(xFormatterFor(900)('b0')).toBe('b0')
    expect(xFormatterFor(21_600)('b0')).toBe('b0')
  })

  test('7일 보기(6시간 구간)는 하루 4막대의 라벨이 모두 다르다 — 날짜만 쓰면 같은 라벨·툴팁이 겹친다(WP-1824 리뷰 2)', () => {
    const start = Date.parse('2026-11-20T00:00:00Z')
    const day = Array.from({ length: 4 }, (_, i) => new Date(start + i * 21_600_000).toISOString())
    const labels = day.map(xFormatterFor(21_600))
    expect(new Set(labels).size).toBe(4)
  })
})

describe('statCards', () => {
  const metrics: AiStatusOverview['metrics'] = {
    runCount: { current: 1234, previous: 1000 },
    tokens: { current: tokens(1_200_000, 340_000), previous: tokens(1_100_000, 300_000) },
    failureRate: { current: 0.05, previous: 0.034 },
    responseTime: { current: { p50: 800, p95: 12_300 }, previous: { p50: 700, p95: 10_000 } },
    waitTime: { current: { p95: 245_000, queueWaiting: 12 }, previous: { p95: null, queueWaiting: null } },
    slotUsage: { current: { used: 3, limit: 8 }, previous: null },
    limited: 0,
    limitedCredentials: [],
  }

  test('statCards — 지표 6장의 testId·제목·값·아랫줄', () => {
    const cards = statCards(metrics)

    expect(cards.map((c) => c.testId)).toEqual([
      'card-runs',
      'card-tokens',
      'card-failure-rate',
      'card-response-time',
      'card-wait-time',
      'card-slot-usage',
    ])
    expect(cards.map((c) => c.title)).toEqual([
      '처리 건수',
      '토큰',
      '실패율',
      '응답 시간',
      '대기 시간',
      '동시 처리',
    ])
    expect(cards.map((c) => c.value)).toEqual(['1,234', '1.5M', '5%', '12.3초', '4분 5초', '3 / 8건'])
    expect(cards.map((c) => c.meta)).toEqual([
      '직전 1,000',
      '직전 1.4M · 입력 1.2M · 출력 340K',
      '직전 3.4% · +1.6%p',
      'p95 · 직전 10초',
      'p95 · 직전 — · 대기 12건',
      '진행 중 / 한도 · 직전 —',
    ])
  })

  test('statCards — 동시 처리 직전 값이 있으면 아랫줄에 붙고, 한도가 없으면 자리만 —(단위 「건」 은 늘 끝)', () => {
    const withPrev = statCards({ ...metrics, slotUsage: { current: { used: 3, limit: 8 }, previous: { used: 2, limit: 8 } } })
    expect(withPrev[5].meta).toBe('진행 중 / 한도 · 직전 2 / 8건')

    const noLimit = statCards({ ...metrics, slotUsage: { current: { used: 3, limit: null }, previous: null } })
    expect(noLimit[5].value).toBe('3 / —건')

    const noSample = statCards({ ...metrics, slotUsage: { current: null, previous: null } })
    expect(noSample[5].value).toBe('—')
  })
})

describe('smallGraphs', () => {
  const series: AiStatusOverview['series'] = {
    buckets: ['b0', 'b1', 'b2'],
    responseP50: [100, null, 300],
    responseP95: [500, 600, null],
    failures: [1, null, 3],
    queueWaiting: [2, 3, null],
    slotUsed: [1, 2, 3],
    slotLimit: [8, 8, 8],
    backlog: {
      FILE_SUMMARY: [1, 2, 3],
      MAIL_CLASSIFY: [null, 1, 2],
    },
  }

  test('smallGraphs — testId 5개 순서와 막대는 실패 하나만', () => {
    const defs = smallGraphs(series)

    expect(defs.map((d) => d.testId)).toEqual([
      'graph-response',
      'graph-failures',
      'graph-queue-wait',
      'graph-backlog',
      'graph-slot',
    ])
    expect(defs.map((d) => d.kind)).toEqual(['line', 'bar', 'line', 'line', 'line'])
    expect(defs.map((d) => d.title)).toEqual(['응답 시간', '실패', '대기', '밀린 건수', '동시 처리'])
    expect(defs.every((d) => d.ariaLabel.length > 0)).toBe(true)
  })

  test('smallGraphs — null 구간은 null, 동시 처리 그래프의 기준선', () => {
    const defs = smallGraphs(series)
    const byId = Object.fromEntries(defs.map((d) => [d.testId, d]))

    expect(byId['graph-response'].rows[1]).toEqual({ t: 'b1', p95: 600, p50: null })
    expect(byId['graph-slot'].limit).toEqual({ value: 8, label: '한도' })
    expect(byId['graph-slot'].series).toEqual([{ key: 'used', label: '진행 중', colorIndex: 1 }])
    expect(byId['graph-slot'].ariaLabel).toBe('기간별 동시 처리(한도 포함)')
    expect(byId['graph-response'].limit).toBeUndefined()
    expect(byId['graph-queue-wait'].rows[2].queueWaiting).toBeNull()
  })

  test('smallGraphs — 밀린 건수 계열은 종류 코드 오름차순으로 고정 배정', () => {
    const def = smallGraphs(series).find((d) => d.testId === 'graph-backlog')

    expect(def?.series).toEqual([
      { key: 'FILE_SUMMARY', label: 'FILE_SUMMARY', colorIndex: 1 },
      { key: 'MAIL_CLASSIFY', label: 'MAIL_CLASSIFY', colorIndex: 2 },
    ])
    expect(def?.rows[0]).toEqual({ t: 'b0', FILE_SUMMARY: 1, MAIL_CLASSIFY: null })
  })
})

describe('머리·기간', () => {
  test('PERIOD_OPTIONS — 1시간·24시간·7일·30일 순서', () => {
    expect(PERIOD_OPTIONS.map((o) => o.value)).toEqual(['1h', '24h', '7d', '30d'])
    expect(PERIOD_OPTIONS.map((o) => o.label)).toEqual(['1시간', '24시간', '7일', '30일'])
  })

  test('updatedAgoLabel — 갱신 n초 전, 미래 시각은 0초', () => {
    const now = Date.parse('2026-11-23T06:00:00.000Z')

    expect(updatedAgoLabel('2026-11-23T05:59:55.000Z', now)).toBe('갱신 5초 전')
    expect(updatedAgoLabel('2026-11-23T05:58:30.000Z', now)).toBe('갱신 1분 전')
    expect(updatedAgoLabel('2026-11-23T05:00:00.000Z', now)).toBe('갱신 1시간 전')
    expect(updatedAgoLabel('2026-11-23T03:00:00.000Z', now)).toBe('갱신 3시간 전')
    expect(updatedAgoLabel('2026-11-23T06:00:10.000Z', now)).toBe('갱신 0초 전')
  })
})
describe('처리 이력 주소', () => {
  test('historyHref — 이력 API 와 같은 이름(kind 반복·status·from·to)으로 주소를 만들고 기본 기간 24h·기타 묶음은 넣지 않는다', () => {
    expect(historyHref({})).toBe('/settings/ai-status/history')
    expect(historyHref({ period: '24h' })).toBe('/settings/ai-status/history')
    expect(historyHref({ period: '7d', kinds: ['MAIL', 'OTHER', 'CHAT'], status: 'FAILED' })).toBe(
      '/settings/ai-status/history?period=7d&kind=MAIL&kind=CHAT&status=FAILED',
    )
    expect(historyHref({ from: '2026-11-22T00:00:00.000Z', to: '2026-11-22T00:15:00.000Z' })).toBe(
      '/settings/ai-status/history?from=2026-11-22T00%3A00%3A00.000Z&to=2026-11-22T00%3A15%3A00.000Z',
    )
  })

  test('alertTarget — 경고 종류별 이동: 실패율→그 종류 실패, 밀린 건수→그 종류, 최장 대기→기간 전체, 계정→계정 관리', () => {
    const base: AiStatusAlert = { code: '', severity: 'WARNING', kind: null, accountId: null, label: null, value: null, threshold: null }
    expect(alertTarget({ ...base, code: 'KIND_FAILURE', kind: 'MAIL' }, '1h')).toEqual({
      label: '이력 보기',
      href: '/settings/ai-status/history?period=1h&kind=MAIL&status=FAILED',
    })
    expect(alertTarget({ ...base, code: 'BACKLOG_STUCK', kind: 'FILE_SUMMARY' }, '24h')).toEqual({
      label: '이력 보기',
      href: '/settings/ai-status/history?kind=FILE_SUMMARY',
    })
    expect(alertTarget({ ...base, code: 'QUEUE_WAIT' }, '30d')).toEqual({
      label: '이력 보기',
      href: '/settings/ai-status/history?period=30d',
    })
    expect(alertTarget({ ...base, code: 'ACCOUNT_USAGE', accountId: 7, label: '운영 · 5h' }, '7d')).toEqual({
      label: '계정 보기',
      href: '/settings/agents/accounts',
    })
    expect(alertTarget({ ...base, code: 'SOMETHING_NEW' }, '24h')).toBeNull()
  })

  test('bucketHistoryHref — 구간 시작부터 spanSeconds 뒤까지, 시각을 읽을 수 없으면 null', () => {
    expect(bucketHistoryHref('2026-11-22T22:00:00Z', 21600, '2026-11-30T00:00:00Z')).toBe(
      historyHref({ from: '2026-11-22T22:00:00.000Z', to: '2026-11-23T04:00:00.000Z' }),
    )
    // 창 끝을 넘는 묶음은 to 를 창 끝에서 자른다(모바일 마지막 묶음)
    expect(bucketHistoryHref('2026-11-22T22:00:00Z', 21600, '2026-11-23T00:00:00Z')).toBe(
      historyHref({ from: '2026-11-22T22:00:00.000Z', to: '2026-11-23T00:00:00.000Z' }),
    )
    expect(bucketHistoryHref('t0', 900, '2026-11-30T00:00:00Z')).toBeNull()
    expect(bucketHistoryHref(null, 900, '2026-11-30T00:00:00Z')).toBeNull()
    expect(bucketHistoryHref('2026-11-22T22:00:00Z', 0, '2026-11-30T00:00:00Z')).toBeNull()
  })

  test('mergeStep — mergeChartRows 와 같은 묶음 크기(최소 1)', () => {
    expect(mergeStep(24, 12)).toBe(2)
    expect(mergeStep(25, 12)).toBe(3)
    expect(mergeStep(5, 12)).toBe(1)
    expect(mergeStep(0, 12)).toBe(1)
    expect(mergeChartRows(Array.from({ length: 25 }, (_, i) => ({ t: String(i), a: 1 })), 12)).toHaveLength(Math.ceil(25 / mergeStep(25, 12)))
  })
})
