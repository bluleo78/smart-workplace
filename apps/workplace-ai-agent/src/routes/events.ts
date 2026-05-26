// 이벤트 수신 — workplace-api 가 푸시한 이벤트를 즉시 202 응답하고 background 처리.
import { Router } from 'express';
import { z } from 'zod';

import { handleEvent, type EventHandlerDeps } from '../agent/event-handler.js';
import {
  KNOWN_ISSUE_TYPES,
  issueEventEnvelope,
} from '../types/issue-events.js';

const envelopeSchema = z.object({
  type: z.string().min(1),
  payload: z.unknown(),
});

export function createEventsRouter(deps: EventHandlerDeps): Router {
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

    handleEvent(parsed.data, deps);
    res.status(202).json({ received: true });
  });

  return router;
}
