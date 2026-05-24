// 이벤트 수신 엔드포인트 — workplace-api 가 도메인 이벤트를 푸시한다.
// envelope({type, payload}) 만 검증하고 type 별 분기는 Phase 5b 에서 채운다.
// 처리 결과는 항상 202 — 실제 처리는 비동기 약속 (본 시점은 로그만).
import { Router } from 'express';
import { z } from 'zod';

const envelopeSchema = z.object({
  type: z.string().min(1),
  payload: z.unknown(),
});

export const eventsRouter = Router();

eventsRouter.post('/events', (req, res) => {
  const parsed = envelopeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'invalid_payload',
      issues: parsed.error.issues,
    });
    return;
  }

  const { type } = parsed.data;

  // Phase 5b 가 이 switch 에 type 별 분기를 추가한다.
  switch (type) {
    default:
      // 현 시점 모든 type 이 미지원 — 발신자에게 명시적으로 알린다.
      res.status(400).json({ error: 'unsupported_event_type', type });
      return;
  }

  // 위 switch 가 모든 경로를 반환하므로 아래는 도달 불가 — 5b 가 채울 자리:
  //   console.log('[events] received', { type });
  //   res.status(202).json({ received: true });
});
