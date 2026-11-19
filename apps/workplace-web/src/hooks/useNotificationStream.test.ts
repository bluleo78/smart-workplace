// notify.* SSE 핸들러 — 알림 목록 무효화, 메일 보내기 실패 알림이면 임시보관함도 다시 받는다(WP-1786).
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { mailDraftKeys } from './queries/mailDraftKeys';
import { notificationKeys } from './queries/notificationKeys';
import { handleNotifyEvent } from './useNotificationStream';

describe('handleNotifyEvent', () => {
  it('MAIL_SEND_FAILED 알림이면 알림과 함께 임시보관함 쿼리도 무효화한다', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    handleNotifyEvent(qc, 'notify.created', { type: 'MAIL_SEND_FAILED' });
    expect(spy).toHaveBeenCalledWith({ queryKey: notificationKeys.all });
    expect(spy).toHaveBeenCalledWith({ queryKey: mailDraftKeys.all() });
  });

  it('다른 알림은 임시보관함을 건드리지 않는다', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    handleNotifyEvent(qc, 'notify.created', { type: 'MENTIONED' });
    handleNotifyEvent(qc, 'notify.created', undefined);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).not.toHaveBeenCalledWith({ queryKey: mailDraftKeys.all() });
  });
});
