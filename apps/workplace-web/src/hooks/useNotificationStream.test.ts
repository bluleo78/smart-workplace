// notify.* SSE 핸들러 — 알림 목록 무효화, 메일 보내기 실패 알림이면 임시보관함도 다시 받는다(WP-1786), 모든 알림은 내 차례(workflow-turns)도 무효화한다(WP-2042).
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { mailDraftKeys } from './queries/mailDraftKeys';
import { notificationKeys } from './queries/notificationKeys';
import { workflowRunKeys } from './queries/workflowRunKeys';
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
    expect(spy).not.toHaveBeenCalledWith({ queryKey: mailDraftKeys.all() });
  });

  // WP-2042: 차례 넘김은 할당·멘션 등 여러 알림으로 온다 — 유형과 무관하게 「내 차례」를 다시 읽는다.
  it('어떤 알림이든 내 차례(workflow-turns)도 무효화한다', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    for (const data of [{ type: 'ASSIGNED' }, undefined]) {
      spy.mockClear();
      handleNotifyEvent(qc, 'notify.created', data);
      expect(spy).toHaveBeenCalledWith({ queryKey: workflowRunKeys.myTurns() });
    }
  });

  it('notify.created 가 아닌 이벤트는 아무것도 무효화하지 않는다', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    handleNotifyEvent(qc, 'notify.read', { type: 'ASSIGNED' });
    expect(spy).not.toHaveBeenCalled();
  });
});
