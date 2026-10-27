import { describe, expect, it, vi } from 'vitest';
import { buildNotifyTools, toNotificationView } from './notify-tools.js';
import type { NotificationRow, NotificationToolClient } from './tool-client.js';
import { resultText } from './mcp-content.js';

/** 알림 클라이언트 mock. */
function mockClient(): NotificationToolClient {
  return {
    listNotifications: vi.fn().mockResolvedValue([]),
    countUnreadNotifications: vi.fn().mockResolvedValue(0),
    markNotificationRead: vi.fn().mockResolvedValue(undefined),
    markIssueNotificationsRead: vi.fn().mockResolvedValue(undefined),
    markAllNotificationsRead: vi.fn().mockResolvedValue(undefined),
  };
}

const tool = (c: NotificationToolClient, name: string) => buildNotifyTools(c).find((x) => x.name === name)!;

/** 서버 NotificationResponse 형태의 이슈 알림 행. */
const issueRow = (id: number, read: boolean): NotificationRow => ({
  id,
  type: 'COMMENTED',
  actorId: 7,
  actorName: '김철수',
  actorKind: 'HUMAN',
  issueId: 501,
  projectKey: 'WP',
  issueNumber: 12,
  issueTitle: '로그인 오류',
  commentId: 900,
  eventId: null,
  eventTitle: null,
  eventStartsAt: null,
  read,
  createdAt: '2026-09-24T01:00:00Z',
});

describe('toNotificationView', () => {
  it('숫자 actorId·issueId·commentId 와 빈 event* 를 지우고 issueKey 를 조립, id 는 notificationId 로 옮긴다 (#833)', () => {
    const v = toNotificationView(issueRow(11, false));
    expect(v).toEqual({
      notificationId: 11,
      type: 'COMMENTED',
      actorName: '김철수',
      actorKind: 'HUMAN',
      issueKey: 'WP-12',
      issueTitle: '로그인 오류',
      read: false,
      createdAt: '2026-09-24T01:00:00Z',
    });
  });

  it('일정 알림은 issueKey 없이 eventId 를 유지한다', () => {
    const v = toNotificationView({
      id: 12,
      type: 'REMINDER',
      read: true,
      createdAt: 't',
      projectKey: null,
      issueNumber: null,
      eventId: 52,
      eventTitle: '주간회의',
    });
    expect(v).toEqual({ notificationId: 12, type: 'REMINDER', read: true, createdAt: 't', eventId: 52, eventTitle: '주간회의' });
  });
});

describe('buildNotifyTools', () => {
  it('list_notifications → limit 기본 20 첫 페이지와 안읽음 수를 함께 반환', async () => {
    const c = mockClient();
    vi.mocked(c.listNotifications).mockResolvedValue([issueRow(11, false), issueRow(10, true)]);
    vi.mocked(c.countUnreadNotifications).mockResolvedValue(5);
    const out = JSON.parse(resultText(await tool(c, 'list_notifications').handler({})));
    expect(c.listNotifications).toHaveBeenCalledWith({ limit: 20, offset: 0 });
    expect(out.unreadCount).toBe(5);
    expect(out.items.map((i: { notificationId: number }) => i.notificationId)).toEqual([11, 10]);
  });

  it('list_notifications unreadOnly → 안 읽은 게 첫 페이지 밖에 있어도 offset 으로 넘겨 모은다', async () => {
    const c = mockClient();
    const readPage = Array.from({ length: 100 }, (_, i) => issueRow(1000 - i, true));
    vi.mocked(c.countUnreadNotifications).mockResolvedValue(2);
    vi.mocked(c.listNotifications)
      .mockResolvedValueOnce(readPage)
      .mockResolvedValueOnce([issueRow(5, false), issueRow(4, true), issueRow(3, false)]);
    const out = JSON.parse(resultText(await tool(c, 'list_notifications').handler({ unreadOnly: true })));
    expect(c.listNotifications).toHaveBeenNthCalledWith(1, { limit: 100, offset: 0 });
    expect(c.listNotifications).toHaveBeenNthCalledWith(2, { limit: 100, offset: 100 });
    expect(out.items.map((i: { notificationId: number }) => i.notificationId)).toEqual([5, 3]);
  });

  it('list_notifications unreadOnly → limit 만큼 모이면 더 읽지 않고, 안 읽은 게 없으면 목록을 부르지 않는다', async () => {
    const c = mockClient();
    vi.mocked(c.countUnreadNotifications).mockResolvedValue(50);
    vi.mocked(c.listNotifications).mockResolvedValue(Array.from({ length: 100 }, (_, i) => issueRow(100 - i, false)));
    const out = JSON.parse(resultText(await tool(c, 'list_notifications').handler({ unreadOnly: true, limit: 2 })));
    expect(c.listNotifications).toHaveBeenCalledTimes(1);
    expect(out.items).toHaveLength(2);
    // 안 읽음이 limit 보다 더 남았으니 마지막으로 담은 행(서버 목록 2번째) 바로 뒤에서 이어 읽게 한다.
    expect(out).toMatchObject({ hasMore: true, nextOffset: 2 });

    const empty = mockClient();
    const none = JSON.parse(resultText(await tool(empty, 'list_notifications').handler({ unreadOnly: true })));
    expect(empty.listNotifications).not.toHaveBeenCalled();
    expect(none).toEqual({ unreadCount: 0, items: [] });
  });

  it('WP-352: list_notifications → 한 페이지가 꽉 차면 hasMore·nextOffset 을, 덜 차면 생략한다', async () => {
    const c = mockClient();
    vi.mocked(c.listNotifications).mockResolvedValue([issueRow(3, false), issueRow(2, true)]);
    const full = JSON.parse(resultText(await tool(c, 'list_notifications').handler({ limit: 2, offset: 10 })));
    expect(c.listNotifications).toHaveBeenCalledWith({ limit: 2, offset: 10 });
    expect(full).toMatchObject({ hasMore: true, nextOffset: 12 });

    const partial = JSON.parse(resultText(await tool(c, 'list_notifications').handler({ limit: 3, offset: 10 })));
    expect(partial).not.toHaveProperty('hasMore');
    expect(partial).not.toHaveProperty('nextOffset');
  });

  it('WP-352: unreadOnly + offset → 그 위치부터 훑고, nextOffset 은 마지막으로 담은 행 바로 뒤(페이지 끝이 아님)', async () => {
    const c = mockClient();
    vi.mocked(c.countUnreadNotifications).mockResolvedValue(40);
    // offset 30 에서 시작한 페이지: 읽음·안읽음이 섞여 있고 limit 2 를 두 번째 안 읽음(index 3)에서 채운다.
    vi.mocked(c.listNotifications).mockResolvedValue([
      issueRow(9, true), issueRow(8, false), issueRow(7, true), issueRow(6, false), issueRow(5, false), ...Array.from({ length: 95 }, (_, i) => issueRow(4 - i, false)),
    ]);
    const out = JSON.parse(resultText(await tool(c, 'list_notifications').handler({ unreadOnly: true, limit: 2, offset: 30 })));
    expect(c.listNotifications).toHaveBeenCalledWith({ limit: 100, offset: 30 });
    expect(out.items.map((i: { notificationId: number }) => i.notificationId)).toEqual([8, 6]);
    // 서버 목록 기준 30 + 3(index) + 1 = 34 — 페이지 끝(130)으로 잡으면 5번 이후 안 읽음이 건너뛰어진다.
    expect(out).toMatchObject({ hasMore: true, nextOffset: 34 });
  });

  it('WP-352: unreadOnly + offset > 0 → 끝까지 훑어도 limit 을 못 채우면 hasMore 를 싣지 않는다(unreadCount 로 조기 종료하지 않음)', async () => {
    const c = mockClient();
    // 전체 안 읽음 1건이지만 offset>0 이라 목표를 unreadCount 로 줄이지 않는다 — 마지막 페이지(100 미만)까지 읽고 끝.
    vi.mocked(c.countUnreadNotifications).mockResolvedValue(1);
    vi.mocked(c.listNotifications).mockResolvedValue([issueRow(3, false), issueRow(2, true)]);
    const out = JSON.parse(resultText(await tool(c, 'list_notifications').handler({ unreadOnly: true, limit: 5, offset: 20 })));
    expect(out.items).toHaveLength(1);
    expect(out).not.toHaveProperty('hasMore');
  });

  it('WP-352: unreadOnly → 최대 페이지만큼 훑고도 못 채우면 거기서부터 이어 읽게 nextOffset 을 준다', async () => {
    const c = mockClient();
    vi.mocked(c.countUnreadNotifications).mockResolvedValue(30);
    vi.mocked(c.listNotifications).mockResolvedValue(Array.from({ length: 100 }, (_, i) => issueRow(i, true)));
    const out = JSON.parse(resultText(await tool(c, 'list_notifications').handler({ unreadOnly: true, limit: 5 })));
    expect(c.listNotifications).toHaveBeenCalledTimes(10);
    expect(out).toMatchObject({ items: [], hasMore: true, nextOffset: 1000 });
  });

  it('mark_notification_read → client.markNotificationRead(notificationId)', async () => {
    const c = mockClient();
    expect(await tool(c, 'mark_notification_read').handler({ notificationId: 11 })).toBe('ok');
    expect(c.markNotificationRead).toHaveBeenCalledWith(11);
  });

  it('mark_notification_read issueKey → 그 이슈의 내 알림 전부 읽음(WP-720)', async () => {
    const c = mockClient();
    expect(await tool(c, 'mark_notification_read').handler({ issueKey: 'WP-12' })).toBe('ok');
    expect(c.markIssueNotificationsRead).toHaveBeenCalledWith('WP-12');
    expect(c.markNotificationRead).not.toHaveBeenCalled();
  });

  it('mark_notification_read 는 notificationId·issueKey 중 하나만 받는다', async () => {
    const c = mockClient();
    await expect(tool(c, 'mark_notification_read').handler({})).rejects.toThrow();
    await expect(tool(c, 'mark_notification_read').handler({ notificationId: 1, issueKey: 'WP-1' })).rejects.toThrow();
    expect(c.markNotificationRead).not.toHaveBeenCalled();
    expect(c.markIssueNotificationsRead).not.toHaveBeenCalled();
  });

  it('mark_all_notifications_read → client.markAllNotificationsRead()', async () => {
    const c = mockClient();
    expect(await tool(c, 'mark_all_notifications_read').handler({})).toBe('ok');
    expect(c.markAllNotificationsRead).toHaveBeenCalled();
  });
});
