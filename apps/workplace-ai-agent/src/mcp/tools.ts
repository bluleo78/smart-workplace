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

export function buildTools(client: WorkplaceApiClient, agentId: number): McpTool[] {
  return [
    {
      name: 'get_issue_detail',
      description:
        '이슈의 본문·상태·담당자·코멘트 등 전체 컨텍스트를 JSON 으로 반환합니다.',
      inputSchema: issueKey,
      async handler(args) {
        const { issueKey: k } = issueKey.parse(args);
        const detail = await client.getIssueDetail(agentId, k);
        return JSON.stringify(detail);
      },
    },
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
