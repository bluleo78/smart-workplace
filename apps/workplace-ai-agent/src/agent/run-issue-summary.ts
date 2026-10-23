import { z } from 'zod'
import type { RunAgentDeps } from './run-agent.js'
import { runText } from './run-mail-ai.js'
import { ISSUE_PROGRESS_SUMMARY_PROMPT } from './issue-system-prompt.js'
import { statusDisplay } from './status-display.js'

// 이슈 현황 요약 입력 스키마 — 제목·본문·상태·우선순위·마감·코멘트·변경이력·채팅 + 에이전트 실행 설정.
export interface IssueSummaryInput {
  title: string
  // 이슈 본문(description). 없으면 빈 문자열 또는 null(본문 없는 이슈).
  body?: string | null
  status: string
  // WP-869: 프로젝트 상태 이름(status 는 범주). 구 API 는 보내지 않는다.
  statusName?: string | null
  priority: string
  dueDate: string | null
  comments: { authorName: string; body: string; createdAt: string }[]
  // WP-885: 입력 예산 때문에 API 가 보내지 않은 오래된 코멘트 수(0/생략 = 없음).
  omittedCommentCount?: number
  history: { actorName: string; eventType: string; fromValue: string | null; toValue: string | null; createdAt: string }[]
  // 이슈 채팅(사람↔AI 대화) 발췌 — 시간 오름차순. kind 로 USER/AGENT 구분.
  chat?: { author: string; kind: string; body: string; createdAt?: string | null }[]
  // WP-885: 채팅 입력 예산 때문에 API 가 보내지 않은 오래된 채팅 메시지 수(0/생략 = 없음).
  omittedChatCount?: number
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

  lines.push(`상태: ${statusDisplay(input.status, input.statusName)} / 우선순위: ${input.priority} / 마감: ${input.dueDate ?? '없음'}`)
  lines.push('--- 코멘트 ---')
  // WP-885: 오래된 코멘트가 입력 예산 때문에 빠졌으면 모델이 "처음부터 코멘트가 이것뿐"이라 오해하지 않게 알린다.
  if (input.omittedCommentCount && input.omittedCommentCount > 0) {
    lines.push(`(더 오래된 코멘트 ${input.omittedCommentCount}건은 분량 때문에 생략됨 — 아래는 최근 코멘트만)`)
  }
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
    // WP-885: 오래된 채팅이 입력 예산 때문에 빠졌으면 코멘트와 같이 모델에 알린다.
    if (input.omittedChatCount && input.omittedChatCount > 0) {
      lines.push(`(더 오래된 채팅 ${input.omittedChatCount}건은 분량 때문에 생략됨 — 아래는 최근 채팅만)`)
    }
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
