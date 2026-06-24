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

  // 후보가 있으면 각 항목을 "- 이름 (KEY)" 형태로, 없으면 멤버 추가 요청 안내.
  // AI 가 멤버로 등록된 프로젝트가 없으면 propose_create_issue 호출 금지 — 개인 폴백 없음.
  const projectList = candidates.length
    ? candidates.map((c) => `- ${c.name} (${c.key})`).join('\n')
    : '- (없음) — 사용자가 일을 위임하려 하면 propose_create_issue 를 호출하지 말고, "먼저 프로젝트에 저를 멤버로 추가해 주세요" 라고 답하세요.';

  return (
    `[이벤트: messaging.message.posted]\n` +
    `${where}(channelId=${payload.channelId})에서 당신(AI)에게 메시지가 왔습니다.\n` +
    `보낸 사람: ${actorName}\n` +
    `메시지: "${payload.body}"\n\n` +
    `## 최근 대화 흐름 (오래된→최신)\n${thread || '(이전 메시지 없음)'}\n\n` +
    `더 과거 대화가 필요하면 get_channel_messages(${payload.channelId}). ` +
    `파악이 끝나면 add_channel_message(${payload.channelId}, 답변) 을 정확히 한 번 호출해 답하세요.\n\n` +
    `## 위임 가능 프로젝트\n${projectList}\n` +
    `사용자가 일을 이슈로 만들어 당신에게 맡기려 하면 위 목록에서 projectKey 를 골라 propose_create_issue 를 호출하세요. ` +
    `제목/본문/우선순위만 정하세요. 위치·담당은 시스템이 정합니다. 목록이 비어있으면 위 안내대로 멤버 추가를 요청하세요.`
  );
}
