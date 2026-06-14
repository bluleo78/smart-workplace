// Wiki S3(A3): 인에디터 /ai 컴포즈 SSE 라우트 — workplace-api 가 SSE 패스스루로 소비한다.
// 본문에 비서 설정(assistantAgentId/model/thinkingDepth/maxTurns/timeoutMs) + 컴포즈 컨텍스트를 포함한다.
// 토큰은 event: delta 로 점진 발행, 종료는 event: done, 실패는 event: error.
// 연결 종료(req close) 시 AbortController 로 하위 CLI child 를 kill 해 자원 누수를 막는다.
import { Router } from 'express';
import { z } from 'zod';

import { type RunAgentDeps } from '../agent/run-agent.js';
import { runWikiCompose } from '../agent/run-wiki-compose.js';

export const wikiComposeSchema = z.object({
  action: z.enum(['summarize', 'draft', 'continue']),
  pageTitle: z.string(),
  pageBody: z.string(),
  selection: z.string().optional(),
  prompt: z.string().optional(),
  // 비서 설정(home/compose 와 동일 계약).
  assistantAgentId: z.number().int().positive(),
  model: z.string().min(1),
  thinkingDepth: z.enum(['NONE', 'NORMAL', 'DEEP']),
  maxTurns: z.number().int().positive(),
  timeoutMs: z.number().int().positive(),
});

export function createWikiRouter(deps: RunAgentDeps): Router {
  const router = Router();

  router.post('/wiki/compose', async (req, res) => {
    const parsed = wikiComposeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }

    // SSE 헤더 — flushHeaders 로 즉시 내보내 프록시/클라 버퍼링을 막는다.
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // 연결 종료 감지 — abort 시 (1) 추가 write 중단, (2) 하위 CLI child kill.
    // 단, 정상 종료(res.end 후)로 인한 close 는 무시한다(이미 끝난 응답을 abort 로 오인 금지).
    let aborted = false;
    const ac = new AbortController();
    res.on('close', () => {
      if (res.writableEnded) return; // 정상 완료 후 close — 무시
      aborted = true;
      ac.abort();
    });

    try {
      await runWikiCompose(
        parsed.data,
        deps,
        (text) => {
          if (aborted) return;
          res.write(`event: delta\ndata: ${JSON.stringify({ text })}\n\n`);
        },
        ac.signal,
      );
      if (!aborted) {
        res.write(`event: done\ndata: {}\n\n`);
        res.end();
      }
    } catch (e) {
      console.error('[wiki-compose] 실패:', e instanceof Error ? e.message : String(e));
      // 연결이 살아 있을 때만 error 발행(닫힌 소켓 write → EPIPE 방지).
      if (!aborted) {
        res.write(`event: error\ndata: ${JSON.stringify({ message: 'compose_failed' })}\n\n`);
        res.end();
      }
    }
  });

  return router;
}
