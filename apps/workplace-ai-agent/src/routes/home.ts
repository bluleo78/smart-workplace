// 홈 컴포즈 SSE 라우트 — workplace-api 가 SSE 패스스루로 소비한다.
// 본문에 비서 설정(assistantAgentId/model/thinkingDepth/maxTurns/timeoutMs) + 쿼리를 포함한다(#50).
// 토큰은 event: delta 로 점진 발행, 종료는 event: done {fullText, widgets}, 실패는 event: error.
// 연결 종료(req close) 시 AbortController 로 하위 CLI child 를 kill 해 자원 누수를 막는다.
import { Router } from 'express';
import { z } from 'zod';

import { type RunAgentDeps } from '../agent/run-agent.js';
import { runAiComposeStream } from '../agent/run-ai-compose.js';

export const composeSchema = z.object({
  query: z.string().min(1),
  recentContext: z
    .array(z.object({ role: z.string(), content: z.string() }))
    .optional(),
  assistantAgentId: z.number().int().positive(),
  // #376: 요청 사용자 ID — MCP 도구 컨텍스트를 assistantAgentId 아닌 실제 요청자로 설정하기 위해 전달.
  userId: z.number().int().positive(),
  model: z.string().min(1),
  thinkingDepth: z.enum(['NONE', 'NORMAL', 'DEEP']),
  maxTurns: z.number().int().positive(),
  timeoutMs: z.number().int().positive(),
});

export function createHomeRouter(deps: RunAgentDeps): Router {
  const router = Router();

  router.post('/ai/compose', async (req, res) => {
    const parsed = composeSchema.safeParse(req.body);
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
      const result = await runAiComposeStream(
        parsed.data,
        deps,
        (text) => {
          if (aborted) return;
          res.write(`event: delta\ndata: ${JSON.stringify({ text })}\n\n`);
        },
        ac.signal,
        (label) => {
          // #333: 위임 진행 버블 — 서브에이전트 위임 시작 시 한 단계 표시.
          if (aborted) return;
          res.write(`event: progress\ndata: ${JSON.stringify({ label })}\n\n`);
        },
      );
      if (!aborted) {
        // #333 M2: pending_action 을 done 앞에 발행(결정적 순서) — 확인 카드.
        if (result.pendingAction) {
          res.write(`event: pending_action\ndata: ${JSON.stringify(result.pendingAction)}\n\n`);
        }
        res.write(`event: done\ndata: ${JSON.stringify({ fullText: result.fullText, widgets: result.widgets })}\n\n`);
        res.end();
      }
    } catch (e) {
      console.error('[ai-compose] 실패:', e instanceof Error ? e.message : String(e));
      // 연결이 살아 있을 때만 error 발행(닫힌 소켓 write → EPIPE 방지).
      if (!aborted) {
        res.write(`event: error\ndata: ${JSON.stringify({ message: 'compose_failed' })}\n\n`);
        res.end();
      }
    }
  });

  return router;
}
