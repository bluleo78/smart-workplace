// AI 작업 진행(WP-377) 순수 로직 — 라벨·정렬·대표 작업·진행률 계산. 컴포넌트는 이 모듈만 호출한다(vitest 로 검증 가능).
import type { AgentWorkState, AgentWorkView, IssueResponse } from '../types/issue'
import { kstParts, kstWeekday, parseUtcDate, sameDay } from './formatters'
import { ownLookup } from './ownLookup'

/** 사용자 관점 라벨 — "내가 할 일"이 드러나게(답변 필요·검토 필요), 메일의 "회신 필요"와 같은 어휘. */
export const AGENT_STATE_LABEL: Record<AgentWorkState | 'NOT_STARTED', string> = {
  INPUT_REQUIRED: '답변 필요',
  AUTH_REQUIRED: '인증 필요',
  REVIEW: '검토 필요',
  BLOCKED: '막힘',
  WORKING: '작업 중',
  PAUSED: '일시 중지',
  // 다른 사람·AI 의 차례를 기다리는 작업(WP-1024 — PR 리뷰·수정, 다른 AI 의 답 등, 무엇인지는 note). 사람이 할 일이 아니라 흐린 윤곽.
  // 「답변 필요」(사람이 결정)와 섞이지 않게 「답」을 넣지 않는다.
  WAITING: '대기 중',
  // 양보 후 예정 시각 뒤 이어서 하는 작업(WP-450) — 사람이 할 일이 없어 톤은 흐린 윤곽(일시 중지와 같음).
  SCHEDULED: '다음 회차 대기',
  SUBMITTED: '시작 전',
  NOT_STARTED: '시작 전',
  // 종료 상태 — AI 위임 작업 「완료」 보기의 행 배지(WP-396). 반려 = 작업자가 맡기를 거절.
  COMPLETED: '완료',
  FAILED: '실패',
  CANCELED: '취소',
  REJECTED: '반려',
}

/** 종료 상태 — 서버 AgentWorkState.TERMINAL 과 같은 넷. AI 위임 작업 「완료」 칩이 이 묶음으로 요청한다(WP-396). */
export const TERMINAL_AGENT_STATES: AgentWorkState[] = ['COMPLETED', 'FAILED', 'CANCELED', 'REJECTED']

/** 배지 톤 — action/info 는 AI 판단신호 배지, 나머지는 일반 Badge variant(muted = 흐린 윤곽). */
export type AgentStateTone = 'action' | 'info' | 'warning' | 'success' | 'destructive' | 'muted'

/**
 * 상태별 배지 톤 — 사람이 할 일(답변·인증·검토)은 action, 작업 중은 info, 막힘은 경고.
 * 종료 결과는 실제 결과가 구분되게: 완료 성공·실패 위험, 취소·반려는 중립(일시 중지·시작 전과 같은 흐린 윤곽).
 */
export function agentStateTone(state: AgentWorkState | 'NOT_STARTED'): AgentStateTone {
  switch (state) {
    case 'INPUT_REQUIRED':
    case 'AUTH_REQUIRED':
    case 'REVIEW':
      return 'action'
    case 'WORKING':
      return 'info'
    case 'BLOCKED':
      return 'warning'
    case 'COMPLETED':
      return 'success'
    case 'FAILED':
      return 'destructive'
    default:
      return 'muted'
  }
}

/** 2시간 넘게 보고가 없을 때(stale) 툴팁. */
export const STALE_TOOLTIP = '2시간 넘게 보고가 없어요'

/** 다음 회차 예정 시각이 2시간 넘게 지났는데 시작하지 않았을 때(overdue) 툴팁. */
export const OVERDUE_TOOLTIP = '예정 시각이 2시간 넘게 지났어요'

/** 다음 회차 시작 예정 라벨(WP-450). kind: none=시각 없음/해석 불가, due=이미 지남, at=아직 남음(text 가 「… 이후」). absolute 는 KST 「YYYY-MM-DD HH:mm」(시각이 있을 때). */
export type NextRunLabel = { kind: 'none' | 'due' | 'at'; text: string; absolute: string | null }

/**
 * SCHEDULED 작업이 언제 이어지는지 사람 말로. 날짜 경계는 KST 기준(다른 KST 포매터와 같다), 시각은 24시간제 zero-pad.
 * 「이후」는 정확한 시작이 아니라 그 시각부터 가능하다는 뜻.
 * - 없음 → 「다른 작업 뒤 이어서」 · 이미 지남 → 「곧 시작」
 * - 오늘 → 「오늘 15:00 이후」 · 내일 → 「내일 09:00 이후」 · 올해 → 「10/21(수) 09:00 이후」 · 다른 해 → 「2027/1/5(화) 09:00 이후」
 */
export function nextRunLabel(nextRunAt: string | null | undefined, now: Date = new Date()): NextRunLabel {
  const none: NextRunLabel = { kind: 'none', text: '다른 작업 뒤 이어서', absolute: null }
  if (!nextRunAt) return none
  const at = parseUtcDate(nextRunAt)
  if (Number.isNaN(at.getTime())) return none
  const t = kstParts(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  const clock = `${pad(t.h)}:${pad(t.min)}`
  const absolute = `${t.y}-${pad(t.m)}-${pad(t.d)} ${clock}`
  if (at.getTime() <= now.getTime()) return { kind: 'due', text: '곧 시작', absolute }
  const n = kstParts(now)
  if (sameDay(t, n)) return { kind: 'at', text: `오늘 ${clock} 이후`, absolute }
  // Asia/Seoul 은 DST 가 없어 달력상 다음 날 = 내일.
  const next = new Date(Date.UTC(n.y, n.m - 1, n.d + 1))
  if (sameDay(t, { ...n, y: next.getUTCFullYear(), m: next.getUTCMonth() + 1, d: next.getUTCDate() })) {
    return { kind: 'at', text: `내일 ${clock} 이후`, absolute }
  }
  const year = t.y === n.y ? '' : `${t.y}/`
  return { kind: 'at', text: `${year}${t.m}/${t.d}(${kstWeekday(t)}) ${clock} 이후`, absolute }
}

const TOOL_LABEL: Record<string, string> = { 'claude-code': 'Claude Code', cursor: 'Cursor' }

/** 도구 식별자의 표시 이름 — 모르는 도구(프로토타입 키 포함, WP-416)는 원문 그대로. */
export function agentToolLabel(tool: string): string {
  return ownLookup(TOOL_LABEL, tool) ?? tool
}

/** 이슈 상세 + 챗 드로워가 열린 채 진입하는 딥링크(`?chat=1`, useIssueChatDrawerParam 과 같은 규칙) — notifTarget 의 이슈 챗 알림과 같은 경로 조합. */
export function issueChatPath(projectKey: string, issueNumber: number): string {
  return `/projects/${projectKey}/issues/${issueNumber}?chat=1`
}

/** 이슈의 대표 작업 — 서버가 급한 순(상태 순위 → 최근 보고)으로 내려주므로 첫 건. 없으면 null. */
export function primaryWork(list?: AgentWorkView[]): AgentWorkView | null {
  return list?.[0] ?? null
}

/** AI 구성원(AGENT)이 이슈 채팅에서 답을 기다리는 작업인지 — 이슈 상세 AI 진행 칸의 「답변 필요」 채팅 링크·질문 전체 표시 대상(WP-1079).
 *  사람의 답변 필요는 터미널에서 답하므로 제외. */
export function isAgentQuestion(w: Pick<AgentWorkView, 'state' | 'worker'>): boolean {
  return w.state === 'INPUT_REQUIRED' && w.worker.kind === 'AGENT'
}

/** 질문 글 판정 재료(WP-391) — 그 AI 가 답변을 기다리는지(isAgentQuestion 과 같은 판정)와 작업의 마지막 갱신 시각(epoch ms). */
export interface AgentQuestionWork {
  waiting: boolean
  updatedAt: number
}

/** AI 구성원(AGENT) 사용자 id → 질문 판정 재료. 사람 작업은 빼고, 이슈·작업자당 진행 중 작업은 하나라 id 가 겹치지 않는다. 질문 글의 「답변됨」 계산에 쓴다. */
export function agentQuestionWorks(list?: AgentWorkView[]): Map<number, AgentQuestionWork> {
  return new Map(
    (list ?? [])
      .filter((w) => w.worker.kind === 'AGENT')
      .map((w) => [w.worker.id, { waiting: isAgentQuestion(w), updatedAt: Date.parse(w.updatedAt) }]),
  )
}

/** 진행률 — 막대는 progress 우선(없으면 단계 비율), 글자는 단계가 있으면 단계(3/5) 아니면 퍼센트. 둘 다 없으면 null. */
export function progressView(
  w: Pick<AgentWorkView, 'progress' | 'stepsDone' | 'stepsTotal'>,
): { pct: number; text: string } | null {
  const pct = w.progress ?? (w.stepsTotal ? Math.round(((w.stepsDone ?? 0) / w.stepsTotal) * 100) : null)
  if (pct == null) return null
  return { pct, text: w.stepsTotal ? `${w.stepsDone ?? 0}/${w.stepsTotal}` : `${pct}%` }
}

/** 목록·상세에 보일 AI 진행 상태 — 대표 작업 상태, 작업이 없고 AI 담당 + TODO 면 시작 전, 그 외 null(배지 없음). */
export function displayState(
  issue: Pick<IssueResponse, 'assignees' | 'status' | 'agentWork'>,
): AgentWorkState | 'NOT_STARTED' | null {
  const p = primaryWork(issue.agentWork)
  if (p) return p.state
  if (issue.status === 'TODO' && issue.assignees.some((a) => a.kind === 'AGENT')) return 'NOT_STARTED'
  return null
}
