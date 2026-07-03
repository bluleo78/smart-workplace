// Task8: opencode(별도 프로세스) 가 stdio MCP child 를 통해 받은 propose/submit/unassign 콜백을
// 메인 서버로 전달하는 HTTP 콜백 엔드포인트. stdio-entry.ts 가 이 라우트로 POST 한다.
// 인증은 index.ts 에서 전역 internalAuth 미들웨어가 이미 적용된 뒤 마운트된다.
import { Router } from 'express';
import { z } from 'zod';

import { takeBridge } from '../agent/bridge-registry.js';

// HostBridge 3 메서드 각각의 data 형태를 kind 로 판별.
const bridgeBody = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('proposal'),
    data: z.object({
      actionType: z.string(),
      summary: z.string(),
      params: z.record(z.string(), z.unknown()),
    }),
  }),
  z.object({
    kind: z.literal('submit_response'),
    data: z.string(),
  }),
  z.object({
    kind: z.literal('unassign'),
    data: z.object({
      ok: z.boolean(),
      canonical: z.string().optional(),
    }),
  }),
]);

export function createInternalBridgeRouter(): Router {
  const router = Router();

  router.post('/internal/bridge/:runId', (req, res) => {
    const parsed = bridgeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }

    const bridge = takeBridge(req.params.runId);
    if (!bridge) {
      res.status(404).json({ error: 'run_not_found' });
      return;
    }

    const body = parsed.data;
    switch (body.kind) {
      case 'proposal':
        bridge.onProposal(body.data);
        break;
      case 'submit_response':
        bridge.onSubmitResponse(body.data);
        break;
      case 'unassign':
        bridge.onUnassignResult(body.data);
        break;
    }

    res.status(200).json({ ok: true });
  });

  return router;
}
