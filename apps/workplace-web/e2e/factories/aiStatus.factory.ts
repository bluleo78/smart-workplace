// 관리자 AI 현황 개요(WP-1824·WP-1825) 응답 팩토리 — 응답 타입 AiStatusOverview 를 적용해 API 스펙이 바뀌면 E2E 모킹이 컴파일 오류로 드러나게 한다.
import type { AiRunDetail, AiRunListItem, AiRunPage, AiStatusOverview } from '../../src/api/aiStatus'

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

/** 처리 이력 한 줄 — 기본은 메일 분류 배치 실패 한 건(자동 처리, 응답 시간 초과). */
export function createAiRunItem(over: Partial<AiRunListItem> = {}): AiRunListItem {
  return {
    id: 'R-0b6f0c1e-0000-4000-8000-000000000001',
    kind: 'MAIL_CLASSIFY_BATCH',
    target: { type: 'MAIL_MESSAGE', id: '20', label: '메일 20통 · 김민수' },
    actor: { type: 'AUTO', id: null, name: null },
    status: 'FAILED',
    startedAt: '2026-11-20T05:32:10Z',
    endedAt: null,
    waitMs: 400,
    durationMs: 30000,
    inputTokens: null,
    outputTokens: null,
    model: 'claude-haiku-5-5',
    errorReason: '응답 시간 초과',
    ...over,
  }
}

/** 처리 이력 한 페이지 — nextCursor 를 안 주면 마지막 페이지(null). */
export function createAiRunPage(items: AiRunListItem[], nextCursor: string | null = null): AiRunPage {
  return { items, nextCursor }
}

/** 처리 상세 — 기본 item 은 createAiRunItem(), runId 는 고정 UUID. */
export function createAiRunDetail(over: Partial<AiRunDetail> = {}): AiRunDetail {
  return {
    item: createAiRunItem(),
    runId: '0b6f0c1e-0000-4000-8000-000000000001',
    cacheReadTokens: null,
    cacheWriteTokens: null,
    credentialLabel: null,
    attempt: 1,
    sourceAt: null,
    errorDetail: null,
    ...over,
  }
}
