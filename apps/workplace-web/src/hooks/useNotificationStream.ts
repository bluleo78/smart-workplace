import type { QueryClient } from '@tanstack/react-query';

import { mailDraftKeys } from './queries/mailDraftKeys';
import { notificationKeys } from './queries/notificationKeys';

// notify.* SSE 이벤트 — 어떤 알림 이벤트든 캐시 무효화 → REST 가 최신 목록/카운트를 다시 가져온다.
// 메일 보내기 실패 알림(MAIL_SEND_FAILED, WP-1786)이면 임시보관함 목록·개수도 다시 받는다 — 서버가 그 메일을 FAILED 임시보관으로 되돌렸으므로
// 다음 조회를 기다리지 않고 행이 보이게. 이벤트 데이터에는 알림 유형(type)이 실린다.
export function handleNotifyEvent(qc: QueryClient, eventName: string, data?: unknown) {
  if (eventName === 'notify.created') {
    qc.invalidateQueries({ queryKey: notificationKeys.all });
    if ((data as { type?: unknown } | undefined)?.type === 'MAIL_SEND_FAILED') {
      void qc.invalidateQueries({ queryKey: mailDraftKeys.all() });
    }
  }
}
