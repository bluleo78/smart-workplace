// 드라이브 AI 라우트 — workplace-api 가 파일 추출 텍스트를 전달하면 요약 반환.
// handler 팩토리는 mail.ts 에서 export 해 재사용(중복 없음).
import { Router } from 'express';
import { z } from 'zod';

import { type RunAgentDeps } from '../agent/run-agent.js';
import { runDriveSummarize } from '../agent/run-drive-ai.js';
import { handler } from './mail.js';

// 요약 요청 스키마 — 파일 본문·메타 + assistant 설정.
const summarizeSchema = z.object({
  text: z.string(),
  fileName: z.string(),
  mime: z.string(),
  assistantAgentId: z.number().int().positive(),
  model: z.string().min(1),
  maxTurns: z.number().int().positive(),
  timeoutMs: z.number().int().positive(),
});

export function createDriveRouter(deps: RunAgentDeps): Router {
  const router = Router();
  // 파일 본문 요약: text+fileName+mime → {summary}.
  router.post('/drive/summarize', handler(summarizeSchema, runDriveSummarize, deps, 'drive-summarize'));
  return router;
}
