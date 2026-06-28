// 이슈 AI 라우트 — workplace-api 가 동기 호출. 코멘트+이력으로 현황 요약 생성.
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import type { RunAgentDeps } from '../agent/run-agent.js'
import { runIssueProgressSummary } from '../agent/run-issue-summary.js'

// 요청 바디 검증 스키마.
const summarySchema = z.object({
  title: z.string(),
  // 이슈 본문(description). 없으면 빈 문자열.
  body: z.string().optional().default(''),
  status: z.string(),
  priority: z.string(),
  dueDate: z.string().nullable(),
  comments: z.array(z.object({ authorName: z.string(), body: z.string(), createdAt: z.string() })),
  history: z.array(z.object({
    actorName: z.string(),
    eventType: z.string(),
    fromValue: z.string().nullable(),
    toValue: z.string().nullable(),
    createdAt: z.string(),
  })),
  // 이슈 채팅(사람↔AI 대화) 발췌 — 시간 오름차순. kind 로 USER/AGENT 구분. createdAt 은 nullable.
  chat: z.array(z.object({
    author: z.string(),
    kind: z.string(),
    body: z.string(),
    createdAt: z.string().nullable().optional(),
  })).optional().default([]),
  assistantAgentId: z.number(),
  model: z.string(),
  maxTurns: z.number(),
  timeoutMs: z.number(),
})

// mail.ts handler 팩토리 패턴 미러 — zod 검증 → 러너 호출 → 400/200/502 응답.
export function createIssueRouter(deps: RunAgentDeps): Router {
  const router = Router()
  router.post('/issue/progress-summary', async (req: Request, res: Response): Promise<void> => {
    const parsed = summarySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues })
      return
    }
    try {
      res.status(200).json(await runIssueProgressSummary(parsed.data, deps))
    } catch (e) {
      console.error('[issue-progress-summary] 실패:', e instanceof Error ? e.message : String(e))
      res.status(502).json({ error: 'issue_progress_summary_failed' })
    }
  })
  return router
}
