import { z } from 'zod'
import type { RunAgentDeps } from './run-agent.js'
import { runText } from './run-mail-ai.js'
import { ISSUE_PROGRESS_SUMMARY_PROMPT } from './issue-system-prompt.js'

// 이슈 현황 요약 입력 스키마 — 제목·본문·상태·우선순위·마감·코멘트·변경이력·채팅 + 에이전트 실행 설정.
export interface IssueSummaryInput {
  title: string
  // 이슈 본문(description). 없으면 빈 문자열.
  body?: string
  status: string
  priority: string
  dueDate: string | null
  comments: { authorName: string; body: string; createdAt: string }[]
  history: { actorName: string; eventType: string; fromValue: string | null; toValue: string | null; createdAt: string }[]
  // 이슈 채팅(사람↔AI 대화) 발췌 — 시간 오름차순. kind 로 USER/AGENT 구분.
  chat?: { author: string; kind: string; body: string; createdAt?: string | null }[]
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

/**
 * 이슈 컨텍스트를 LLM 프롬프트용 텍스트로 조립한다.
 * 순서: 제목 → 본문 → 상태/우선순위/마감 → 코멘트 → 변경이력 → 채팅.
 * 본문·채팅이 없으면 해당 섹션 생략.
 */
export function buildIssueSummaryPrompt(input: IssueSummaryInput): string {
  const lines: string[] = []
  lines.push(`제목: ${input.title}`)

  // 이슈 본문(description) — 있을 때만 섹션 추가.
  const bodySection = input.body?.trim() ? `## 이슈 본문\n${input.body.trim()}` : ''
  if (bodySection) lines.push(bodySection)

  lines.push(`상태: ${input.status} / 우선순위: ${input.priority} / 마감: ${input.dueDate ?? '없음'}`)
  lines.push('--- 코멘트 ---')
  for (const c of input.comments) {
    lines.push(`[${c.createdAt}] ${c.authorName}: ${c.body}`)
  }
  lines.push('--- 변경 이력 ---')
  for (const h of input.history) {
    lines.push(`[${h.createdAt}] ${h.actorName}: ${h.eventType} ${h.fromValue ?? ''}→${h.toValue ?? ''}`)
  }

  // 이슈 채팅(사람↔AI 대화) — 비어 있으면 섹션 생략.
  const chat = input.chat ?? []
  if (chat.length > 0) {
    lines.push('## 이슈 채팅(사람↔AI 대화, 시간순)')
    for (const m of chat) {
      lines.push(`- [${m.kind}] ${m.author}: ${m.body}`)
    }
  }

  return lines.join('\n')
}

/** 이슈 컨텍스트를 LLM 에 보내 현황 요약을 생성한다. */
export async function runIssueProgressSummary(
  input: IssueSummaryInput,
  deps: RunAgentDeps,
): Promise<{ summary: string; nextAction: string }> {
  const prompt = buildIssueSummaryPrompt(input)
  const text = await runText(ISSUE_PROGRESS_SUMMARY_PROMPT, prompt, input, deps, 'issue-progress-summary')
  return parseIssueSummaryJson(text)
}
