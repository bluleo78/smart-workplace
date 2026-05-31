// 7b: 홈 컴포즈 라우트 — workplace-api 가 동기 호출.
// 본문에 비서(assistant) 설정(assistantAgentId/model/thinkingDepth/maxTurns/timeoutMs)을 포함한다(#50).
// 미설정(비서 없음)은 api 가 소유하므로 여기서 503 분기는 두지 않는다.
import { Router } from 'express';
import { z } from 'zod';

import { type RunAgentDeps } from '../agent/run-agent.js';
import { runHomeCompose } from '../agent/run-home-compose.js';

export const composeSchema = z.object({
  query: z.string().min(1),
  recentContext: z
    .array(z.object({ role: z.string(), content: z.string() }))
    .optional(),
  assistantAgentId: z.number().int().positive(),
  model: z.string().min(1),
  thinkingDepth: z.enum(['NONE', 'NORMAL', 'DEEP']),
  maxTurns: z.number().int().positive(),
  timeoutMs: z.number().int().positive(),
});

export function createHomeRouter(deps: RunAgentDeps): Router {
  const router = Router();

  router.post('/home/compose', async (req, res) => {
    const parsed = composeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    try {
      // parsed.data 가 ComposeInput 과 동일 형태 — 그대로 전달.
      const out = await runHomeCompose(parsed.data, deps);
      res.status(200).json(out);
    } catch (e) {
      console.error('[home-compose] 실패:', e instanceof Error ? e.message : String(e));
      res.status(502).json({ error: 'compose_failed' });
    }
  });

  return router;
}
