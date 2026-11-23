// 관리자 AI 현황 개요(WP-1824) 응답 팩토리 — 응답 타입 AiStatusOverview 를 적용해 API 스펙이 바뀌면 E2E 모킹이 컴파일 오류로 드러나게 한다.
import type { AiStatusOverview } from '../../src/api/aiStatus'

/** 24시간·15분 구간 두 칸짜리 개요 — 처리 12건(직전 8), 작업 칸 3/8, 종류 MAIL 하나, 경고 없음. */
export function createAiStatusOverview(over: Partial<AiStatusOverview> = {}): AiStatusOverview {
  const buckets = ['2026-11-21T22:00:00Z', '2026-11-21T22:15:00Z']
  return {
    period: '24h',
    bucketSeconds: 900,
    from: '2026-11-21T22:00:00Z',
    to: '2026-11-22T22:00:00Z',
    generatedAt: new Date().toISOString(),
    metrics: {
      runCount: { current: 12, previous: 8 },
      tokens: { current: { input: 1200, output: 300 }, previous: { input: 1000, output: 200 } },
      failureRate: { current: 0.1, previous: 0.08 },
      responseTime: { current: { p50: 800, p95: 1500 }, previous: { p50: 700, p95: 1200 } },
      waitTime: { current: { p95: 2500, queueWaiting: 3 }, previous: { p95: 2000, queueWaiting: 2 } },
      slotUsage: { current: { used: 3, limit: 8 }, previous: { used: 2, limit: 8 } },
    },
    throughput: {
      buckets,
      kinds: ['MAIL'],
      values: { MAIL: [{ tokens: 100, count: 5 }, { tokens: 120, count: 6 }] },
      otherKindCount: 0,
    },
    series: {
      buckets,
      responseP50: [800, 850],
      responseP95: [1500, 1600],
      failures: [1, 0],
      queueWaiting: [3, 2],
      slotUsed: [3, 3],
      slotLimit: [8, 8],
      backlog: {},
      account5h: [],
    },
    kinds: [{ kind: 'MAIL', count: 11, failureRate: 0.1, p50: 800, p95: 1500, inputTokens: 1000, outputTokens: 300, lastFailure: null }],
    usage: { slotUsed: 3, slotLimit: 8, queueWaiting: 3, accounts: [] },
    alerts: [],
    ...over,
  }
}
