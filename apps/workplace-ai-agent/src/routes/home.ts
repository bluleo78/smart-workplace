// 7b: 홈 컴포즈 라우트 — workplace-api 가 동기 호출. {query, recentContext?} → {message, widgets[]}.
import { Router } from 'express';
import { z } from 'zod';

import { type RunAgentDeps } from '../agent/run-agent.js';
import { runHomeCompose, HomeComposerNotConfiguredError } from '../agent/run-home-compose.js';

const composeSchema = z.object({
  query: z.string().min(1),
  recentContext: z
    .array(z.object({ role: z.string(), content: z.string() }))
    .optional(),
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
      const out = await runHomeCompose(
        { query: parsed.data.query, recentContext: parsed.data.recentContext },
        deps,
      );
      res.status(200).json(out);
    } catch (e) {
      if (e instanceof HomeComposerNotConfiguredError) {
        res.status(503).json({ error: 'home_composer_not_configured' });
        return;
      }
      console.error('[home-compose] 실패:', e instanceof Error ? e.message : String(e));
      res.status(502).json({ error: 'compose_failed' });
    }
  });

  return router;
}
