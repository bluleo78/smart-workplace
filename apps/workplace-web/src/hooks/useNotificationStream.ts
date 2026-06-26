import type { QueryClient } from '@tanstack/react-query';

import { notificationKeys } from './queries/notificationKeys';

// notify.* SSE 이벤트 — 어떤 알림 이벤트든 캐시 무효화 → REST 가 최신 목록/카운트를 다시 가져온다.
export function handleNotifyEvent(qc: QueryClient, eventName: string) {
  if (eventName === 'notify.created') {
    qc.invalidateQueries({ queryKey: notificationKeys.all });
  }
}
