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

// 7: messaging 프로필 도구 입력.
const getChannelMessagesInput = z.object({
  channelId: z.number().int().positive(),
});
const addChannelMessageInput = z.object({
  channelId: z.number().int().positive(),
  body: z.string().min(1),
});

// 7b: home 컴포저 표시 지시 도구 — 모든 도구가 균일한 {params?, layout?} 봉투를 받는다.
// layout: 캔버스 배치 규칙(프론트 7c 가 해석). page/replace/pageLabel 모두 선택.
const layoutSchema = z
  .object({
    page: z.enum(['new', 'current']).optional(),
    replace: z.string().optional(),
    pageLabel: z.string().optional(),
  })
  .optional();
// issue_list 필터(스펙 §4.1 검증 완료 범위). 전부 선택 — AI 가 의도에 맞는 것만 채운다.
const issueListParams = z
  .object({
    projectKey: z.string().optional(),
    status: z.string().optional(),
    priority: z.array(z.string()).optional(),
    label: z.string().optional(),
    type: z.string().optional(),
    dueFrom: z.string().optional(),
    dueTo: z.string().optional(),
    q: z.string().optional(),
    blocked: z.boolean().optional(),
    topLevel: z.boolean().optional(),
    assignee: z.string().optional(), // 'me' | '<id>'
    size: z.number().int().positive().optional(),
  })
  .optional();
const showMyTasksInput = z.object({ params: z.object({}).optional(), layout: layoutSchema });
const showIssueListInput = z.object({ params: issueListParams, layout: layoutSchema });
const showIssueDetailInput = z.object({
  params: z.object({ number: z.number().int().positive(), projectKey: z.string().optional() }),
  layout: layoutSchema,
});
const showActivityInput = z.object({
  params: z.object({ actorKind: z.enum(['HUMAN', 'AGENT']).optional() }).optional(),
  layout: layoutSchema,
});

export type McpProfile = 'issue' | 'chat' | 'home' | 'messaging';

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

  if (profile === 'messaging') {
    return [
      {
        name: 'get_channel_messages',
        description: '현재 채널/DM 의 최근 메시지 목록을 JSON 으로 반환합니다(대화 흐름 확인용).',
        inputSchema: getChannelMessagesInput,
        async handler(args) {
          const { channelId } = getChannelMessagesInput.parse(args);
          return JSON.stringify(await client.getChannelMessages(agentId, channelId, 50));
        },
      },
      {
        name: 'add_channel_message',
        description:
          '채널/DM 에 답변 메시지를 작성합니다. 본문은 마크다운 지원. 정확히 한 번만 호출하세요.',
        inputSchema: addChannelMessageInput,
        async handler(args) {
          const { channelId, body } = addChannelMessageInput.parse(args);
          await client.addChannelMessage(agentId, channelId, body);
          return 'ok';
        },
      },
    ];
  }

  // 7b: home 컴포저 — 표시 지시만(데이터 조회 X). 핸들러는 모두 {displayed:true}.
  if (profile === 'home') {
    const displayed = async () => JSON.stringify({ displayed: true });
    return [
      {
        name: 'show_my_tasks',
        description: '사용자의 할 일 요약 카드(담당/워치)를 화면에 표시합니다.',
        inputSchema: showMyTasksInput,
        handler: displayed,
      },
      {
        name: 'show_issue_list',
        description:
          '필터(params)에 맞는 이슈 목록을 화면에 표시합니다. assignee="me" 로 내 담당만, priority/status/dueTo 등으로 좁힙니다.',
        inputSchema: showIssueListInput,
        handler: displayed,
      },
      {
        name: 'show_issue_detail',
        description: '단일 이슈 상세(번호 지정)를 화면에 표시합니다.',
        inputSchema: showIssueDetailInput,
        handler: displayed,
      },
      {
        name: 'show_activity',
        description: '최근 활동 피드를 표시합니다. actorKind="AGENT" 면 AI 가 한 일만 봅니다.',
        inputSchema: showActivityInput,
        handler: displayed,
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
