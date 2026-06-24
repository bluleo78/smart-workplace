// 7: messaging.message.posted → Claude CLI user message. trigger + 최근 대화 흐름.
// L3 위임 Task 4: 위임 가능 프로젝트 후보 목록 섹션 추가.
import type { MessagingMessagePostedPayload } from '../types/messaging-events.js';
import type { ChannelMessageItem } from '../clients/workplace-api.js';

export function buildMessagingUserMessage(
  payload: MessagingMessagePostedPayload,
  recentMessages: ChannelMessageItem[],
  // L3 위임: 위임자가 참여 중인 프로젝트 후보 목록. AI 가 propose_create_issue 의 projectKey 를 고를 소스.
  candidates: { key: string; name: string }[] = [],
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

  // 후보가 있으면 각 항목을 "- 이름 (KEY)" 형태로, 없으면 안내 문구.
  const projectList = candidates.length
    ? candidates.map((c) => `- ${c.name} (${c.key})`).join('\n')
    : '- (후보 없음 — 위임 시 개인 작업으로 생성)';

  return (
    `[이벤트: messaging.message.posted]\n` +
    `${where}(channelId=${payload.channelId})에서 당신(AI)에게 메시지가 왔습니다.\n` +
    `보낸 사람: ${actorName}\n` +
    `메시지: "${payload.body}"\n\n` +
    `## 최근 대화 흐름 (오래된→최신)\n${thread || '(이전 메시지 없음)'}\n\n` +
    `더 과거 대화가 필요하면 get_channel_messages(${payload.channelId}). ` +
    `파악이 끝나면 add_channel_message(${payload.channelId}, 답변) 을 정확히 한 번 호출해 답하세요.\n\n` +
    `## 위임 가능 프로젝트\n${projectList}\n` +
    `사용자가 일을 이슈로 만들어 당신에게 맡기려 하면 propose_create_issue 를 호출하세요. ` +
    `대화 맥락에 맞는 프로젝트의 projectKey 를 위 목록에서 고르고(적합한 게 없으면 생략 → 개인 작업), 제목/본문/우선순위만 정하세요. 위치·담당은 시스템이 정합니다.`
  );
}
