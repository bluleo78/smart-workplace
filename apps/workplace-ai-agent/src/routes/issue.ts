// 이슈 AI 라우트 — workplace-api 가 동기 호출. 현황 요약 및 분류 생성.
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import type { RunAgentDeps } from '../agent/run-agent.js'
import { runIssueProgressSummary } from '../agent/run-issue-summary.js'
import { issueClassifyInputSchema, runIssueClassify } from '../agent/run-issue-classify-ai.js'
import { runWorkProfile, workProfileInputSchema } from '../agent/run-work-profile.js'
import { projectStatusInputSchema, runProjectStatus } from '../agent/run-project-status.js'
import { projectReportInputSchema, runProjectReport } from '../agent/run-project-report.js'

// 요청 바디 검증 스키마.
const summarySchema = z.object({
  title: z.string(),
  // 이슈 본문(description). 없으면 빈 문자열. null(본문 없는 이슈)도 허용 — 거부(400) 방지.
  body: z.string().nullable().optional().default(''),
  status: z.string(),
  // WP-869: 프로젝트 상태 이름(status 는 범주). 구 API 는 보내지 않아 nullish.
  statusName: z.string().nullish(),
  priority: z.string(),
  dueDate: z.string().nullable(),
  comments: z.array(z.object({ authorName: z.string(), body: z.string(), createdAt: z.string() })),
  // WP-885: API 입력 예산 때문에 통째로 빠진 오래된 코멘트 수. 구버전 API 는 보내지 않으므로 생략 가능.
  omittedCommentCount: z.number().int().nonnegative().optional().default(0),
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
  // WP-885: API 채팅 입력 예산 때문에 통째로 빠진 오래된 채팅 메시지 수. 구버전 API 는 보내지 않으므로 생략 가능.
  omittedChatCount: z.number().int().nonnegative().optional().default(0),
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

  // 이슈 분류 — 제목+본문+라벨 목록 → 유형·우선순위·라벨·이유 반환.
  router.post('/issue/classify', async (req: Request, res: Response): Promise<void> => {
    const parsed = issueClassifyInputSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues })
      return
    }
    try {
      res.status(200).json(await runIssueClassify(parsed.data, deps))
    } catch (e) {
      console.error('[issue-classify] 실패:', e instanceof Error ? e.message : String(e))
      res.status(502).json({ error: 'issue_classify_failed' })
    }
  })

  // 업무 프로파일(WP-1485) — 끝낸 이슈 목록 → 요약·역량 태그·이슈별 분류. 건수는 API 가 센다.
  router.post('/issue/work-profile', async (req: Request, res: Response): Promise<void> => {
    const parsed = workProfileInputSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues })
      return
    }
    try {
      res.status(200).json(await runWorkProfile(parsed.data, deps))
    } catch (e) {
      console.error('[issue-work-profile] 실패:', e instanceof Error ? e.message : String(e))
      res.status(502).json({ error: 'work_profile_failed' })
    }
  })

  // 프로젝트 상태 요약(WP-1479) — API 가 계산한 개요 숫자·배지 → 2~3문장 요약 글. 숫자·배지는 API 가 정한다.
  router.post('/issue/project-status', async (req: Request, res: Response): Promise<void> => {
    const parsed = projectStatusInputSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues })
      return
    }
    try {
      res.status(200).json(await runProjectStatus(parsed.data, deps))
    } catch (e) {
      console.error('[issue-project-status] 실패:', e instanceof Error ? e.message : String(e))
      res.status(502).json({ error: 'project_status_failed' })
    }
  })

  // 프로젝트 리포트 본문(WP-1483) — 템플릿 샘플·계산값·이슈 목록 → 리포트 마크다운. 표·배지·링크는 API 가 후처리로 바로잡는다.
  router.post('/issue/project-report', async (req: Request, res: Response): Promise<void> => {
    const parsed = projectReportInputSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues })
      return
    }
    try {
      res.status(200).json(await runProjectReport(parsed.data, deps))
    } catch (e) {
      console.error('[issue-project-report] 실패:', e instanceof Error ? e.message : String(e))
      res.status(502).json({ error: 'project_report_failed' })
    }
  })

  return router
}
