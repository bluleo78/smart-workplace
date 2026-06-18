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

// S2: 위키 읽기 그라운딩 도구 입력.
const searchWikiInput = z.object({ query: z.string().min(1) });
const getWikiPageInput = z.object({ pageId: z.number().int().positive() });

// #333 M3: 위키 쓰기 도구 입력.
const createWikiPageInput = z.object({
  spaceId: z.number().int().positive(),
  title: z.string().min(1).max(255),
  parentId: z.number().int().positive().optional(),
});
const updateWikiPageInput = z.object({
  pageId: z.number().int().positive(),
  version: z.number().int().min(1), // 낙관적 동시성 — get_wiki_page 의 version 을 그대로 넣는다.
  title: z.string().max(255).optional(),
  body: z.string().optional(),
});

// #333 M2: 캘린더 읽기 도구 입력.
const listEventsInput = z.object({ from: z.string().min(1), to: z.string().min(1) });
const getEventInput = z.object({ id: z.number().int().positive() });

// #333 M3: 연락처 입력.
const listContactsInput = z.object({
  search: z.string().optional(),
  type: z.enum(['MEMBER', 'EXTERNAL']).optional(),
  limit: z.number().int().min(1).max(100).default(20),
});
const getExternalContactInput = z.object({ id: z.number().int().positive() });
const externalContactFields = {
  name: z.string().min(1).max(120),
  email: z.string().max(255).optional(),
  phone: z.string().max(40).optional(),
  organization: z.string().max(120).optional(),
  title: z.string().max(100).optional(),
  notes: z.string().optional(),
  visibility: z.enum(['SHARED', 'PERSONAL']),
};
const createExternalContactInput = z.object(externalContactFields);
const updateExternalContactInput = z.object({ id: z.number().int().positive(), ...externalContactFields });
const proposeDeleteContactInput = z.object({ id: z.number().int().positive(), summary: z.string().min(1) });

// #333 M3: 프로젝트 읽기/제안 입력.
const listProjectsInput = z.object({ page: z.number().int().min(0).default(0), size: z.number().int().min(1).max(100).default(20) });
const getProjectInput = z.object({ key: z.string().min(1) });
const listProjectMembersInput = z.object({ key: z.string().min(1) });
const proposeCreateProjectInput = z.object({
  key: z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  type: z.string().optional(),
  summary: z.string().min(1),
});
const proposeDeleteProjectInput = z.object({ key: z.string().min(1), summary: z.string().min(1) });
const proposeAddProjectMemberInput = z.object({
  key: z.string().min(1),
  userId: z.number().int().positive(),
  role: z.enum(['OWNER', 'MEMBER']),
  summary: z.string().min(1),
});

// #333 M3: 드라이브 읽기 입력(v1 — 읽기 전용).
const listDriveItemsInput = z.object({ spaceId: z.number().int().positive(), parentId: z.number().int().positive().optional() });
const searchDriveInput = z.object({ spaceId: z.number().int().positive(), q: z.string().min(1) });

// #333 M3: 메일 읽기 입력.
const listMailInput = z.object({
  accountId: z.number().int().positive(),
  folder: z.string().default('INBOX'),
  query: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});
const getMailInput = z.object({ messageId: z.number().int().positive() });
// #333 M3: 메일 발송 제안 입력 — MailSendRequest 미러 + accountId(소유권 경계) + summary(카드 본문).
const proposeSendMailInput = z.object({
  accountId: z.number().int().positive(),
  to: z.array(z.string()).min(1),
  cc: z.array(z.string()).optional(),
  bcc: z.array(z.string()).optional(),
  subject: z.string().optional(),
  bodyText: z.string().optional(),
  bodyHtml: z.string().optional(),
  inReplyToMessageId: z.number().int().positive().optional(),
  summary: z.string().min(1),
});

// #333 M2: 일정 생성 제안 입력 — CalendarEventRequest 와 1:1(서버 매핑 단순화) + summary(카드 본문).
const proposeCreateEventInput = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  startsAt: z.string().min(1),   // ISO-8601
  endsAt: z.string().min(1),
  allDay: z.boolean().default(false),
  location: z.string().max(200).optional(),
  reminderMinutes: z.number().int().min(0).optional(),
  recurrenceRule: z.string().max(500).optional(),
  summary: z.string().min(1),    // 사람이 읽는 카드 요약
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

// #333: assistant 프로파일 추가 — 전 앱 도구 union(M1).
export type McpProfile = 'issue' | 'chat' | 'home' | 'messaging' | 'assistant';

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

  // 위키 읽기 그라운딩 도구(S2) — issue·chat 프로필 공용
  const searchWikiTool: McpTool = {
    name: 'search_wiki',
    description:
      '위키 페이지를 제목·본문으로 검색합니다. 접근 가능한 스페이스만 대상이며, 결과 JSON 배열(id·spaceName·title·snippet)을 반환합니다. 근거가 필요하면 먼저 검색하세요.',
    inputSchema: searchWikiInput,
    async handler(args) {
      const { query } = searchWikiInput.parse(args);
      return JSON.stringify(await client.searchWikiPages(agentId, query));
    },
  };
  const getWikiPageTool: McpTool = {
    name: 'get_wiki_page',
    description:
      '위키 페이지 본문 전체를 JSON(title·body·version 등)으로 반환합니다. search_wiki 결과의 id 로 호출하세요.',
    inputSchema: getWikiPageInput,
    async handler(args) {
      const { pageId } = getWikiPageInput.parse(args);
      return JSON.stringify(await client.getWikiPage(agentId, pageId));
    },
  };

  if (profile === 'chat') {
    return [
      getIssueDetailTool,
      searchWikiTool,
      getWikiPageTool,
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

  // #333 M3: 채널 읽기/쓰기 도구 — messaging/assistant 프로파일 공유.
  const getChannelMessagesTool: McpTool = {
    name: 'get_channel_messages',
    description: '현재 채널/DM 의 최근 메시지 목록을 JSON 으로 반환합니다(대화 흐름 확인용).',
    inputSchema: getChannelMessagesInput,
    async handler(args) {
      const { channelId } = getChannelMessagesInput.parse(args);
      return JSON.stringify(await client.getChannelMessages(agentId, channelId, 50));
    },
  };
  const addChannelMessageTool: McpTool = {
    name: 'add_channel_message',
    description:
      '채널/DM 에 답변 메시지를 작성합니다. 본문은 마크다운 지원. 정확히 한 번만 호출하세요.',
    inputSchema: addChannelMessageInput,
    async handler(args) {
      const { channelId, body } = addChannelMessageInput.parse(args);
      await client.addChannelMessage(agentId, channelId, body);
      return 'ok';
    },
  };

  if (profile === 'messaging') {
    return [getChannelMessagesTool, addChannelMessageTool];
  }

  // 7b: home 표시 지시 도구(데이터 조회 X). home/assistant 프로파일이 공유한다.
  // 핸들러는 모두 {displayed:true} — 실제 렌더링은 프론트엔드가 담당.
  const buildShowTools = (): McpTool[] => {
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
  };

  // 기존 이슈 쓰기 도구 — issue/assistant 프로파일이 공유한다.
  const addCommentTool: McpTool = {
    name: 'add_comment',
    description: '이슈에 코멘트를 작성합니다. 본문은 마크다운을 지원합니다.',
    inputSchema: addCommentInput,
    async handler(args) {
      const { issueKey: k, body } = addCommentInput.parse(args);
      await client.addIssueComment(agentId, k, body);
      return 'ok';
    },
  };
  const updateStatusTool: McpTool = {
    name: 'update_status',
    description: '이슈의 상태를 변경합니다. 허용값: TODO / IN_PROGRESS / DONE / CANCELED.',
    inputSchema: updateStatusInput,
    async handler(args) {
      const { issueKey: k, status } = updateStatusInput.parse(args);
      await client.updateIssueStatus(agentId, k, status);
      return 'ok';
    },
  };
  const unassignSelfTool: McpTool = {
    name: 'unassign_self',
    description: '자기 자신을 이슈 담당자에서 제외합니다. 작업 완료·반려 시 사용합니다.',
    inputSchema: issueKey,
    async handler(args) {
      const { issueKey: k } = issueKey.parse(args);
      await client.unassignSelf(agentId, k);
      return 'ok';
    },
  };

  // 7b: home 컴포저 — 표시 지시만(데이터 조회 X).
  if (profile === 'home') {
    return buildShowTools();
  }

  // #333 M2: 캘린더 읽기 도구 — assistant 프로파일 전용(일정 충돌 확인·요약).
  const listEventsTool: McpTool = {
    name: 'list_events',
    description: '[from,to) 기간(ISO-8601)의 내 일정 목록을 JSON 으로 반환합니다. 일정 충돌 확인·요약에 사용하세요.',
    inputSchema: listEventsInput,
    async handler(args) {
      const { from, to } = listEventsInput.parse(args);
      return JSON.stringify(await client.listEvents(agentId, from, to));
    },
  };
  const getEventTool: McpTool = {
    name: 'get_event',
    description: '단일 일정 상세를 JSON 으로 반환합니다. list_events 결과의 id 로 호출하세요.',
    inputSchema: getEventInput,
    async handler(args) {
      const { id } = getEventInput.parse(args);
      return JSON.stringify(await client.getEvent(agentId, id));
    },
  };

  // #333 M2: 일정 생성 제안 도구 — API 미호출, 사이드카에 제안 객체를 쓰고 ack 반환.
  const proposeCreateEventTool: McpTool = {
    name: 'propose_create_event',
    description:
      '일정 생성을 제안합니다. 직접 생성하지 않고 사용자 확인 카드용 제안만 만듭니다. summary 에 사람이 읽을 한 줄 요약(일시·제목)을 넣으세요. 승인 시 서버가 실제로 생성합니다.',
    inputSchema: proposeCreateEventInput,
    async handler(args) {
      const { summary, ...params } = proposeCreateEventInput.parse(args);
      const sidecarPath = process.env.WORKPLACE_PENDING_ACTION_PATH;
      if (!sidecarPath) {
        // 사이드카 경로 미주입 — 확인 플로우 비활성. 서브에이전트에 사유 반환.
        return '확인 플로우가 설정되지 않아 제안을 등록하지 못했습니다.';
      }
      // 제안 객체를 사이드카에 기록(메인이 done 후 읽어 pending_action 으로 발행).
      const { writeFileSync } = await import('node:fs');
      writeFileSync(sidecarPath, JSON.stringify({ actionType: 'calendar.create_event', summary, params }), 'utf8');
      return '일정 생성 제안을 등록했습니다. 사용자 확인을 기다립니다.';
    },
  };

  // #333 M3: 위키 쓰기 도구 — 스페이스 멤버십 가드는 서버가 강제하므로 propose/confirm 없이 직접 노출.
  const createWikiPageTool: McpTool = {
    name: 'create_wiki_page',
    description: '위키 스페이스에 새 페이지를 생성합니다. parentId 를 주면 그 하위에 만듭니다. 생성된 페이지(id·version)를 JSON 으로 반환합니다.',
    inputSchema: createWikiPageInput,
    async handler(args) {
      const { spaceId, title, parentId } = createWikiPageInput.parse(args);
      return JSON.stringify(await client.createWikiPage(agentId, spaceId, title, parentId));
    },
  };
  const updateWikiPageTool: McpTool = {
    name: 'update_wiki_page',
    description:
      '위키 페이지 제목·본문을 저장합니다. version 은 반드시 get_wiki_page 로 읽은 현재 version 을 넣어야 합니다(낙관적 동시성). 충돌(409)이면 다시 읽고 재시도 여부를 사용자에게 확인하세요.',
    inputSchema: updateWikiPageInput,
    async handler(args) {
      const { pageId, version, title, body } = updateWikiPageInput.parse(args);
      return JSON.stringify(await client.updateWikiPage(agentId, pageId, version, title, body));
    },
  };

  // #333 M3: 메일 읽기 도구 — assistant 프로파일 전용.
  const listMailTool: McpTool = {
    name: 'list_mail',
    description: '메일 계정의 폴더 메시지 목록을 JSON 으로 반환합니다. query 로 검색, folder 기본 INBOX. accountId 는 사용자의 메일 계정 id 입니다.',
    inputSchema: listMailInput,
    async handler(args) {
      const { accountId, folder, query, limit } = listMailInput.parse(args);
      return JSON.stringify(await client.listMail(agentId, accountId, folder, query, limit));
    },
  };
  const getMailTool: McpTool = {
    name: 'get_mail',
    description: '단일 메일 본문(텍스트/HTML)을 JSON 으로 반환합니다. list_mail 결과의 id 로 호출하세요.',
    inputSchema: getMailInput,
    async handler(args) {
      const { messageId } = getMailInput.parse(args);
      return JSON.stringify(await client.getMail(agentId, messageId));
    },
  };
  // #333 M3: 메일 발송 제안 도구 — propose_create_event 미러. API 미호출, 사이드카에 제안 기록 후 ack 반환.
  const proposeSendMailTool: McpTool = {
    name: 'propose_send_mail',
    description:
      '메일 발송을 제안합니다. 직접 발송하지 않고 사용자 확인 카드용 제안만 만듭니다. summary 에 사람이 읽을 한 줄 요약(수신자·제목)을 넣으세요. accountId 는 발신 계정(본인 소유)입니다. 승인 시 서버가 실제로 발송합니다.',
    inputSchema: proposeSendMailInput,
    async handler(args) {
      const { summary, ...params } = proposeSendMailInput.parse(args);
      const sidecarPath = process.env.WORKPLACE_PENDING_ACTION_PATH;
      if (!sidecarPath) {
        // 사이드카 경로 미주입 — 확인 플로우 비활성. 서브에이전트에 사유 반환.
        return '확인 플로우가 설정되지 않아 제안을 등록하지 못했습니다.';
      }
      // 제안 객체를 사이드카에 기록(메인이 done 후 읽어 pending_action 으로 발행).
      const { writeFileSync } = await import('node:fs');
      writeFileSync(sidecarPath, JSON.stringify({ actionType: 'mail.send', summary, params }), 'utf8');
      return '메일 발송 제안을 등록했습니다. 사용자 확인을 기다립니다.';
    },
  };

  // #333 M3: 연락처 읽기/쓰기/삭제제안 도구 — assistant 프로파일 전용.
  const listContactsTool: McpTool = {
    name: 'list_contacts',
    description: '연락처(멤버+외부) 목록을 JSON 으로 반환합니다. search 로 이름·이메일 검색, type 으로 MEMBER/EXTERNAL 한정.',
    inputSchema: listContactsInput,
    async handler(args) {
      const { search, type, limit } = listContactsInput.parse(args);
      return JSON.stringify(await client.listContacts(agentId, search, type, limit));
    },
  };
  const getExternalContactTool: McpTool = {
    name: 'get_external_contact',
    description: '외부 연락처 단건 상세를 JSON 으로 반환합니다.',
    inputSchema: getExternalContactInput,
    async handler(args) {
      const { id } = getExternalContactInput.parse(args);
      return JSON.stringify(await client.getExternalContact(agentId, id));
    },
  };
  const createExternalContactTool: McpTool = {
    name: 'create_external_contact',
    description: '외부 연락처를 생성합니다. visibility 는 SHARED(공유)/PERSONAL(개인). 생성 결과를 JSON 으로 반환합니다.',
    inputSchema: createExternalContactInput,
    async handler(args) {
      const input = createExternalContactInput.parse(args);
      return JSON.stringify(await client.createExternalContact(agentId, input));
    },
  };
  const updateExternalContactTool: McpTool = {
    name: 'update_external_contact',
    description: '외부 연락처를 수정합니다(전체 교체). 모든 필드를 현재 값 기준으로 채워 보내세요.',
    inputSchema: updateExternalContactInput,
    async handler(args) {
      const { id, ...input } = updateExternalContactInput.parse(args);
      return JSON.stringify(await client.updateExternalContact(agentId, id, input));
    },
  };
  const proposeDeleteContactTool: McpTool = {
    name: 'propose_delete_contact',
    description: '외부 연락처 삭제를 제안합니다. 직접 삭제하지 않고 확인 카드용 제안만 만듭니다. summary 에 어떤 연락처를 지우는지 한 줄로 넣으세요. 승인 시 서버가 삭제합니다.',
    inputSchema: proposeDeleteContactInput,
    async handler(args) {
      const { summary, ...params } = proposeDeleteContactInput.parse(args);
      const sidecarPath = process.env.WORKPLACE_PENDING_ACTION_PATH;
      if (!sidecarPath) {
        // 사이드카 경로 미주입 — 확인 플로우 비활성. 서브에이전트에 사유 반환.
        return '확인 플로우가 설정되지 않아 제안을 등록하지 못했습니다.';
      }
      // 제안 객체를 사이드카에 기록(메인이 done 후 읽어 pending_action 으로 발행).
      const { writeFileSync } = await import('node:fs');
      writeFileSync(sidecarPath, JSON.stringify({ actionType: 'contacts.delete_contact', summary, params }), 'utf8');
      return '연락처 삭제 제안을 등록했습니다. 사용자 확인을 기다립니다.';
    },
  };

  // #333 M3: 프로젝트 읽기 도구 — assistant 프로파일 전용. 쓰기는 confirm 실행기(에이전트는 propose 만).
  const listProjectsTool: McpTool = {
    name: 'list_projects',
    description: '프로젝트 목록을 JSON 으로 반환합니다. page/size 로 페이지네이션합니다.',
    inputSchema: listProjectsInput,
    async handler(args) {
      const { page, size } = listProjectsInput.parse(args);
      return JSON.stringify(await client.listProjects(agentId, page, size));
    },
  };
  const getProjectTool: McpTool = {
    name: 'get_project',
    description: '프로젝트 상세(key·name·description·type)를 JSON 으로 반환합니다.',
    inputSchema: getProjectInput,
    async handler(args) {
      const { key } = getProjectInput.parse(args);
      return JSON.stringify(await client.getProject(agentId, key));
    },
  };
  const listProjectMembersTool: McpTool = {
    name: 'list_project_members',
    description: '프로젝트 멤버 목록(userId·name·role)을 JSON 으로 반환합니다.',
    inputSchema: listProjectMembersInput,
    async handler(args) {
      const { key } = listProjectMembersInput.parse(args);
      return JSON.stringify(await client.listProjectMembers(agentId, key));
    },
  };

  // #333 M3: 프로젝트 제안 도구 — API 미호출, 사이드카에 제안 객체를 쓰고 ack 반환.
  const proposeCreateProjectTool: McpTool = {
    name: 'propose_create_project',
    description: '프로젝트 생성을 제안합니다. 직접 생성하지 않고 확인 카드용 제안만 만듭니다. summary 에 한 줄 요약(이름·key)을 넣으세요. 승인 시 서버가 생성합니다.',
    inputSchema: proposeCreateProjectInput,
    async handler(args) {
      const { summary, ...params } = proposeCreateProjectInput.parse(args);
      const path = process.env.WORKPLACE_PENDING_ACTION_PATH;
      if (!path) return '확인 플로우가 설정되지 않아 제안을 등록하지 못했습니다.';
      const { writeFileSync } = await import('node:fs');
      writeFileSync(path, JSON.stringify({ actionType: 'project.create_project', summary, params }), 'utf8');
      return '프로젝트 생성 제안을 등록했습니다. 사용자 확인을 기다립니다.';
    },
  };
  const proposeDeleteProjectTool: McpTool = {
    name: 'propose_delete_project',
    description: '프로젝트 삭제(소프트)를 제안합니다. 직접 삭제하지 않고 확인 카드용 제안만 만듭니다. summary 에 어떤 프로젝트인지 한 줄로 넣으세요. 승인 시 서버가 삭제합니다.',
    inputSchema: proposeDeleteProjectInput,
    async handler(args) {
      const { summary, ...params } = proposeDeleteProjectInput.parse(args);
      const path = process.env.WORKPLACE_PENDING_ACTION_PATH;
      if (!path) return '확인 플로우가 설정되지 않아 제안을 등록하지 못했습니다.';
      const { writeFileSync } = await import('node:fs');
      writeFileSync(path, JSON.stringify({ actionType: 'project.delete_project', summary, params }), 'utf8');
      return '프로젝트 삭제 제안을 등록했습니다. 사용자 확인을 기다립니다.';
    },
  };
  const proposeAddProjectMemberTool: McpTool = {
    name: 'propose_add_project_member',
    description: '프로젝트 멤버 추가를 제안합니다. 직접 추가하지 않고 확인 카드용 제안만 만듭니다. summary 에 누구를 어떤 role 로 추가하는지 한 줄로 넣으세요. 승인 시 서버가 추가합니다.',
    inputSchema: proposeAddProjectMemberInput,
    async handler(args) {
      const { summary, ...params } = proposeAddProjectMemberInput.parse(args);
      const path = process.env.WORKPLACE_PENDING_ACTION_PATH;
      if (!path) return '확인 플로우가 설정되지 않아 제안을 등록하지 못했습니다.';
      const { writeFileSync } = await import('node:fs');
      writeFileSync(path, JSON.stringify({ actionType: 'project.add_member', summary, params }), 'utf8');
      return '멤버 추가 제안을 등록했습니다. 사용자 확인을 기다립니다.';
    },
  };

  // #333 M3: 드라이브 읽기 도구(v1 — 쓰기 연기).
  const listDriveSpacesTool: McpTool = {
    name: 'list_drive_spaces',
    description: '내가 접근 가능한 드라이브 스페이스 목록을 JSON 으로 반환합니다.',
    inputSchema: z.object({}),
    async handler() { return JSON.stringify(await client.listMySpaces(agentId)); },
  };
  const listDriveItemsTool: McpTool = {
    name: 'list_drive_items',
    description: '드라이브 스페이스(또는 parentId 하위)의 폴더/파일 목록을 JSON 으로 반환합니다.',
    inputSchema: listDriveItemsInput,
    async handler(args) {
      const { spaceId, parentId } = listDriveItemsInput.parse(args);
      return JSON.stringify(await client.listSpaceItems(agentId, spaceId, parentId));
    },
  };
  const searchDriveTool: McpTool = {
    name: 'search_drive',
    description: '드라이브 스페이스에서 파일/폴더를 이름으로 검색해 JSON 으로 반환합니다.',
    inputSchema: searchDriveInput,
    async handler(args) {
      const { spaceId, q } = searchDriveInput.parse(args);
      return JSON.stringify(await client.searchDrive(agentId, spaceId, q));
    },
  };

  // #333: assistant — 서브에이전트가 상속하는 전 앱 도구 union(M1: 이슈+위키읽기+표시, M2: 캘린더 읽기+제안, M3: 메시징+위키쓰기+메일+드라이브읽기).
  // 도구 경계는 각 서브에이전트 .claude/agents/<name>.md frontmatter 가 강제하므로 union 노출은 안전.
  if (profile === 'assistant') {
    return [
      getIssueDetailTool,
      searchWikiTool,
      getWikiPageTool,
      createWikiPageTool,        // #333 M3: 위키 쓰기(내부)
      updateWikiPageTool,        // #333 M3: 위키 쓰기(내부)
      addCommentTool,
      updateStatusTool,
      unassignSelfTool,
      listEventsTool,
      getEventTool,              // #333 M2: 캘린더 읽기
      proposeCreateEventTool,    // #333 M2: 일정 생성 제안(사이드카 쓰기)
      getChannelMessagesTool,    // #333 M3: 메시징 읽기
      addChannelMessageTool,     // #333 M3: 메시징 쓰기(내부 쓰기 직접 실행)
      listMailTool, getMailTool, proposeSendMailTool, // #333 M3: 메일 읽기 + 발송 제안
      listContactsTool, getExternalContactTool, createExternalContactTool, updateExternalContactTool, proposeDeleteContactTool, // #333 M3: 연락처
      listProjectsTool, getProjectTool, listProjectMembersTool,
      proposeCreateProjectTool, proposeDeleteProjectTool, proposeAddProjectMemberTool, // #333 M3: 프로젝트
      listDriveSpacesTool, listDriveItemsTool, searchDriveTool, // #333 M3: 드라이브 읽기(v1 읽기 전용)
      ...buildShowTools(),
    ];
  }

  // issue 프로파일(기본) — 이슈 읽기/쓰기 + 위키 읽기 그라운딩.
  return [
    getIssueDetailTool,
    searchWikiTool,
    getWikiPageTool,
    addCommentTool,
    updateStatusTool,
    unassignSelfTool,
  ];
}
