// 6c: chat.message.posted → Claude CLI user message. trigger + thread 흐름 + 첨부 manifest.
import type { ChatMessagePostedPayload } from '../types/chat-events.js';
import type { ChatMessageItem } from '../clients/workplace-api.js';
import type { AttachmentManifestEntry } from './attachment-prep.js';

export function buildChatUserMessage(
  payload: ChatMessagePostedPayload,
  recentMessages: ChatMessageItem[],
  attachments: AttachmentManifestEntry[],
): string {
  // 오래된→최신 순으로 노출 (목록은 보통 최신 DESC 로 오므로 id 오름차순 정렬).
  const ordered = [...recentMessages].sort((a, b) => a.id - b.id);
  const thread = ordered
    .map(
      (m) =>
        `- [${m.authorName}${m.authorKind === 'AGENT' ? '/AI' : ''}] ${m.deleted ? '(삭제됨)' : m.body}`,
    )
    .join('\n');

  const attachmentSection =
    attachments.length === 0
      ? '첨부 없음'
      : attachments
          .map((a) =>
            a.skipped
              ? `- ${a.originalName} (${a.mimeType}, ${a.sizeBytes}B) — 건너뜀: ${a.skipReason}`
              : `- ${a.originalName} (${a.mimeType}, ${a.sizeBytes}B) → 로컬경로: ${a.localPath}`,
          )
          .join('\n');

  return (
    `[이벤트: chat.message.posted]\n` +
    `이슈 ${payload.issueKey} 의 chat thread(threadId=${payload.threadId})에서 당신(AI)이 멘션됐습니다.\n` +
    `멘션한 사람: @${payload.actor.username}\n` +
    `멘션 메시지: "${payload.body}"\n\n` +
    `## 최근 thread 흐름 (오래된→최신)\n${thread || '(이전 메시지 없음)'}\n\n` +
    `## 이슈 첨부파일\n${attachmentSection}\n\n` +
    `첨부가 있으면 Read 도구로 로컬경로를 직접 읽어 내용을 파악하세요(이미지/PDF/텍스트 모두 가능). ` +
    `이슈 본문·코멘트가 필요하면 get_issue_detail('${payload.issueKey}'). ` +
    `더 과거 대화가 필요하면 get_chat_thread(${payload.threadId}). ` +
    `파악이 끝나면 add_chat_message(${payload.threadId}, 답변) 을 정확히 한 번 호출해 답하세요.`
  );
}
