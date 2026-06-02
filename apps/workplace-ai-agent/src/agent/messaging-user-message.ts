// 7: messaging.message.posted → Claude CLI user message. trigger + 최근 대화 흐름.
import type { MessagingMessagePostedPayload } from '../types/messaging-events.js';
import type { ChannelMessageItem } from '../clients/workplace-api.js';

export function buildMessagingUserMessage(
  payload: MessagingMessagePostedPayload,
  recentMessages: ChannelMessageItem[],
): string {
  // 오래된→최신 순으로 노출 (목록은 보통 최신 DESC 로 오므로 id 오름차순 정렬).
  const ordered = [...recentMessages].sort((a, b) => a.id - b.id);
  const thread = ordered
    .map(
      (m) =>
        `- [${m.authorName}${m.authorKind === 'AGENT' ? '/AI' : ''}] ${m.deleted ? '(삭제됨)' : m.body}`,
    )
    .join('\n');

  const where = payload.channelKind === 'DM' ? '1:1 DM' : '채널';
  const actorName = payload.actor.name ?? '사용자';

  return (
    `[이벤트: messaging.message.posted]\n` +
    `${where}(channelId=${payload.channelId})에서 당신(AI)에게 메시지가 왔습니다.\n` +
    `보낸 사람: ${actorName}\n` +
    `메시지: "${payload.body}"\n\n` +
    `## 최근 대화 흐름 (오래된→최신)\n${thread || '(이전 메시지 없음)'}\n\n` +
    `더 과거 대화가 필요하면 get_channel_messages(${payload.channelId}). ` +
    `파악이 끝나면 add_channel_message(${payload.channelId}, 답변) 을 정확히 한 번 호출해 답하세요.`
  );
}
