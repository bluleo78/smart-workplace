// 4 MCP 도구 정의 — 모든 호출에 agentId 가 closure 로 바인딩 (#34).
import { z } from 'zod';

import type { WorkplaceApiClient } from '../clients/workplace-api.js';

export interface McpTool {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  handler: (args: unknown) => Promise<string>;
}

const issueKey = z.object({ issueKey: z.string().min(1) });
const addCommentInput = z.object({
  issueKey: z.string().min(1),
  body: z.string().min(1),
});
const updateStatusInput = z.object({
  issueKey: z.string().min(1),
  status: z.enum(['TODO', 'IN_PROGRESS', 'DONE', 'CANCELED']),
});
// 6c: chat 프로필 도구 입력.
const addChatMessageInput = z.object({
  threadId: z.number().int().positive(),
  body: z.string().min(1),
});
const getChatThreadInput = z.object({
  threadId: z.number().int().positive(),
});

export type McpProfile = 'issue' | 'chat';

// profile 기본값 'issue' — 이슈 핸들러는 기존 4 도구, chat 핸들러는 읽기+chat 쓰기 도구만.
export function buildTools(
  client: WorkplaceApiClient,
  agentId: number,
  profile: McpProfile = 'issue',
): McpTool[] {
  const getIssueDetailTool: McpTool = {
    name: 'get_issue_detail',
    description: '이슈의 본문·상태·담당자·코멘트 등 전체 컨텍스트를 JSON 으로 반환합니다.',
    inputSchema: issueKey,
    async handler(args) {
      const { issueKey: k } = issueKey.parse(args);
      const detail = await client.getIssueDetail(agentId, k);
      return JSON.stringify(detail);
    },
  };

  if (profile === 'chat') {
    return [
      getIssueDetailTool,
      {
        name: 'get_chat_thread',
        description: '현재 chat thread 의 최근 메시지 목록을 JSON 으로 반환합니다(과거 흐름 확인용).',
        inputSchema: getChatThreadInput,
        async handler(args) {
          const { threadId } = getChatThreadInput.parse(args);
          return JSON.stringify(await client.getChatMessages(agentId, threadId, 50));
        },
      },
      {
        name: 'add_chat_message',
        description:
          'chat thread 에 답변 메시지를 작성합니다. 본문은 마크다운 지원. 정확히 한 번만 호출하세요.',
        inputSchema: addChatMessageInput,
        async handler(args) {
          const { threadId, body } = addChatMessageInput.parse(args);
          await client.addChatMessage(agentId, threadId, body);
          return 'ok';
        },
      },
    ];
  }

  return [
    getIssueDetailTool,
    {
      name: 'add_comment',
      description: '이슈에 코멘트를 작성합니다. 본문은 마크다운을 지원합니다.',
      inputSchema: addCommentInput,
      async handler(args) {
        const { issueKey: k, body } = addCommentInput.parse(args);
        await client.addIssueComment(agentId, k, body);
        return 'ok';
      },
    },
    {
      name: 'update_status',
      description:
        '이슈의 상태를 변경합니다. 허용값: TODO / IN_PROGRESS / DONE / CANCELED.',
      inputSchema: updateStatusInput,
      async handler(args) {
        const { issueKey: k, status } = updateStatusInput.parse(args);
        await client.updateIssueStatus(agentId, k, status);
        return 'ok';
      },
    },
    {
      name: 'unassign_self',
      description:
        '자기 자신을 이슈 담당자에서 제외합니다. 작업 완료·반려 시 사용합니다.',
      inputSchema: issueKey,
      async handler(args) {
        const { issueKey: k } = issueKey.parse(args);
        await client.unassignSelf(agentId, k);
        return 'ok';
      },
    },
  ];
}
