// 6c: chat.message.posted → Claude CLI user message. trigger + thread 흐름 + 첨부(러너별 표현, WP-244).
import type { ChatMessagePostedPayload } from '../types/chat-events.js';
import type { ChatMessageItem } from '../clients/workplace-api.js';
import type { PresentedAttachments } from './attachment-presenter.js';
import { statusDisplay } from './status-display.js';
import { formatKstShort, headUtf16, oneLine } from './text-format.js';

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
  // 자르기는 지시문 글 상한과 같은 서로게이트 규칙(text-format.headUtf16)을 쓴다 — 표식이 잘린 글자 수를 알려야 해 「…」 붙이는 clip 대신 앞부분만 받는다.
  const head = headUtf16(body, CHAT_ISSUE_BODY_MAX_CHARS);
  const cut = head.length;
  const omitted = body.length - cut;
  return (
    `${head}\n` +
    `…(본문이 길어 앞 ${cut}자만 포함했고 이하 ${omitted}자는 생략됨. 뒷부분이 필요하면 get_issue_detail(${issueKey}) 로 전체 본문을 조회하세요. ` +
    `권한 오류로 조회되지 않으면 추측하지 말고 사용자에게 해당 부분을 알려 달라고 요청하세요)`
  );
}

// WP-1375: 반복 업무 이슈면 이슈 컨텍스트 아래에 붙이는 블록 — 이슈챗 AI 가 「이 글이 다음 회차에 전달된다」는 사실을 알고 답하게 한다.
// 다음 실행은 enabled=false 면 저장값이 있어도 「없음(꺼짐)」(꺼진 반복은 안 돈다), 켜져 있어도 값이 없으면 「없음」. rrule 은 사람말 변환기가
// agent 에 없어 원문을 그대로 쓴다. 반복이 아니면(recurrence 없음) 빈 문자열.
function recurrenceBlock(r: ChatMessagePostedPayload['recurrence']): string {
  if (!r) return '';
  const when = r.rrule ? `${r.rrule} ${r.time}` : r.time;
  const next = !r.enabled ? '없음(꺼짐)' : r.nextRunAt ? `${formatKstShort(r.nextRunAt)} KST` : '없음';
  // 맡긴 사람 — 회차는 이 사람의 결정만 따르므로, 이슈챗 AI 가 글쓴이가 맡긴 사람인지 보고 답하게 한다. 이름 속 줄바꿈은 공백으로(가짜 줄 방지).
  const owner = r.ownerName ? oneLine(r.ownerName) : '알 수 없음';
  return (
    `\n## 반복 업무\n` +
    `- 이 이슈는 AI 에게 맡긴 반복 업무입니다(${when}, 맡긴 사람 ${owner}, 담당 AI ${r.agentName != null ? oneLine(r.agentName) : '미지정'}, 다음 실행 ${next}).\n` +
    // 꺼진 반복은 다음 회차가 없어 글이 전달되지 않는다 — 전달된다고 답하지 않게 안내를 바꾼다.
    (r.enabled
      ? `- 이슈챗에 사람이 남긴 최근 글(최대 20건, 길면 오래된 것부터 생략)이 다음 회차에 함께 전달됩니다. 회차는 맡긴 사람의 결정만 따릅니다.\n`
      : `- 지금은 반복이 꺼져 있어 다음 회차가 없습니다.\n`)
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
    `${issueContext}${recurrenceBlock(payload.recurrence)}\n` +
    `## 최근 thread 흐름 (오래된→최신)\n${thread || '(이전 메시지 없음)'}\n\n` +
    `## 첨부파일\n${presented.section}\n\n` +
    `이슈 제목·상태·본문 관련 질문은 위 "현재 이슈 컨텍스트"를 근거로 답하세요(별도 조회 불필요). ` +
    (presented.guidance ? `${presented.guidance} ` : '') +
    `더 과거 대화가 필요하면 list_chat_messages(${payload.threadId}). ` +
    `파악이 끝나면 add_chat_message(${payload.threadId}, 답변) 을 정확히 한 번 호출해 답하세요.`
  );
}
