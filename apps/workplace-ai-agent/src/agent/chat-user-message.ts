// 6c: chat.message.posted → Claude CLI user message. trigger + thread 흐름 + 첨부(러너별 표현, WP-244).
import type { ChatMessagePostedPayload } from '../types/chat-events.js';
import type { ChatMessageItem } from '../clients/workplace-api.js';
import type { PresentedAttachments } from './attachment-presenter.js';
import { statusDisplay } from './status-display.js';

/**
 * 이슈 본문을 user message 에 넣는 최대 글자 수(WP-885).
 * 왜: 이슈 본문 상한이 5만자로 올라 매 챗 턴마다 본문 전체를 실으면, opencode 러너 모델 컨텍스트(65,536 토큰,
 * opencode-vision.ts 참고) 대부분을 본문 하나가 차지한다. 질문 대부분은 앞부분으로 충분하므로 2만자에서 자르고,
 * 나머지는 get_issue_detail 로 읽게 안내한다.
 */
export const CHAT_ISSUE_BODY_MAX_CHARS = 20_000;

/** 본문이 상한을 넘으면 앞부분만 남기고 잘렸다는 표식(+ 나머지를 읽는 방법)을 붙인다. 서로게이트 쌍은 쪼개지 않는다. */
export function truncateIssueBodyForChat(body: string, issueKey: string): string {
  if (body.length <= CHAT_ISSUE_BODY_MAX_CHARS) return body;
  let cut = CHAT_ISSUE_BODY_MAX_CHARS;
  if (body.charCodeAt(cut - 1) >= 0xd800 && body.charCodeAt(cut - 1) <= 0xdbff) cut -= 1;
  const omitted = body.length - cut;
  return (
    `${body.slice(0, cut)}\n` +
    `…(본문이 길어 앞 ${cut}자만 포함했고 이하 ${omitted}자는 생략됨. 뒷부분이 필요하면 get_issue_detail(${issueKey}) 로 전체 본문을 조회하세요. ` +
    `권한 오류로 조회되지 않으면 추측하지 말고 사용자에게 해당 부분을 알려 달라고 요청하세요)`
  );
}

export function buildChatUserMessage(
  payload: ChatMessagePostedPayload,
  recentMessages: ChatMessageItem[],
  presented: PresentedAttachments,
): string {
  // 오래된→최신 순으로 노출 (목록은 보통 최신 DESC 로 오므로 id 오름차순 정렬).
  const ordered = [...recentMessages].sort((a, b) => a.id - b.id);
  const thread = ordered
    .map(
      (m) =>
        `- [${m.authorName}${m.authorKind === 'AGENT' ? '/AI' : ''}] ${m.deleted ? '(삭제됨)' : m.body}`,
    )
    .join('\n');

  // #368: 이슈 제목·상태·본문을 user message 에 직접 주입한다. AGENT 는 프로젝트 비멤버라
  // get_issue_detail 이 403 으로 막히므로(이슈 컨텍스트 미인식의 근본 원인), 백엔드가 payload 로
  // 미리 전달한 컨텍스트를 1차 근거로 삼는다.
  // WP-869: 상태 이름이 있으면 범주와 함께 보인다(statusDisplay).
  const statusSuffix = payload.issueStatus ? ` (상태: ${statusDisplay(payload.issueStatus, payload.issueStatusName)})` : '';
  const bodyText =
    payload.issueBody && payload.issueBody.trim()
      ? truncateIssueBodyForChat(payload.issueBody, payload.issueKey)
      : '(본문 없음)';
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
    `## 첨부파일\n${presented.section}\n\n` +
    `이슈 제목·상태·본문 관련 질문은 위 "현재 이슈 컨텍스트"를 근거로 답하세요(별도 조회 불필요). ` +
    (presented.guidance ? `${presented.guidance} ` : '') +
    `더 과거 대화가 필요하면 list_chat_messages(${payload.threadId}). ` +
    `파악이 끝나면 add_chat_message(${payload.threadId}, 답변) 을 정확히 한 번 호출해 답하세요.`
  );
}
