// 드라이브 AI 라우트 — workplace-api 가 파일 추출 텍스트를 전달하면 요약·검색 오버뷰 반환.
// /drive/summarize: 단발 요약(JSON 응답).
// /drive/overview: 검색 결과 발췌 기반 SSE 스트리밍 합성(wiki/compose 미러).
import { Router } from 'express';
import { z } from 'zod';

import { type RunAgentDeps } from '../agent/run-agent.js';
import { runDriveSummarize, runDriveOverview } from '../agent/run-drive-ai.js';
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

// 검색 오버뷰 요청 스키마 — 질문 + 발췌 목록(최대 5건) + assistant 설정.
// excerpts.text 는 비신뢰 사용자 파일 콘텐츠 — runDriveOverview 에서 인젝션 방어.
const overviewSchema = z.object({
  query: z.string().min(1),
  excerpts: z.array(z.object({ name: z.string(), text: z.string() })).max(5),
  assistantAgentId: z.number().int().positive(),
  model: z.string().optional(),
  maxTurns: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().optional(),
});

export function createDriveRouter(deps: RunAgentDeps): Router {
  const router = Router();

  // 파일 본문 요약: text+fileName+mime → {summary}.
  router.post('/drive/summarize', handler(summarizeSchema, runDriveSummarize, deps, 'drive-summarize'));

  // 검색 결과 발췌 기반 스트리밍 합성: excerpts → SSE delta 스트림.
  // wiki/compose 패턴 미러: event: delta → event: done / event: error.
  router.post('/drive/overview', async (req, res) => {
    const parsed = overviewSchema.safeParse(req.body);
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

    // 연결 종료 감지 — abort 시 (1) 추가 write 중단, (2) SDK query interrupt.
    // 정상 종료(res.end 후)로 인한 close 는 무시한다.
    let aborted = false;
    const ac = new AbortController();
    res.on('close', () => {
      if (res.writableEnded) return; // 정상 완료 후 close — 무시
      aborted = true;
      ac.abort();
    });

    try {
      await runDriveOverview(
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
      console.error('[drive-overview] 실패:', e instanceof Error ? e.message : String(e));
      // 연결이 살아 있을 때만 error 발행(닫힌 소켓 write → EPIPE 방지).
      if (!aborted) {
        res.write(`event: error\ndata: ${JSON.stringify({ message: 'overview_failed' })}\n\n`);
        res.end();
      }
    }
  });

  return router;
}
