// AI 위임 작업 「AI별」 보기(WP-1201) 순수 로직 — AI 한 명의 대표 상태·그 상태로 있은 시각·정렬·상태별 건수.
// 화면은 이 모듈만 부른다(vitest 로 검증). 콜센터 현황판처럼 「상태 + 그 상태로 있은 시간」을 한 줄에 보인다.
// AI 마다 판정은 rosterRows 에서 한 번만 하고, 정렬·건수·거르기·그리기는 그 결과(RosterRow)를 읽는다.
import type { AiAgentStatus, AiAgentWork } from '../api/aiAgents'
import type { AgentWorkState } from '../types/issue'
import { AGENT_STATE_LABEL } from './agentWork'

/** AI 한 명의 대표 상태 — 칩·AI 간 정렬은 이 순서(연결 끊김은 차단됨과 같은 급함). 한 AI 안에서 대표 작업을 고르는 순서는 WORK.lead 로 따로 둔다. */
export type RosterState = 'needs' | 'blocked' | 'offline' | 'working' | 'waiting' | 'idle'

export const ROSTER_STATES: RosterState[] = ['needs', 'blocked', 'offline', 'working', 'waiting', 'idle']

/** 화면 라벨 — 작업 행 배지·이슈별 빠른 필터 칩과 같은 상태는 AGENT_STATE_LABEL 을 그대로 쓴다(이름을 바꿀 때 한 곳만 고치게 — WP-1513). */
export const ROSTER_LABEL: Record<RosterState, string> = {
  needs: AGENT_STATE_LABEL.INPUT_REQUIRED,
  blocked: AGENT_STATE_LABEL.BLOCKED,
  offline: '연결 끊김',
  working: AGENT_STATE_LABEL.WORKING,
  waiting: '기다림',
  idle: '쉬는 중',
}

const RANK: Record<RosterState, number> = { needs: 0, blocked: 1, offline: 1, working: 2, waiting: 3, idle: 4 }

// 진행 중으로 치는 작업 행 상태 한 표 — group: 대표 상태 묶음, lead: 한 AI 안에서 대표 작업을 고르는 순서(작을수록 앞, AI 간 정렬 RANK 와 다르다 — WP-1955).
// 묶음: 인증 필요는 이슈별 빠른 필터 칩처럼 「차단됨」에 묶는다(같은 행이 보기마다 다른 칩에 들어가지 않게).
// 검토 필요(REVIEW)는 AI 가 일을 끝내고 사람 검토·배포를 기다리는 행이라 AI 를 바쁘게 보이지 않으므로 이 표에 없다(따로 건수).
// 순서: 인증 필요는 사람이 풀어 주기 전엔 AI 가 일을 못 하므로 작업 중보다 앞, 선행 대기로 막힌 BLOCKED 는
// 다른 행이 일하고 있으면 그 AI 는 일하는 중이므로 작업 중 뒤(작업 중 > 차단 은 서버 AgentSlotAggregate 와 같다 — 서버는 IDLE·WORKING·BLOCKED 만 합친다).
const WORK = {
  INPUT_REQUIRED: { group: 'needs', lead: 0 },
  AUTH_REQUIRED: { group: 'blocked', lead: 1 },
  WORKING: { group: 'working', lead: 2 },
  SUBMITTED: { group: 'working', lead: 2 },
  BLOCKED: { group: 'blocked', lead: 3 },
  WAITING: { group: 'waiting', lead: 4 },
  SCHEDULED: { group: 'waiting', lead: 4 },
  PAUSED: { group: 'waiting', lead: 4 },
} as const satisfies Partial<Record<AgentWorkState, { group: RosterState; lead: number }>>

/** 진행 중 작업 행 — 상태가 WORK 의 키(진행 중으로 치는 상태)로 좁혀져 WORK 조회에 캐스트가 필요 없다. */
type ActiveWork = AiAgentWork & { state: keyof typeof WORK }

/** 타입 가드 — 거르는 기준과 타입 좁힘이 같은 표(WORK)를 읽으므로 둘이 어긋나지 않는다. */
const isActiveWork = (w: AiAgentWork): w is ActiveWork => w.state in WORK

/** 서버 시각(ISO) → ms. 소수 초 자릿수가 달라 문자열 비교는 시간 순서와 어긋난다(「…03Z」 > 「…03.120Z」). */
const ms = (iso: string) => Date.parse(iso)

/** AI 한 명의 판정 결과 — 화면이 읽는 값 전부. */
export interface RosterRow {
  agent: AiAgentStatus
  state: RosterState
  /** 그 상태로 있게 된 시각 — 모르면 null. */
  since: string | null
  /** 대표 작업 — WORK.lead 가 가장 앞선 행 중 그 상태로 가장 오래 있은 행. 없으면 null. */
  lead: AiAgentWork | null
  /** 진행 중인 작업(검토 필요 제외). */
  active: AiAgentWork[]
  /** 막힌 행 수 — active 중 차단됨 묶음(BLOCKED·AUTH_REQUIRED). 작업 중이라 대표가 작업 중이어도 막힌 행이 있음을 보이는 데 쓴다. */
  blocked: number
  /** 검토를 기다리는 행 수 — AI 는 끝냈고 사람이 볼 차례. */
  reviews: number
  /** 마지막으로 보고한 작업 — 열린 행 중 보고가 가장 최근. 없으면 null. */
  latest: AiAgentWork | null
}

/** AI 한 명을 판정한다. 답변 필요는 연결과 무관하게 그대로(사람이 답할 일이 끊김에 가리지 않게), 그 밖에 연결이 끊겼으면(외부 AI 만) 끊김. */
export function toRosterRow(a: AiAgentStatus): RosterRow {
  const active = a.works.filter(isActiveWork)
  const lead = active.reduce<ActiveWork | null>((best, w) => {
    if (!best) return w
    const r = WORK[w.state].lead - WORK[best.state].lead
    return r < 0 || (r === 0 && ms(w.stateChangedAt) < ms(best.stateChangedAt)) ? w : best
  }, null)
  const group = lead ? WORK[lead.state].group : 'idle'
  const state = group !== 'needs' && a.connected === false ? 'offline' : group
  const since = state === 'offline' ? a.disconnectedAt : state === 'idle' ? a.lastEndedAt : (lead?.stateChangedAt ?? null)
  const latest = a.works.reduce<AiAgentWork | null>((l, w) => (!l || ms(w.updatedAt) > ms(l.updatedAt) ? w : l), null)
  const blocked = active.filter((w) => WORK[w.state].group === 'blocked').length
  return { agent: a, state, since, lead, active, blocked, reviews: a.works.filter((w) => w.state === 'REVIEW').length, latest }
}

/** 판정 + 정렬 — 급한 상태 먼저, 같은 상태면 그 상태로 오래 있은 AI 먼저(시각 모름은 뒤), 마지막은 이름. */
export function rosterRows(agents: AiAgentStatus[]): RosterRow[] {
  return agents.map(toRosterRow).sort((x, y) => {
    const r = RANK[x.state] - RANK[y.state]
    if (r) return r
    if (x.since !== y.since) {
      if (!x.since) return 1
      if (!y.since) return -1
      return ms(x.since) - ms(y.since)
    }
    return x.agent.agent.name.localeCompare(y.agent.agent.name, 'ko')
  })
}

/** 경과 시간 — 「방금」「38분」「2시간 4분」「3일」. 상대 시각(…전)이 아니라 「n째」 앞에 붙는 길이다. */
export function elapsedLabel(since: string, now: number = Date.now()): string {
  const m = Math.max(0, Math.floor((now - ms(since)) / 60000))
  if (m < 1) return '방금'
  if (m < 60) return `${m}분`
  const h = Math.floor(m / 60)
  if (h < 24) return m % 60 ? `${h}시간 ${m % 60}분` : `${h}시간`
  return `${Math.floor(h / 24)}일`
}

/** 상태 줄 아래 한 줄 — 「38분째」, 끊김은 「47분째 신호 없음」(방금이면 「방금 끊김」), 시각을 모르면 null. */
export function sinceLine(row: RosterRow, now: number = Date.now()): string | null {
  if (!row.since) return null
  const len = elapsedLabel(row.since, now)
  const offline = row.state === 'offline'
  if (len === '방금') return offline ? '방금 끊김' : '방금'
  return offline ? `${len}째 신호 없음` : `${len}째`
}

/** 상태별 AI 수 — 위쪽 칩 건수. all 은 목록 전체. */
export function rosterCounts(rows: RosterRow[]): Record<RosterState | 'all', number> {
  const c = Object.fromEntries(ROSTER_STATES.map((s) => [s, 0])) as Record<RosterState, number>
  for (const r of rows) c[r.state]++
  return { all: rows.length, ...c }
}

/** URL 값 → 대표 상태 필터(모르는 값은 무시). */
export function parseRosterState(v: string | null): RosterState | null {
  return v && (ROSTER_STATES as string[]).includes(v) ? (v as RosterState) : null
}
