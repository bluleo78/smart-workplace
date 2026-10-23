// src/reaction-tools.ts — 이모지 반응 도구(WP-812). 채팅 메시지와 이슈 코멘트에 같은 `react` 하나로 반응한다.
// 예전엔 채팅만 react_to_message 였다(WP-421 에서 추가·제거를 합침). 코멘트 반응(WP-504)을 도구로 열면서 도구를 따로 만들면 이슈·메시징 앱이
// 모두 앱당 도구 상한(16)에 차 있어 둘 다 한 자리씩 더 써야 하므로, 대상만 다른 한 도구로 통합했다(이슈·메시징 두 앱에 태그).
import { z } from 'zod';
import type { SharedTool } from './mcp-tool.js';
import type { IssueToolClient, MessagingToolClient } from './tool-client.js';

/**
 * react 입력. 서버는 이모지를 1~32자 문자열로만 검사하고(ReactionRequest·CommentReactionRequest) 웹 선택기는 유니코드 문자를 보낸다.
 * 제거는 추가한 것과 같은 문자열이어야 한다 — 읽기 출력 reactions 의 키 그대로다.
 * 대상은 둘 중 하나: 채팅 메시지(messageId) 또는 이슈 코멘트(issueKey + commentId). reacted 는 최종 상태라 필수다
 * (빠뜨리면 추가인지 제거인지 모호해 거절, 같은 값을 다시 보내도 결과가 같아 멱등).
 */
export const reactInput = z
  .object({
    emoji: z.string().min(1).max(32).describe('Unicode emoji such as 👍; to remove, the exact string shown in reactions'),
    reacted: z.boolean().describe('true adds my reaction, false removes it'),
    messageId: z.number().int().positive().optional().describe('Chat message: its id as read from channel or thread messages'),
    issueKey: z.string().min(1).optional().describe('Issue comment: issue key, together with commentId'),
    commentId: z.number().int().positive().optional().describe('Issue comment: its id as read from the issue detail comments'),
  })
  // 모델이 고칠 수 있게 어긋난 경우마다 다른 문장을 준다(한 문장이면 같은 실수를 되풀이한다).
  .superRefine((v, ctx) => {
    const hasComment = v.issueKey !== undefined || v.commentId !== undefined;
    if (v.messageId !== undefined && hasComment) {
      ctx.addIssue({ code: 'custom', message: 'messageId (chat message) cannot be combined with issueKey/commentId (issue comment); send only one target' });
    } else if (v.messageId === undefined && !hasComment) {
      ctx.addIssue({ code: 'custom', message: 'give a target: messageId (chat message) or issueKey + commentId (issue comment)' });
    } else if (v.messageId === undefined && (v.issueKey === undefined || v.commentId === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'an issue comment needs both issueKey and commentId' });
    }
  });

/** 반응 도구(react). 클라이언트는 이슈·메시징 양쪽이 필요하다. */
export function buildReactionTools(client: IssueToolClient & MessagingToolClient): SharedTool[] {
  return [
    {
      name: 'react',
      app: ['issue', 'messaging'],
      kind: 'write',
      // 서버가 이미 있는 추가·없는 제거를 이벤트 없이 무시해 멱등이고, 제거 갈래가 있어 destructive 다(README 노출 기준).
      // 채팅은 누른 사람에게 알림이 가지 않는다. 어떤 때 반응을 달지는 규칙으로 정하지 않고 모델 판단에 맡긴다(WP-812).
      hints: { destructive: true, idempotent: true },
      description:
        'Adds (reacted: true) or removes (false) my emoji reaction on a chat message (messageId) in a channel or DM I belong to, or on an issue comment ' +
        '(issueKey + commentId) I can write to; repeating is a no-op. Reactions show on reads as {emoji: count}.',
      inputSchema: reactInput,
      async handler(args) {
        const { emoji, reacted, messageId, issueKey, commentId } = reactInput.parse(args);
        if (messageId !== undefined) {
          if (reacted) await client.addReaction(messageId, emoji);
          else await client.removeReaction(messageId, emoji);
        } else if (reacted) {
          await client.addCommentReaction(issueKey as string, commentId as number, emoji);
        } else {
          await client.removeCommentReaction(issueKey as string, commentId as number, emoji);
        }
        return 'ok';
      },
    },
  ];
}
