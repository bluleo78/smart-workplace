import { describe, expect, it, vi } from 'vitest';
import { buildNotifyTools, toNotificationView } from './notify-tools.js';
import type { NotificationRow, NotificationToolClient } from './tool-client.js';

/** 알림 클라이언트 mock. */
function mockClient(): NotificationToolClient {
  return {
    listNotifications: vi.fn().mockResolvedValue([]),
    countUnreadNotifications: vi.fn().mockResolvedValue(0),
    markNotificationRead: vi.fn().mockResolvedValue(undefined),
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
    const out = JSON.parse(await tool(c, 'list_notifications').handler({}));
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
    const out = JSON.parse(await tool(c, 'list_notifications').handler({ unreadOnly: true }));
    expect(c.listNotifications).toHaveBeenNthCalledWith(1, { limit: 100, offset: 0 });
    expect(c.listNotifications).toHaveBeenNthCalledWith(2, { limit: 100, offset: 100 });
    expect(out.items.map((i: { notificationId: number }) => i.notificationId)).toEqual([5, 3]);
  });

  it('list_notifications unreadOnly → limit 만큼 모이면 더 읽지 않고, 안 읽은 게 없으면 목록을 부르지 않는다', async () => {
    const c = mockClient();
    vi.mocked(c.countUnreadNotifications).mockResolvedValue(50);
    vi.mocked(c.listNotifications).mockResolvedValue(Array.from({ length: 100 }, (_, i) => issueRow(100 - i, false)));
    const out = JSON.parse(await tool(c, 'list_notifications').handler({ unreadOnly: true, limit: 2 }));
    expect(c.listNotifications).toHaveBeenCalledTimes(1);
    expect(out.items).toHaveLength(2);

    const empty = mockClient();
    const none = JSON.parse(await tool(empty, 'list_notifications').handler({ unreadOnly: true }));
    expect(empty.listNotifications).not.toHaveBeenCalled();
    expect(none).toEqual({ unreadCount: 0, items: [] });
  });

  it('mark_notification_read → client.markNotificationRead(notificationId)', async () => {
    const c = mockClient();
    expect(await tool(c, 'mark_notification_read').handler({ notificationId: 11 })).toBe('ok');
    expect(c.markNotificationRead).toHaveBeenCalledWith(11);
  });

  it('mark_all_notifications_read → client.markAllNotificationsRead()', async () => {
    const c = mockClient();
    expect(await tool(c, 'mark_all_notifications_read').handler({})).toBe('ok');
    expect(c.markAllNotificationsRead).toHaveBeenCalled();
  });
});
