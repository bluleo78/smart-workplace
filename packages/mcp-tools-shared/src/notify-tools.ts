// src/notify-tools.ts — 알림 인박스 도구. 두 앱 공유(#850).
// 서버가 호출자 본인 알림만 돌려준다(recipientId=callerId). ai-agent AI Chat 은 요청한 사람 신원으로 호출하므로
// 사람의 알림이 보이지만, 에이전트 신원으로 도는 프로필(메시징·이슈 채팅)에서는 에이전트 자신의 알림이 되므로 노출하지 않는다.
// 읽음 처리는 본인 알림 상태만 바꾸는 비파괴 쓰기라 확인 카드 없이 직접 실행한다.
import { z } from 'zod';
import { dropEmpty } from './compact.js';
import type { McpTool } from './mcp-tool.js';
import { formatIssueKey } from './parse.js';
import type { NotificationRow, NotificationToolClient } from './tool-client.js';

/** 서버 목록 한 페이지 상한(GET /notifications limit 최대값). */
const PAGE_SIZE = 100;
/** unreadOnly 로 넘겨 읽을 최대 페이지 — 오래된 알림이 매우 많아도 요청이 끝없이 늘지 않게 막는다. */
const MAX_PAGES = 10;

export const listNotificationsInput = z.object({
  unreadOnly: z.boolean().default(false),
  limit: z.number().int().min(1).max(PAGE_SIZE).default(20),
});
export const markNotificationReadInput = z.object({ notificationId: z.number().int().positive() });

/**
 * 알림 행 → LLM 뷰. 사람은 이름으로만 드러내고(actorId 제거, #833), 이슈는 숫자 id 대신 issueKey 로 합친다 —
 * 후속 도구(get_issue_detail)가 issueKey 를 받기 때문이다. 알림 id 는 읽음 처리 입력과 같은 이름(notificationId)으로 옮긴다.
 * 종류별로 비는 필드(이슈 알림의 event*, 일정 알림의 issue* 등)는 지우고, 나머지는 그대로 넘긴다(서버 필드 추가 시 누락 방지).
 */
export function toNotificationView({
  id,
  actorId: _actorId,
  issueId: _issueId,
  commentId: _commentId,
  projectKey,
  issueNumber,
  ...rest
}: NotificationRow) {
  return dropEmpty({ notificationId: id, ...rest, issueKey: formatIssueKey(projectKey, issueNumber) });
}

/**
 * 안 읽은 알림을 최신순으로 limit 건까지 모은다. 서버에 안 읽음 필터가 없어 페이지를 넘겨 가며 거른다.
 * 전체 안 읽음 수(unreadCount)만큼 모였거나 마지막 페이지면 멈춘다 — 대부분 첫 페이지에서 끝난다.
 */
async function collectUnread(client: NotificationToolClient, limit: number, unreadCount: number) {
  const target = Math.min(limit, unreadCount);
  const items: NotificationRow[] = [];
  for (let page = 0; page < MAX_PAGES && items.length < target; page++) {
    const rows = await client.listNotifications({ limit: PAGE_SIZE, offset: page * PAGE_SIZE });
    items.push(...rows.filter((r) => !r.read));
    if (rows.length < PAGE_SIZE) break;
  }
  return items.slice(0, limit);
}

/** 알림 도구(list_notifications/mark_notification_read/mark_all_notifications_read). */
export function buildNotifyTools(client: NotificationToolClient): McpTool[] {
  return [
    {
      name: 'list_notifications',
      description:
        '내 알림 인박스를 최신순으로 JSON({unreadCount, items})으로 반환합니다. unreadCount 는 전체 안 읽은 알림 수입니다. ' +
        'type: ASSIGNED(담당 지정)·COMMENTED(코멘트)·STATUS_CHANGED·PRIORITY_CHANGED·REMINDER(일정 알림)·CALENDAR_INVITED(일정 초대)·CALENDAR_RSVP_CHANGED(참석 응답 변경). ' +
        '이슈 알림은 issueKey, 일정 알림은 eventId 를 담습니다. unreadOnly=true 면 안 읽은 알림만 돌려줍니다. limit 기본 20(최대 100).',
      inputSchema: listNotificationsInput,
      async handler(args) {
        const { unreadOnly, limit } = listNotificationsInput.parse(args);
        // unreadOnly 는 모을 목표치(unreadCount)가 먼저 필요하고, 아니면 두 조회가 독립이라 병렬로 부른다.
        let unreadCount: number;
        let rows: NotificationRow[];
        if (unreadOnly) {
          unreadCount = await client.countUnreadNotifications();
          rows = await collectUnread(client, limit, unreadCount);
        } else {
          [unreadCount, rows] = await Promise.all([
            client.countUnreadNotifications(),
            client.listNotifications({ limit, offset: 0 }),
          ]);
        }
        return JSON.stringify({ unreadCount, items: rows.map(toNotificationView) });
      },
    },
    {
      name: 'mark_notification_read',
      description: '알림 하나를 읽음 처리합니다. notificationId 는 list_notifications 결과의 값입니다. 이미 읽은 알림이어도 오류 없이 성공합니다.',
      inputSchema: markNotificationReadInput,
      async handler(args) {
        const { notificationId } = markNotificationReadInput.parse(args);
        await client.markNotificationRead(notificationId);
        return 'ok';
      },
    },
    {
      name: 'mark_all_notifications_read',
      description: '내 알림을 모두 읽음 처리합니다. 사용자가 "알림 다 읽음으로" 처럼 전체 처리를 요청했을 때만 호출하세요.',
      inputSchema: z.object({}),
      async handler() {
        await client.markAllNotificationsRead();
        return 'ok';
      },
    },
  ];
}
