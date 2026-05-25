// 이벤트 수신 엔드포인트 — workplace-api 가 도메인 이벤트를 푸시한다.
// envelope({type, payload}) 검증 후 type 별 핸들러 분기 (5c-1).
// 알려진 issue.* 인데 payload 형태가 맞지 않으면 invalid_payload,
// 그 외 type 은 unsupported_event_type.
import { Router } from 'express';
import { z } from 'zod';

import {
  handleIssueAssigned,
  handleIssueCommented,
  handleIssueCreated,
  handleIssueStatusChanged,
} from '../agent/event-handler.js';
import type { WorkplaceApiClient } from '../clients/workplace-api.js';
import {
  KNOWN_TYPE_PREFIX,
  issueEventEnvelope,
} from '../types/issue-events.js';

const envelopeSchema = z.object({
  type: z.string().min(1),
  payload: z.unknown(),
});

export function createEventsRouter(client: WorkplaceApiClient): Router {
  const router = Router();

  router.post('/events', async (req, res) => {
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
      // 알려진 prefix 면 payload 형태가 잘못된 것 → invalid_payload
      if (type.startsWith(KNOWN_TYPE_PREFIX)) {
        res
          .status(400)
          .json({ error: 'invalid_payload', issues: parsed.error.issues });
        return;
      }
      // 그 외 type 은 아예 미지원
      res.status(400).json({ error: 'unsupported_event_type', type });
      return;
    }

    const ev = parsed.data;
    try {
      switch (ev.type) {
        case 'issue.created':
          await handleIssueCreated(client, ev.payload);
          break;
        case 'issue.assigned':
          await handleIssueAssigned(client, ev.payload);
          break;
        case 'issue.commented':
          await handleIssueCommented(client, ev.payload);
          break;
        case 'issue.status_changed':
          await handleIssueStatusChanged(client, ev.payload);
          break;
      }
    } catch (e) {
      // 핸들러 내부 실패는 이미 swallow 됐어야 함. 그래도 안전망.
      console.error('[events] handler 예외:', e);
    }

    res.status(202).json({ received: true });
  });

  return router;
}
