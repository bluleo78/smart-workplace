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

  // #368: 이슈 제목·상태·본문을 user message 에 직접 주입한다. AGENT 는 프로젝트 비멤버라
  // get_issue_detail 이 403 으로 막히므로(이슈 컨텍스트 미인식의 근본 원인), 백엔드가 payload 로
  // 미리 전달한 컨텍스트를 1차 근거로 삼는다.
  const statusSuffix = payload.issueStatus ? ` (상태: ${payload.issueStatus})` : '';
  const bodyText = payload.issueBody && payload.issueBody.trim() ? payload.issueBody : '(본문 없음)';
  const issueContext =
    `## 현재 이슈 컨텍스트 (이 이슈에 대한 답변의 1차 근거)\n` +
    `이슈키: ${payload.issueKey}${statusSuffix}\n` +
    `제목: ${payload.issueTitle ?? '(제목 없음)'}\n` +
    `본문:\n${bodyText}\n`;

  return (
    `[이벤트: chat.message.posted]\n` +
    `이슈 ${payload.issueKey} 의 chat thread(threadId=${payload.threadId})에서 당신(AI)이 멘션됐습니다.\n` +
    `멘션한 사람: @${payload.actor.username}\n` +
    `멘션 메시지: "${payload.body}"\n\n` +
    `${issueContext}\n` +
    `## 최근 thread 흐름 (오래된→최신)\n${thread || '(이전 메시지 없음)'}\n\n` +
    `## 이슈 첨부파일\n${attachmentSection}\n\n` +
    `이슈 제목·상태·본문 관련 질문은 위 "현재 이슈 컨텍스트"를 근거로 답하세요(별도 조회 불필요). ` +
    `첨부가 있으면 Read 도구로 로컬경로를 직접 읽어 내용을 파악하세요(이미지/PDF/텍스트 모두 가능). ` +
    `더 과거 대화가 필요하면 get_chat_thread(${payload.threadId}). ` +
    `파악이 끝나면 add_chat_message(${payload.threadId}, 답변) 을 정확히 한 번 호출해 답하세요.`
  );
}
