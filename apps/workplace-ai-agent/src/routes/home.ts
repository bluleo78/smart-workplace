// 홈 컴포즈 SSE 라우트 — workplace-api 가 SSE 패스스루로 소비한다.
// 본문에 비서 설정(assistantAgentId/model/thinkingDepth/maxTurns/timeoutMs) + 쿼리를 포함한다(#50).
// 토큰은 event: delta 로 점진 발행, 종료는 event: done {fullText, widgets}, 실패는 event: error.
// 연결 종료(req close) 시 AbortController 로 하위 CLI child 를 kill 해 자원 누수를 막는다.
import { randomUUID } from 'node:crypto';

import { Router } from 'express';
import { z } from 'zod';

import { type RunAgentDeps } from '../agent/run-agent.js';
import { runAiChatStream } from '../agent/run-ai-chat.js';
import { runHomePriorityClassify } from '../agent/run-home-priority-classify.js';
import { log } from '../logger.js';

// 홈 우선순위 분류 요청 바디 검증 — workplace-api AiAgentPriorityClient 가 보내는 계약과 필드명이 정확히 일치해야 한다.
const priorityClassifySchema = z.object({
  items: z.array(
    z.object({
      sourceType: z.string(),
      sourceId: z.string(),
      title: z.string(),
      context: z.string(),
    }),
  ),
  assistantAgentId: z.number(),
  model: z.string(),
  maxTurns: z.number(),
  timeoutMs: z.number(),
});

export const chatSchema = z.object({
  // 공백 전용 쿼리("   ")는 trim 후 min(1) 검사로 거부 (#430).
  query: z.string().trim().min(1),
  recentContext: z
    .array(z.object({ role: z.string(), content: z.string() }))
    .optional(),
  assistantAgentId: z.number().int().positive(),
  // #376: 요청 사용자 ID — MCP 도구 컨텍스트를 assistantAgentId 아닌 실제 요청자로 설정하기 위해 전달.
  userId: z.number().int().positive(),
  // #719: 요청자의 active-tenant(nullable). workplace-api 대리 호출 시 X-On-Behalf-Of-Tenant 로
  // 되돌려 보내, 다중/무 멤버십일 때 AgentTenantResolver 가 fail-closed 되는 것을 막는다.
  tenantId: z.number().int().positive().nullish(),
  model: z.string().min(1),
  thinkingDepth: z.enum(['NONE', 'NORMAL', 'DEEP']),
  maxTurns: z.number().int().positive(),
  timeoutMs: z.number().int().positive(),
});

export function createHomeRouter(deps: RunAgentDeps): Router {
  const router = Router();

  router.post('/ai/chat', async (req, res) => {
    const parsed = chatSchema.safeParse(req.body);
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

    // 요청별 고유 ID 생성 — 시작/완료/오류 로그를 end-to-end 로 추적하기 위해 사용한다.
    const requestId = randomUUID();
    const startedAt = Date.now();
    const d = parsed.data;
    log.info('ai-chat', 'start', {
      requestId,
      agentId: d.assistantAgentId,
      userId: d.userId,
      model: d.model,
      thinkingDepth: d.thinkingDepth,
      maxTurns: d.maxTurns,
      queryLen: d.query.length,
      query: d.query.slice(0, 200),
    });

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
      const result = await runAiChatStream(
        { ...parsed.data, requestId },
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
        (line) => {
          // 도구 호출 라이브 — start/result 를 phase 로 정규화해 발행. raw result 문자열은 제외.
          if (aborted) return;
          const phase = line.event === 'tool_use_start' ? 'start' : 'result';
          const payload: Record<string, unknown> = { seq: line.seq, phase, toolName: line.toolName };
          if (line.args) payload.args = line.args;
          if (line.event === 'tool_result') payload.isError = line.isError ?? false;
          res.write(`event: tool\ndata: ${JSON.stringify(payload)}\n\n`);
        },
        (text) => {
          // #463: 라우터 자유 prose 라이브 delta — onText(위임 답)와 동일 채널.
          if (aborted) return;
          res.write(`event: delta\ndata: ${JSON.stringify({ text })}\n\n`);
        },
      );
      if (!aborted) {
        // #351: pending_action 을 done 앞에 발행(결정적 순서) — 확인 카드. 다건 제안은 배열로 1회 발행.
        if (Array.isArray(result.pendingActions) && result.pendingActions.length > 0) {
          res.write(`event: pending_action\ndata: ${JSON.stringify(result.pendingActions)}\n\n`);
        }
        // #432: done 이벤트에 토큰 사용량(usage) 포함 — 없으면 null.
        res.write(`event: done\ndata: ${JSON.stringify({ fullText: result.fullText, widgets: result.widgets, usage: result.usage })}\n\n`);
        res.end();
        log.info('ai-chat', 'done', {
          requestId,
          durationMs: Date.now() - startedAt,
          answerLen: result.fullText.length,
          widgetCount: Array.isArray(result.widgets) ? result.widgets.length : 0,
        });
      } else {
        // 클라이언트 연결이 끊긴 채 완료 — 중단으로 기록.
        log.info('ai-chat', 'aborted', { requestId, durationMs: Date.now() - startedAt });
      }
    } catch (e) {
      console.error('[ai-chat] 실패:', e instanceof Error ? e.message : String(e));
      log.error('ai-chat', 'error', {
        requestId,
        durationMs: Date.now() - startedAt,
        error: e instanceof Error ? e.message : String(e),
      });
      // 연결이 살아 있을 때만 error 발행(닫힌 소켓 write → EPIPE 방지).
      if (!aborted) {
        res.write(`event: error\ndata: ${JSON.stringify({ message: 'chat_failed' })}\n\n`);
        res.end();
      }
    }
  });

  // 홈 우선순위 분류 — workplace-api 가 동기 호출. 후보 항목별 중요도·긴급도 점수(0~100)+근거 반환.
  // issue.ts 핸들러 팩토리 패턴 미러 — zod 검증 → 러너 호출 → 400/200/502 응답.
  router.post('/home/priority-classify', async (req, res) => {
    const parsed = priorityClassifySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    try {
      res.status(200).json(await runHomePriorityClassify(parsed.data, deps));
    } catch (e) {
      console.error('[home-priority-classify] 실패:', e instanceof Error ? e.message : String(e));
      res.status(502).json({ error: 'home_priority_classify_failed' });
    }
  });

  return router;
}
