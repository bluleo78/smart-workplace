// 메시징 AI 라우트 — workplace-api 가 동기 호출. routes/mail.ts 미러.
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';

import { readOnlyMemoriesField } from '../agent/memory-block.js';
import { type RunAgentDeps } from '../agent/run-agent.js';
import { runMessagingClassify, messagingClassifyInput } from '../agent/run-messaging-ai.js';
import { runMessagingCatchup, messagingCatchupInput } from '../agent/run-messaging-catchup.js';

// 공통 assistant 설정 필드 — mail.ts 의 baseConfig 와 동일.
const baseConfig = {
  assistantAgentId: z.number().int().positive(),
  model: z.string().min(1),
  maxTurns: z.number().int().positive(),
  timeoutMs: z.number().int().positive(),
};

export const classifySchema = messagingClassifyInput.extend(baseConfig);
// WP-381: catchup 은 요청자의 공통 + 메신저 메모리(읽기 전용)를 받는다. 구 API 는 생략 → 빈 배열.
export const catchupSchema = messagingCatchupInput.extend({ ...baseConfig, memories: readOnlyMemoriesField });

// 공통 핸들러 팩토리 — zod 검증 → 러너 호출 → 400/200/502 응답. mail.ts 미러.
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

/** 메시징 AI 라우트 팩토리 — POST /messaging/classify. createMailRouter 미러. */
export function createMessagingRouter(deps: RunAgentDeps): Router {
  const router = Router();

  // 메시징 분류: 안읽은 채널 메시지 배치 → 암묵적 관련 멤버 목록 반환.
  router.post('/messaging/classify', handler(classifySchema, runMessagingClassify, deps, 'messaging-classify'));

  // 메시징 캐치업: 안읽은 메시지 → 구조화 요약 (결정/오간이야기).
  router.post('/messaging/catchup', handler(catchupSchema, runMessagingCatchup, deps, 'messaging-catchup'));

  return router;
}
