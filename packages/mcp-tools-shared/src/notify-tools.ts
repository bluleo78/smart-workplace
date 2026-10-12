// src/notify-tools.ts — 알림 인박스 도구. 두 앱 공유(#850).
// 서버가 호출자 본인 알림만 돌려준다(recipientId=callerId). ai-agent AI Chat 은 요청한 사람 신원으로 호출하므로
// 사람의 알림이 보이지만, 에이전트 신원으로 도는 프로필(메시징·이슈 채팅)에서는 에이전트 자신의 알림이 되므로 노출하지 않는다.
// 읽음 처리는 본인 알림 상태만 바꾸는 비파괴 쓰기라 확인 카드 없이 직접 실행한다.
import { z } from 'zod';
import { dropEmpty } from './compact.js';
import type { SharedTool } from './mcp-tool.js';
import { formatIssueKey } from './parse.js';
import type { NotificationRow, NotificationToolClient } from './tool-client.js';

/** 서버 목록 한 페이지 상한(GET /notifications limit 최대값). */
const PAGE_SIZE = 100;
/** unreadOnly 로 넘겨 읽을 최대 페이지 — 오래된 알림이 매우 많아도 요청이 끝없이 늘지 않게 막는다. */
const MAX_PAGES = 10;

export const listNotificationsInput = z.object({
  unreadOnly: z.boolean().default(false),
  limit: z.number().int().min(1).max(PAGE_SIZE).default(20),
  // WP-352: 서버 GET /notifications 의 offset(NotificationController). 이전 호출이 돌려준 nextOffset 을 그대로 넘긴다.
  offset: z.number().int().min(0).default(0).describe('nextOffset; do not compute it'),
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
 * 안 읽은 알림을 최신순으로 limit 건까지 모은다. 서버에 안 읽음 필터가 없어 offset 에서부터 페이지를 넘겨 가며 거른다.
 * 처음부터(offset 0) 읽을 때는 전체 안 읽음 수(unreadCount)만큼 모였거나 마지막 페이지면 멈춘다 — 대부분 첫 페이지에서 끝난다.
 * offset > 0 이면 앞쪽 안 읽음이 몇 건인지 몰라 unreadCount 로 목표를 줄일 수 없어 끝이나 limit 까지 읽는다.
 *
 * nextOffset 은 **서버 목록 기준** 이어 읽을 위치다(WP-352) — 마지막으로 담은 행 바로 뒤. 페이지 끝으로 잡으면 그 사이의 안 읽음이 빠진다.
 * 더 읽을 게 없으면 undefined. limit 을 채운 경우는 뒤에 안 읽음이 더 남았는지 확실하지 않을 수 있어(offset > 0) 빈 페이지가 올 수 있다.
 */
async function collectUnread(client: NotificationToolClient, limit: number, unreadCount: number, offset: number) {
  const target = offset === 0 ? Math.min(limit, unreadCount) : limit;
  const items: NotificationRow[] = [];
  if (target === 0) return { items, nextOffset: undefined };
  let pos = offset;
  for (let page = 0; page < MAX_PAGES; page++) {
    const rows = await client.listNotifications({ limit: PAGE_SIZE, offset: pos });
    for (const [i, row] of rows.entries()) {
      if (row.read) continue;
      items.push(row);
      if (items.length === target) {
        const more = offset > 0 || unreadCount > items.length;
        return { items, nextOffset: more ? pos + i + 1 : undefined };
      }
    }
    pos += rows.length;
    if (rows.length < PAGE_SIZE) return { items, nextOffset: undefined };
  }
  // 최대 페이지만큼 훑고도 목표를 못 채웠다 — 오래된 쪽에 더 있을 수 있어 여기서부터 이어 읽게 한다.
  return { items, nextOffset: pos };
}

/** 알림 도구(list_notifications/mark_notification_read/mark_all_notifications_read). */
export function buildNotifyTools(client: NotificationToolClient): SharedTool[] {
  return [
    {
      name: 'list_notifications',
      app: 'notify',
      kind: 'read',
      description:
        'Lists my notification inbox (인박스) newest first as {unreadCount (total), items, hasMore?, nextOffset?}; issue items carry issueKey, event ' +
        'items eventId. If hasMore, pass nextOffset as offset with the same unreadOnly and limit, or say the list is partial; that page may be empty.',
      inputSchema: listNotificationsInput,
      async handler(args) {
        const { unreadOnly, limit, offset } = listNotificationsInput.parse(args);
        // unreadOnly 는 모을 목표치(unreadCount)가 먼저 필요하고, 아니면 두 조회가 독립이라 병렬로 부른다.
        let unreadCount: number;
        let rows: NotificationRow[];
        let nextOffset: number | undefined;
        if (unreadOnly) {
          unreadCount = await client.countUnreadNotifications();
          ({ items: rows, nextOffset } = await collectUnread(client, limit, unreadCount, offset));
        } else {
          [unreadCount, rows] = await Promise.all([
            client.countUnreadNotifications(),
            client.listNotifications({ limit, offset }),
          ]);
          // 서버는 총 개수·마지막 페이지 여부를 주지 않는다 — 한 페이지가 꽉 찼으면 더 있을 수 있다고 본다.
          if (rows.length >= limit) nextOffset = offset + rows.length;
        }
        return JSON.stringify({
          unreadCount,
          items: rows.map(toNotificationView),
          ...(nextOffset !== undefined && { hasMore: true, nextOffset }),
        });
      },
    },
    {
      name: 'mark_notification_read',
      app: 'notify',
      kind: 'write',
      hints: { destructive: true, idempotent: true },
      description:
        'Marks one notification read (notificationId from list_notifications); already read is fine.',
      inputSchema: markNotificationReadInput,
      async handler(args) {
        const { notificationId } = markNotificationReadInput.parse(args);
        await client.markNotificationRead(notificationId);
        return 'ok';
      },
    },
    {
      name: 'mark_all_notifications_read',
      app: 'notify',
      kind: 'write',
      hints: { destructive: true, idempotent: true },
      description:
        'Marks all my notifications read; only when the user asks for all of them.',
      inputSchema: z.object({}),
      async handler() {
        await client.markAllNotificationsRead();
        return 'ok';
      },
    },
  ];
}
