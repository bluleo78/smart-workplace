// AI 작업 진행(WP-377) 순수 로직 — 라벨·정렬·대표 작업·진행률 계산. 컴포넌트는 이 모듈만 호출한다(vitest 로 검증 가능).
import type { AgentWorkState, AgentWorkView, IssueResponse } from '../types/issue'
import { ownLookup } from './ownLookup'

/** 사용자 관점 라벨 — "내가 할 일"이 드러나게(답변 필요·검토 필요), 메일의 "회신 필요"와 같은 어휘. */
export const AGENT_STATE_LABEL: Record<AgentWorkState | 'NOT_STARTED', string> = {
  INPUT_REQUIRED: '답변 필요',
  AUTH_REQUIRED: '인증 필요',
  REVIEW: '검토 필요',
  BLOCKED: '막힘',
  WORKING: '작업 중',
  PAUSED: '일시 중지',
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

const TOOL_LABEL: Record<string, string> = { 'claude-code': 'Claude Code', cursor: 'Cursor' }

/** 도구 식별자의 표시 이름 — 모르는 도구(프로토타입 키 포함, WP-416)는 원문 그대로. */
export function agentToolLabel(tool: string): string {
  return ownLookup(TOOL_LABEL, tool) ?? tool
}

/** 이슈의 대표 작업 — 서버가 급한 순(상태 순위 → 최근 보고)으로 내려주므로 첫 건. 없으면 null. */
export function primaryWork(list?: AgentWorkView[]): AgentWorkView | null {
  return list?.[0] ?? null
}

/** 이슈 상세 질문 카드에 올릴 작업 — AI 구성원(AGENT)이 답변을 기다리는 첫 건. 사람의 답변 필요는 터미널에서 답하므로 제외. */
export function questionWork(list?: AgentWorkView[]): AgentWorkView | null {
  return list?.find((w) => w.state === 'INPUT_REQUIRED' && w.worker.kind === 'AGENT') ?? null
}

/** 답변을 기다리는(INPUT_REQUIRED) AI 구성원의 사용자 id, 오름차순 — questionWork 와 같은 판정. 질문 글의 「답변됨」 여부 계산에 쓴다. */
export function waitingAgentIds(list?: AgentWorkView[]): number[] {
  return (list ?? [])
    .filter((w) => w.state === 'INPUT_REQUIRED' && w.worker.kind === 'AGENT')
    .map((w) => w.worker.id)
    .sort((a, b) => a - b)
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
