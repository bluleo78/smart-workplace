// AI 현황 개요 조회(WP-1824)·처리 이력 조회(WP-1825) — 관리자 「AI 현황 › 개요」 화면이 부르는 GET /admin/ai-status/overview 와 그 응답 DTO.
// 서버 레코드(AiStatusOverview·AiStatusAlert)를 필드 그대로 옮긴다 — Instant 는 ISO 문자열, 박스형 스칼라(Long·Integer·Double)는
// 값이 없을 수 있어 number | null, 레코드 요소는 JSON 에 없을 수 있을 때만 null 로 둔다.
import { client } from './client'

/** 조회 기간 코드 — 서버가 받는 네 가지(그 밖은 400), 기본값은 24h. */
export type AiStatusPeriod = '1h' | '24h' | '7d' | '30d'

/** 기간 코드 전체 — 기간 단추·기본 기간 정의에 쓴다. */
export const AI_STATUS_PERIODS: readonly AiStatusPeriod[] = ['1h', '24h', '7d', '30d']

/** 현재·직전 기간 값 한 쌍 — 직전 값이 없으면 previous 가 null(서버 Pair 레코드). */
export interface Pair<T> {
  current: T
  previous: T | null
}

/** 입력·출력 토큰 합(밀리초 아님 — 토큰 개수). */
export interface Tokens {
  input: number
  output: number
}

/** 응답 시간 백분위(p50·p95, 밀리초) — 끝난 처리가 없으면 각각 null. */
export interface Latency {
  p50: number | null
  p95: number | null
}

/** 대기 시간 p95(밀리초)와 그 시점 대기 건수 — 표본이 없으면 null. */
export interface Wait {
  p95: number | null
  queueWaiting: number | null
}

/** 동시 처리 사용(최근 표본) — 표본이 없으면 전체가 null 이고 필드도 없을 수 있다. */
export interface Slot {
  used: number | null
  limit: number | null
}

/** 지표 6종 — 각 값은 현재·직전 기간 한 쌍. */
export interface Metrics {
  runCount: Pair<number | null>
  tokens: Pair<Tokens>
  failureRate: Pair<number | null>
  responseTime: Pair<Latency>
  waitTime: Pair<Wait>
  slotUsage: Pair<Slot | null>
}

/** 처리량 한 칸(토큰 합·건수) — 데이터가 없는 구간은 칸 자체가 null 이다(0 이 아니다). */
export interface Cell {
  tokens: number | null
  count: number | null
}

/** 처리량 — kinds 는 상위 5 종류 + (더 있으면) OTHER, values 각 배열은 buckets 와 같은 길이. */
export interface Throughput {
  buckets: string[]
  kinds: string[]
  values: Record<string, (Cell | null)[]>
  /** "OTHER" 에 묶인 종류 수. */
  otherKindCount: number
}

/** 작은 그래프 시계열 — 모든 배열이 buckets 와 같은 길이고 없는 구간은 null. */
export interface Series {
  buckets: string[]
  responseP50: (number | null)[]
  responseP95: (number | null)[]
  failures: (number | null)[]
  queueWaiting: (number | null)[]
  slotUsed: (number | null)[]
  slotLimit: (number | null)[]
  backlog: Record<string, (number | null)[]>
}

/** 종류별 마지막 실패 — 실패 이유(error_reason)는 없을 수 있다. */
export interface LastFailure {
  at: string
  reason: string | null
}

/** 종류별 표 한 행 — 실패율·백분위·토큰이 없는 종류(위임 작업 등)는 null. */
export interface KindRow {
  kind: string
  count: number
  failureRate: number | null
  p50: number | null
  p95: number | null
  inputTokens: number | null
  outputTokens: number | null
  lastFailure: LastFailure | null
}

/** AI 현황 화면의 경고 한 줄 — code·severity 는 늘 있고 나머지는 경고 종류에 따라 null. */
export interface AiStatusAlert {
  code: string
  severity: string
  kind: string | null
  accountId: number | null
  label: string | null
  value: number | null
  threshold: number | null
}

/** AI 현황 개요 응답 — 서버 AiStatusOverview 레코드와 1:1. 구간 데이터가 없는 칸은 0 이 아니라 null 이다. 서버는 usage 블록(slotUsed·slotLimit·queueWaiting)도 보내지만 화면이 쓰지 않아 타입에서 뺐다(무시된다). */
export type AiStatusOverview = {
  period: string
  bucketSeconds: number
  from: string
  to: string
  generatedAt: string
  metrics: Metrics
  throughput: Throughput
  series: Series
  kinds: KindRow[]
  alerts: AiStatusAlert[]
}

/** 기간 period 로 관리자 AI 현황 개요를 부른다 — 기간 코드를 period 파라미터로 그대로 보낸다(없으면 서버가 24h 기본). */
export async function getAiStatusOverview(period: AiStatusPeriod): Promise<AiStatusOverview> {
  const { data } = await client.get<AiStatusOverview>('/admin/ai-status/overview', { params: { period } })
  return data
}
// ─── 처리 이력(WP-1825) — GET /admin/ai-status/runs(커서 페이지)·/runs/{runId}(상세). 서버 AiRun* 레코드를 필드 그대로 옮긴다. ───

/** 처리 상태 코드 — 서버 status 문자열의 알려진 값(그 밖의 값이 와도 깨지지 않게 응답 타입은 string). */
export type AiRunStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED'

/** 실행 주체 종류 코드 — 자동·사용자·에이전트. */
export type AiRunActorType = 'AUTO' | 'USER' | 'AGENT'

/** 처리 대상(메일·이슈 등) — 대상이 없으면 전체가 null, 있어도 각 값은 없을 수 있다. */
export interface AiRunTarget {
  type: string | null
  id: string | null
  label: string | null
}

/** 처리를 일으킨 주체 — 자동 처리는 id·name 이 null. */
export interface AiRunActor {
  type: string
  id: number | null
  name: string | null
}

/** 처리 이력 목록 한 줄. */
export interface AiRunListItem {
  id: string
  kind: string
  target: AiRunTarget | null
  actor: AiRunActor | null
  status: string
  startedAt: string | null
  endedAt: string | null
  waitMs: number | null
  durationMs: number | null
  inputTokens: number | null
  outputTokens: number | null
  model: string | null
  errorReason: string | null
}

/** 처리 이력 한 페이지 — nextCursor 가 null 이면 마지막. */
export interface AiRunPage {
  items: AiRunListItem[]
  nextCursor: string | null
}

/** 처리 이력 상세 — 목록 한 줄(item)에 캐시 토큰·자격 증명·시도 횟수·오류 상세를 더한다. */
export interface AiRunDetail {
  item: AiRunListItem
  runId: string
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
  credentialLabel: string | null
  attempt: number | null
  sourceAt: string | null
  errorDetail: string | null
}

/** 처리 이력 필터 — 비어 있는 값은 요청에 싣지 않는다. */
export interface AiRunsParams {
  kind?: string[]
  status?: string
  actorType?: string
  model?: string
  q?: string
  from?: string
  to?: string
}

/**
 * 처리 이력 한 페이지를 부른다. kind 는 반복 파라미터(kind=A&kind=B)로 보내고(paramsSerializer indexes: null),
 * 빈 문자열·빈 배열·undefined 는 아예 싣지 않는다 — 서버가 빈 값을 필터로 읽지 않게.
 */
export async function getAiStatusRuns(params: AiRunsParams & { cursor?: string; size?: number }): Promise<AiRunPage> {
  const query: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value) && value.length === 0) continue
    query[key] = value
  }
  const { data } = await client.get<AiRunPage>('/admin/ai-status/runs', { params: query, paramsSerializer: { indexes: null } })
  return data
}

/** 처리 한 건의 상세를 부른다. */
export async function getAiStatusRunDetail(runId: string): Promise<AiRunDetail> {
  const { data } = await client.get<AiRunDetail>(`/admin/ai-status/runs/${runId}`)
  return data
}
