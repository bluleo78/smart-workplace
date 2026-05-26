// 이벤트 수신 엔드포인트 — workplace-api 가 도메인 이벤트를 푸시한다.
// envelope({type, payload}) 검증 후 handleEvent 단일 진입점으로 분기.
// LLM 실행은 background — /events 는 즉시 202.
import { Router } from 'express';
import { z } from 'zod';

import { handleEvent } from '../agent/event-handler.js';
import {
  KNOWN_ISSUE_TYPES,
  issueEventEnvelope,
} from '../types/issue-events.js';

const envelopeSchema = z.object({
  type: z.string().min(1),
  payload: z.unknown(),
});

export function createEventsRouter(): Router {
  const router = Router();

  router.post('/events', (req, res) => {
    const envelope = envelopeSchema.safeParse(req.body);
    if (!envelope.success) {
      res
        .status(400)
        .json({ error: 'invalid_payload', issues: envelope.error.issues });
      return;
    }

    const { type } = envelope.data;
    const parsed = issueEventEnvelope.safeParse(req.body);
    if (!parsed.success) {
      if (KNOWN_ISSUE_TYPES.has(type)) {
        res
          .status(400)
          .json({ error: 'invalid_payload', issues: parsed.error.issues });
        return;
      }
      res.status(400).json({ error: 'unsupported_event_type', type });
      return;
    }

    // 동기 진입 — handleEvent 내부에서 fire-and-forget.
    handleEvent(parsed.data);
    res.status(202).json({ received: true });
  });

  return router;
}
