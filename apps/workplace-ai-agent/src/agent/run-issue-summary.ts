import { z } from 'zod'
import type { RunAgentDeps } from './run-agent.js'
import { runText } from './run-mail-ai.js'
import { ISSUE_PROGRESS_SUMMARY_PROMPT } from './issue-system-prompt.js'

// 이슈 현황 요약 입력 스키마 — 제목·상태·우선순위·마감·코멘트·변경이력 + 에이전트 실행 설정.
export interface IssueSummaryInput {
  title: string
  status: string
  priority: string
  dueDate: string | null
  comments: { authorName: string; body: string; createdAt: string }[]
  history: { actorName: string; eventType: string; fromValue: string | null; toValue: string | null; createdAt: string }[]
  assistantAgentId: number
  model: string
  maxTurns: number
  timeoutMs: number
}

/** LLM 출력에서 {summary,nextAction} 추출. catchup 파서와 동일한 그리디+zod+폴백 패턴. */
export function parseIssueSummaryJson(text: string): { summary: string; nextAction: string } {
  const stripped = text.replace(/```(?:json)?\n?/g, '').replace(/```/g, '')
  const start = stripped.indexOf('{')
  const end = stripped.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return { summary: '', nextAction: '' }
  const schema = z.object({ summary: z.string(), nextAction: z.string().optional() })
  try {
    const parsed = schema.safeParse(JSON.parse(stripped.slice(start, end + 1)))
    if (!parsed.success) return { summary: '', nextAction: '' }
    return { summary: parsed.data.summary, nextAction: parsed.data.nextAction ?? '' }
  } catch {
    return { summary: '', nextAction: '' }
  }
}

/** 이슈 컨텍스트를 LLM 에 보내 현황 요약을 생성한다. */
export async function runIssueProgressSummary(
  input: IssueSummaryInput,
  deps: RunAgentDeps,
): Promise<{ summary: string; nextAction: string }> {
  const lines: string[] = []
  lines.push(`제목: ${input.title}`)
  lines.push(`상태: ${input.status} / 우선순위: ${input.priority} / 마감: ${input.dueDate ?? '없음'}`)
  lines.push('--- 변경 이력 ---')
  for (const h of input.history) {
    lines.push(`[${h.createdAt}] ${h.actorName}: ${h.eventType} ${h.fromValue ?? ''}→${h.toValue ?? ''}`)
  }
  lines.push('--- 코멘트 ---')
  for (const c of input.comments) {
    lines.push(`[${c.createdAt}] ${c.authorName}: ${c.body}`)
  }
  const text = await runText(ISSUE_PROGRESS_SUMMARY_PROMPT, lines.join('\n'), input, deps, 'issue-progress-summary')
  return parseIssueSummaryJson(text)
}
