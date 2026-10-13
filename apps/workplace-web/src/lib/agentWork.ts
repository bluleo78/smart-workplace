// AI 작업 진행(WP-377) 순수 로직 — 라벨·정렬·대표 작업·진행률 계산. 컴포넌트는 이 모듈만 호출한다(vitest 로 검증 가능).
import type { AgentWorkState, AgentWorkView, IssueResponse } from '../types/issue'

/** 사용자 관점 라벨 — "내가 할 일"이 드러나게(답변 필요·검토 필요), 메일의 "회신 필요"와 같은 어휘. */
export const AGENT_STATE_LABEL: Record<AgentWorkState | 'NOT_STARTED', string> = {
  WAITING: '답변 필요',
  REVIEW: '검토 필요',
  BLOCKED: '막힘',
  WORKING: '작업 중',
  PAUSED: '일시 중지',
  NOT_STARTED: '시작 전',
}

/** 2시간 넘게 보고가 없을 때(stale) 툴팁. */
export const STALE_TOOLTIP = '2시간 넘게 보고가 없어요'

const TOOL_LABEL: Record<string, string> = { 'claude-code': 'Claude Code', cursor: 'Cursor' }

/** 도구 식별자의 표시 이름 — 모르는 도구는 원문 그대로. */
export function agentToolLabel(tool: string): string {
  return TOOL_LABEL[tool] ?? tool
}

/** 이슈의 대표 작업 — 서버가 급한 순(상태 순위 → 최근 보고)으로 내려주므로 첫 건. 없으면 null. */
export function primaryWork(list?: AgentWorkView[]): AgentWorkView | null {
  return list?.[0] ?? null
}

/** 이슈 상세 질문 카드에 올릴 작업 — AI 구성원(AGENT)이 답변을 기다리는 첫 건. 사람의 답변 필요는 터미널에서 답하므로 제외. */
export function questionWork(list?: AgentWorkView[]): AgentWorkView | null {
  return list?.find((w) => w.state === 'WAITING' && w.worker.kind === 'AGENT') ?? null
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
