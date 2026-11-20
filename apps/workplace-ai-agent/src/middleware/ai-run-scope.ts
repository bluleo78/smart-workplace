// WP-1828: HTTP 요청 하나를 AI 처리 한 건의 범위로 열어 기록한다.
import type { RequestHandler } from 'express';
import { AI_RUN_HEADER } from '../ai-run/header.js';
import { openAiRunScope, safeClose } from '../ai-run/open-scope.js';
import { kindForPath } from '../ai-run/kinds.js';
import { withAiRunScope } from '../ai-run/scope.js';
import type { AiRunSink } from '../ai-run/types.js';

/**
 * 경로가 종류 표에 있는 요청만 범위를 연다(표에 없으면 통과만).
 * 헤더(X-AI-Run)의 값이 있으면 표 값·요청 body 보다 우선한다. 잘못된 헤더는 없는 것처럼 본다.
 * 헤더에 tenantId 가 없으면 요청 body 의 tenantId(양의 정수)를 쓴다 — /ai/chat 이 body 로 테넌트를 받기 때문이다.
 * 응답이 끝나면(finish) 상태 코드로, 끝나기 전에 연결이 끊기면(close) client_closed 로 닫는다.
 * close 는 멱등이라 둘 다 와도 한 건이고, 러너를 안 부른 요청은 아무것도 남기지 않는다.
 * 기록 쪽 오류는 요청 처리에 영향을 주지 않도록 모두 삼킨다.
 */
export function aiRunScopeMiddleware(sink: AiRunSink): RequestHandler {
  return (req, res, next) => {
    const tableKind = kindForPath(req.path);
    const bodyTenant: unknown = req.body?.tenantId;
    const derived = Number.isInteger(bodyTenant) && (bodyTenant as number) > 0 ? { tenantId: bodyTenant as number } : {};
    const scope = tableKind ? openAiRunScope(tableKind, req.headers[AI_RUN_HEADER], derived, sink) : undefined;
    if (!scope) {
      next();
      return;
    }
    let finished = false;
    res.on('finish', () => {
      finished = true;
      const code = res.statusCode;
      safeClose(scope, code >= 400 ? { ok: false, reason: `http_${code}` } : { ok: true });
    });
    res.on('close', () => {
      if (finished) return;
      safeClose(scope, { ok: false, reason: 'client_closed' });
    });
    withAiRunScope(scope, next);
  };
}
