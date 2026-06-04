// 7d: 메일 AI 라우트 — workplace-api 가 동기 호출. 도구 없이 텍스트 in/out.
// assistant 설정(assistantAgentId/model/maxTurns/timeoutMs)은 본문으로 온다. 미설정 503 분기는 api 소유.
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';

import { type RunAgentDeps } from '../agent/run-agent.js';
import { runMailClassify, runMailReplyDraft, runMailSummarize } from '../agent/run-mail-ai.js';

// 공통 assistant 설정 필드 — 모든 엔드포인트에서 공유.
const baseConfig = {
  assistantAgentId: z.number().int().positive(),
  model: z.string().min(1),
  maxTurns: z.number().int().positive(),
  timeoutMs: z.number().int().positive(),
};

export const classifySchema = z.object({ subject: z.string(), from: z.string(), snippet: z.string(), ...baseConfig });
export const summarizeSchema = z.object({ subject: z.string(), from: z.string(), body: z.string(), ...baseConfig });
export const replyDraftSchema = z.object({
  thread: z.array(z.object({ from: z.string(), date: z.string(), body: z.string() })),
  replyingAs: z.string(),
  ...baseConfig,
});

// 공통 핸들러 팩토리 — zod 검증 → 러너 호출 → 400/200/502 응답.
function handler<T>(
  schema: z.ZodType<T>,
  run: (input: T, deps: RunAgentDeps) => Promise<unknown>,
  deps: RunAgentDeps,
  tag: string,
) {
  return async (req: Request, res: Response): Promise<void> => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    try {
      res.status(200).json(await run(parsed.data, deps));
    } catch (e) {
      console.error(`[${tag}] 실패:`, e instanceof Error ? e.message : String(e));
      res.status(502).json({ error: `${tag}_failed` });
    }
  };
}

export function createMailRouter(deps: RunAgentDeps): Router {
  const router = Router();

  // 메일 분류: category + needsReply 반환.
  router.post('/mail/classify', handler(classifySchema, runMailClassify, deps, 'mail-classify'));
  // 메일 요약: summary 텍스트 반환.
  router.post('/mail/summarize', handler(summarizeSchema, runMailSummarize, deps, 'mail-summarize'));
  // 답장 초안 생성: draft 텍스트 반환.
  router.post('/mail/reply-draft', handler(replyDraftSchema, runMailReplyDraft, deps, 'mail-reply-draft'));

  return router;
}
