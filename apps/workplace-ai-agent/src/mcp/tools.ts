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

// #393/#394: 타임존 오프셋이 없는 naive datetime에 Asia/Seoul(+09:00) 오프셋을 강제로 보정한다.
// haiku가 agent.md 규칙을 무시하고 "2026-06-20T14:00:00" 형태를 내보내는 비결정적 동작을
// 핸들러 레이어에서 결정론적으로 차단한다. Z(UTC)가 있으면 그대로 유지.
// 주의: Zod 4의 z.toJSONSchema 는 transform 을 지원하지 않으므로 스키마가 아닌 핸들러에서 적용.
function normalizeTimezone(val: string): string {
  // 이미 오프셋(+HH:MM 또는 Z)이 있으면 그대로 반환
  if (/[Zz]$/.test(val) || /[+-]\d{2}:\d{2}$/.test(val)) return val;
  // naive datetime → Asia/Seoul 오프셋 추가
  return val + '+09:00';
}

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

// #333 M4: 드라이브 쓰기/삭제 입력.
const createFolderInput = z.object({ spaceId: z.number().int().positive(), parentId: z.number().int().positive().nullable().optional(), name: z.string().min(1).max(255) });
const renameFolderInput = z.object({ folderId: z.number().int().positive(), name: z.string().min(1).max(255) });
const moveFolderInput = z.object({ folderId: z.number().int().positive(), targetParentId: z.number().int().positive().nullable().optional() });
const moveFileInput = z.object({ fileId: z.number().int().positive(), targetFolderId: z.number().int().positive().nullable().optional() });
const proposeDeleteFileInput = z.object({ summary: z.string().min(1), id: z.number().int().positive() });
const proposeDeleteFolderInput = z.object({ summary: z.string().min(1), id: z.number().int().positive() });

// #333 M4: 메일 계정 목록 + 수동 동기화 입력.
const syncMailInput = z.object({ accountId: z.number().int().positive() });

// #333 M3: 메일 읽기 입력.
const listMailInput = z.object({
  accountId: z.number().int().positive(),
  folder: z.string().default('INBOX'),
  query: z.string().optional(),
  // #466: true 면 안 읽은(미읽음) 메일만. "안 읽은/미읽음" 요청에 사용.
  unreadOnly: z.boolean().optional(),
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

// #333 M4: 일정 수정 제안 입력 — CalendarEventRequest 미러 + id/scope/occurrenceDate(경로/쿼리 상당) + summary.
// #402: attendees 추가 — 참석자 이메일 목록(선택). 스키마에 없으면 haiku가 params에서 생략함(create와 동일).
const proposeUpdateEventInput = z.object({
  summary: z.string().min(1),
  id: z.number().int().positive(),
  scope: z.enum(['THIS', 'THIS_AND_FOLLOWING', 'ALL']).default('ALL'),
  occurrenceDate: z.string().optional(), // ISO-8601, 반복 일정의 대상 회차
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  startsAt: z.string(),
  endsAt: z.string(),
  allDay: z.boolean().optional(),
  location: z.string().max(200).optional(),
  color: z.string().max(32).optional(),
  reminderMinutes: z.number().int().min(0).optional(),
  recurrenceRule: z.string().max(500).optional(),
  attendees: z.array(z.string().email()).optional(), // #402: 참석자 이메일 목록(수정 시에도 필수)
});
// #333 M4: 일정 삭제 제안 입력 — id + 반복 scope/occurrenceDate + summary.
const proposeDeleteEventInput = z.object({
  summary: z.string().min(1),
  id: z.number().int().positive(),
  scope: z.enum(['THIS', 'THIS_AND_FOLLOWING', 'ALL']).default('ALL'),
  occurrenceDate: z.string().optional(),
});

// #333 M2: 일정 생성 제안 입력 — CalendarEventRequest 와 1:1(서버 매핑 단순화) + summary(카드 본문).
// #393: attendees 추가 — 참석자 이메일 목록(선택). 스키마에 없으면 haiku가 params에서 생략함.
// #394: startsAt/endsAt 타임존 보정은 핸들러에서 normalizeTimezone 으로 처리(Zod transform 불가).
const proposeCreateEventInput = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  startsAt: z.string().min(1),   // ISO-8601, 핸들러에서 타임존 보정
  endsAt: z.string().min(1),
  allDay: z.boolean().default(false),
  location: z.string().max(200).optional(),
  reminderMinutes: z.number().int().min(0).optional(),
  recurrenceRule: z.string().max(500).optional(),
  attendees: z.array(z.string().email()).optional(), // #393: 참석자 이메일 목록
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
// #350: 채널 목록/탐색 도구 입력 — channelId 를 모를 때 채널 이름 → id 해석용.
const discoverChannelsInput = z.object({ q: z.string().min(1) });

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
// #403: priority 는 반드시 영어 대문자 열거값만 허용 — 한국어("높음" 등) 비결정적 입력 차단.
// #371: show_issue_list(표시 지시)와 list_issues(데이터 조회)가 동일 필터 집합을 공유하도록 shape 추출.
const issueListFilterShape = {
  projectKey: z.string().optional(),
  status: z.string().optional(),
  priority: z.array(z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'])).optional(),
  label: z.string().optional(),
  type: z.string().optional(),
  dueFrom: z.string().optional(),
  dueTo: z.string().optional(),
  q: z.string().optional(),
  blocked: z.boolean().optional(),
  topLevel: z.boolean().optional(),
  assignee: z.string().optional(), // 'me' | '<id>'
  size: z.number().int().positive().optional(),
};
const issueListParams = z.object(issueListFilterShape).optional();
// #371: list_issues 도구 입력 — 표시 지시(params/layout 봉투)와 달리 필터를 직접 받는 데이터 조회 도구.
const listIssuesInput = z.object(issueListFilterShape);
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
// #431: 메일 목록 표시 지시 — 데이터(20행 표)를 LLM 이 토큰으로 생성하던 비용을 위젯 렌더로 대체.
// accountId 미지정 시 프론트가 기본 계정을 해석한다. folder 미지정 시 INBOX. limit 미지정 시 20.
const showMailListInput = z.object({
  params: z
    .object({
      accountId: z.number().int().positive().optional(),
      folder: z.string().optional(),
      query: z.string().optional(),
      // #469: true 면 안 읽은 메일만 표시. "안 읽은 메일" 목록 요청에 사용(query 검색어 대신).
      unreadOnly: z.boolean().optional(),
      limit: z.number().int().positive().optional(),
    })
    .optional(),
  layout: layoutSchema,
});

// #460 Layer2: 도메인 표시 위젯 입력 — 핸들러는 데이터를 반환하지 않으므로(displayed) 프론트가 params 로 fetch.
const showCalendarInput = z.object({
  params: z.object({ from: z.string().optional(), to: z.string().optional() }).optional(),
  layout: layoutSchema,
});
const showEventInput = z.object({
  params: z.object({ eventId: z.number().int().positive() }),
  layout: layoutSchema,
});
const showChannelsInput = z.object({ params: z.object({}).optional(), layout: layoutSchema });
const showWikiInput = z.object({
  params: z.object({ spaceId: z.number().int().positive().optional(), query: z.string().optional() }).optional(),
  layout: layoutSchema,
});
const showWikiPageInput = z.object({
  params: z.object({ pageId: z.number().int().positive() }),
  layout: layoutSchema,
});
const showContactsInput = z.object({
  params: z.object({
    search: z.string().optional(), type: z.string().optional(),
    org: z.string().optional(), title: z.string().optional(),
  }).optional(),
  layout: layoutSchema,
});
const showContactInput = z.object({
  params: z.object({ contactId: z.number().int().positive() }),
  layout: layoutSchema,
});
const showProjectsInput = z.object({ params: z.object({}).optional(), layout: layoutSchema });
const showProjectInput = z.object({
  params: z.object({ projectKey: z.string().min(1) }),
  layout: layoutSchema,
});
const showDriveInput = z.object({
  params: z.object({
    spaceId: z.number().int().positive().optional(),
    folderId: z.number().int().positive().optional(),
  }).optional(),
  layout: layoutSchema,
});

// #333: assistant 프로파일 추가 — 전 앱 도구 union(M1).
export type McpProfile = 'issue' | 'chat' | 'home' | 'messaging' | 'assistant';

// L3 위임: 이슈 생성 제안 도구 입력 스키마.
// channelId·위임자·parent 는 코드가 env 에서 스탬프 — AI 입력에서 제외(가스라이팅 방지).
const proposeCreateIssueInput = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(10000).optional(),
  priority: z.enum(['LOW', 'MID', 'HIGH']).optional(),
});

// profile 기본값 'issue' — 이슈 핸들러는 기존 4 도구, chat 핸들러는 읽기+chat 쓰기 도구만.
export function buildTools(
  client: WorkplaceApiClient,
  agentId: number,
  profile: McpProfile = 'issue',
  // 스레드 mirror: 트리거가 스레드 안일 때 {channelId, parentMessageId}. 이 채널에 add_channel_message 하면
  // 그 스레드에 답이 들어간다(인라인 멘션이면 undefined — 현행 인라인 동작).
  threadBinding?: { channelId: number; parentMessageId: number },
  // L3 위임: 트리거 actor(위임자)+채널+(스레드)parent. 있으면 propose_create_issue 노출.
  delegationContext?: { actorId: number; channelId: number; parentMessageId?: number },
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

  // #371: 이슈 목록 조회 도구 — assistant union(서브에이전트 issue-agent 가 frontmatter 로 선택).
  // show_issue_list(표시 지시, 데이터 미반환)와 달리 실제 이슈 목록 데이터를 JSON 으로 반환한다.
  // assignee 미지정 시 클라이언트가 'me' 로 조회하므로 "내 담당 이슈 목록"을 한 번에 가져온다.
  const listIssuesTool: McpTool = {
    name: 'list_issues',
    description:
      '이슈 목록을 조회해 JSON 배열로 반환합니다. assignee 를 생략하면 내 담당("me") 이슈를, status/priority/projectKey/q/dueTo 등으로 좁힙니다. 각 항목은 issueKey·title·status·priority·assignees·dueDate 를 포함하며, 상세가 필요하면 issueKey 로 get_issue_detail 을 호출하세요.',
    inputSchema: listIssuesInput,
    async handler(args) {
      const params = listIssuesInput.parse(args);
      return JSON.stringify(await client.listIssues(agentId, params));
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
    // #433: 단일 이벤트 처리 중 add_chat_message 중복 호출 방지.
    // MCP 서버는 CLI run 당 하나의 프로세스로 실행되어 buildTools 클로저가 run 단위로 격리된다.
    // 시스템 프롬프트 지시를 AI가 무시하는 비결정적 동작을 코드 레벨에서 결정론적으로 차단한다.
    let addChatMessageCalled = false;
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
          // #433: 2번째 이후 호출 차단 — 중복 응답 방지.
          if (addChatMessageCalled) {
            console.error('[mcp:add_chat_message] 중복 호출 감지 — 차단됨 (threadId 참고: args)');
            return '이미 이 요청에 대한 답변을 등록했습니다. 추가 호출은 무시됩니다.';
          }
          addChatMessageCalled = true;
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
      // mirror: 바인딩된 트리거 채널에 한해 그 스레드 parent 로 답(다른 채널은 인라인).
      const parentMessageId =
        threadBinding && threadBinding.channelId === channelId
          ? threadBinding.parentMessageId
          : undefined;
      await client.addChannelMessage(agentId, channelId, body, parentMessageId);
      return 'ok';
    },
  };

  // #350: 채널 목록/탐색 도구 — channelId 를 모를 때 채널 이름 → id 해석 전용 읽기 도구.
  // add_channel_message / get_channel_messages 호출 전 channelId 를 확보하는 데 사용한다.
  const listChannelsTool: McpTool = {
    name: 'list_channels',
    description:
      '내가 속한 채널·DM 목록을 JSON 배열로 반환합니다(id·name·kind·visibility 포함). 채널 이름만 알 때 channelId 를 확보한 뒤 get_channel_messages / add_channel_message 에 사용하세요.',
    inputSchema: z.object({}),
    async handler() {
      return JSON.stringify(await client.listChannels(agentId));
    },
  };
  const discoverChannelsTool: McpTool = {
    name: 'discover_channels',
    description:
      '공개 채널을 이름·키워드로 검색해 JSON 배열로 반환합니다(id·name·kind 포함). list_channels 에 없는 공개 채널을 찾아 channelId 를 확보한 뒤 메시지 조회/작성에 사용하세요.',
    inputSchema: discoverChannelsInput,
    async handler(args) {
      const { q } = discoverChannelsInput.parse(args);
      return JSON.stringify(await client.discoverChannels(agentId, q));
    },
  };

  if (profile === 'messaging') {
    const tools: McpTool[] = [getChannelMessagesTool, addChannelMessageTool, listChannelsTool, discoverChannelsTool];
    // L3 위임: 위임 컨텍스트가 있을 때만 노출. channelId·위임자·parent 는 코드가 스탬프(AI 입력 아님).
    if (delegationContext) {
      const dc = delegationContext;
      let proposed = false;
      tools.push({
        name: 'propose_create_issue',
        description:
          '사용자가 무언가를 이슈로 만들어 당신에게 맡기려 할 때(위임) 호출합니다. 이슈 생성 "제안 카드"를 그 자리에 올립니다(실제 생성은 위임자의 승인 후). title·body·priority 만 정하세요 — 프로젝트·담당·위치는 시스템이 정합니다. 호출 시 add_channel_message 는 호출하지 마세요(제안 카드가 곧 응답).',
        inputSchema: proposeCreateIssueInput,
        async handler(args) {
          // guard: 이미 성공적으로 제안을 등록한 경우 재호출 차단.
          if (proposed) return '이미 이 요청에 대한 제안을 등록했습니다.';
          const { title, body, priority } = proposeCreateIssueInput.parse(args);
          try {
            await client.proposeCreateIssue(agentId, dc.channelId, {
              title, body, priority,
              proposedByUserId: dc.actorId,
              parentMessageId: dc.parentMessageId,
            });
          } catch (e) {
            // 실패 시 guard 를 세우지 않아 재시도 가능. 채팅에 읽을 수 있는 오류 반환.
            return `이슈 제안 등록에 실패했습니다: ${e instanceof Error ? e.message : String(e)}`;
          }
          // await 성공 후에만 guard 설정 — 실패 시 재시도 허용.
          proposed = true;
          return '제안 카드를 올렸습니다. 위임자의 승인을 기다립니다.';
        },
      });
    }
    return tools;
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
      {
        // #431: 메일 목록 단순 조회는 mail-agent 위임(표 텍스트 생성, 느림) 대신 이 위젯으로 직접 표시.
        name: 'show_mail_list',
        description:
          '받은편지함 등 메일 목록을 화면에 표시합니다. folder(기본 INBOX)·query·limit(기본 20)로 좁힙니다. 안 읽은 메일만 표시하려면 query 에 "is:unread" 같은 검색어를 쓰지 말고 params.unreadOnly:true 를 사용하세요. 단순 목록 조회 전용 — 요약·검색·발송·특정 메일 작업은 mail-agent 에 위임하세요.',
        inputSchema: showMailListInput,
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
  // #378: unassign_self 실패 시 고정 안내 문구를 반환해 LLM 재해석을 차단한다.
  // 동시에 WORKPLACE_UNASSIGN_ERROR_PATH 사이드카에 오류를 기록해,
  // run-ai-compose 가 최종 메시지를 결정론적으로 override 한다(이중 방어).
  // raw HTTP 오류 코드(예: "status code 405")를 사용자에게 노출하지 않도록
  // canonical 메시지에는 err 를 포함하지 않고 사이드카의 error 필드에만 남긴다.
  const UNASSIGN_CANONICAL = () =>
    '담당자 해제 요청을 처리하지 못했습니다. 이슈 화면에서 직접 변경해주세요.';
  const unassignSelfTool: McpTool = {
    name: 'unassign_self',
    description: '자기 자신을 이슈 담당자에서 제외합니다. 작업 완료·반려 시 사용합니다.',
    inputSchema: issueKey,
    async handler(args) {
      const { issueKey: k } = issueKey.parse(args);
      try {
        await client.unassignSelf(agentId, k);
        // #406: 성공 사이드카 기록 — run-ai-compose 가 "이미 처리됨" 여부 판단에 사용.
        // 에러 사이드카와 대칭 구조: 성공 시 WORKPLACE_UNASSIGN_SUCCESS_PATH 에 이슈 키를 씀.
        const successPath = process.env.WORKPLACE_UNASSIGN_SUCCESS_PATH;
        if (successPath) {
          const { writeFileSync } = await import('node:fs');
          try {
            writeFileSync(successPath, JSON.stringify({ issueKey: k }), 'utf8');
          } catch {
            // 사이드카 쓰기 실패 — 무시(기능에는 영향 없음)
          }
        }
        return 'ok';
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        const canonical = UNASSIGN_CANONICAL();
        // 사이드카에 오류 기록 — run-ai-compose 가 최종 응답 override 에 사용.
        const sidecarPath = process.env.WORKPLACE_UNASSIGN_ERROR_PATH;
        if (sidecarPath) {
          const { writeFileSync } = await import('node:fs');
          try {
            writeFileSync(sidecarPath, JSON.stringify({ error: errMsg, canonical }), 'utf8');
          } catch {
            // 사이드카 쓰기 실패 — 무시(2차 방어선인 도구 반환 문구로 커버)
          }
        }
        // LLM 에게 재해석 없이 그대로 전달할 고정 문구 반환.
        return canonical;
      }
    },
  };

  // 7b: home 컴포저 — 표시 지시만(데이터 조회 X).
  if (profile === 'home') {
    return buildShowTools();
  }

  // #333 M2: 캘린더 읽기 도구 — assistant 프로파일 전용(일정 충돌 확인·요약).
  // #394: from/to 에 타임존 오프셋이 없으면 normalizeTimezone 으로 +09:00 보정.
  //       haiku 가 naive datetime 으로 호출 시 API 가 OffsetDateTime 형식 오류를 반환하는 것을 차단.
  const listEventsTool: McpTool = {
    name: 'list_events',
    description: '[from,to) 기간(ISO-8601)의 내 일정 목록을 JSON 으로 반환합니다. 일정 충돌 확인·요약에 사용하세요.',
    inputSchema: listEventsInput,
    async handler(args) {
      const parsed = listEventsInput.parse(args);
      const from = normalizeTimezone(parsed.from);
      const to = normalizeTimezone(parsed.to);
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

  // #351: propose 공통 — 사이드카에 제안을 NDJSON(줄당 1제안)으로 append.
  // 한 서브에이전트가 동종 비가역 작업을 여러 건 제안하면 run-ai-compose 가 줄 단위로 읽어
  // pending_action 배열로 발행한다. (이전 #333 M4 단일-제안 하드가드는 #351 로 제거.)
  async function writeProposal(
    actionType: string,
    summary: string,
    params: Record<string, unknown>,
  ): Promise<string> {
    const sidecarPath = process.env.WORKPLACE_PENDING_ACTION_PATH;
    if (!sidecarPath) {
      return '확인 플로우가 설정되지 않아 제안을 등록하지 못했습니다.';
    }
    const { appendFileSync } = await import('node:fs');
    // NDJSON: 한 줄당 제안 1건. MCP 서버는 단일 stdio 프로세스·순차 도구호출이라 append 경쟁 없음.
    appendFileSync(sidecarPath, JSON.stringify({ actionType, summary, params }) + '\n', 'utf8');
    return '제안을 등록했습니다. 사용자 확인을 기다립니다.';
  }

  // #333 M2: 일정 생성 제안 도구 — API 미호출, 사이드카에 제안 객체를 쓰고 ack 반환.
  // #393: attendees 파라미터를 명시하지 않으면 스키마에 없는 것으로 간주해 haiku가 생략함.
  // #394: startsAt/endsAt 타임존 보정 — 핸들러에서 normalizeTimezone 으로 처리.
  // #395: 새 일정 시간대 충돌을 서버에서 결정론적으로 확인한다. agent.md 는 propose 전 list_events 를
  //       MUST 로 규정하지만 모델이 비결정적으로 그 단계를 건너뛰는 회귀가 반복되므로, 핸들러가
  //       스스로 listEvents 로 겹치는 일정을 조회해 제안에 embed 한다(모델 호출에 의존하지 않음).
  const proposeCreateEventTool: McpTool = {
    name: 'propose_create_event',
    description:
      '일정 생성을 제안합니다. 직접 생성하지 않고 사용자 확인 카드용 제안만 만듭니다. summary 에 사람이 읽을 한 줄 요약(일시·제목)을 넣으세요. 참석자가 있으면 attendees 배열(이메일 문자열 목록)을 반드시 포함하세요. startsAt/endsAt 은 반드시 타임존 오프셋 포함 ISO-8601(예: 2026-06-20T14:00:00+09:00)로 채우세요. 승인 시 서버가 실제로 생성합니다.',
    inputSchema: proposeCreateEventInput,
    async handler(args) {
      const { summary, ...params } = proposeCreateEventInput.parse(args);
      // #394: startsAt/endsAt 에 타임존 오프셋이 없으면 +09:00 보정.
      params.startsAt = normalizeTimezone(params.startsAt as string);
      params.endsAt = normalizeTimezone(params.endsAt as string);

      // #395: 보정된 시간대 [startsAt, endsAt) 에 겹치는 기존 일정을 서버에서 조회한다.
      //       listEvents 는 [from,to) 기간 일정을 반환하므로(=window 와 겹치는 일정), 반환 목록을
      //       그대로 충돌로 본다. 조회 실패(네트워크/권한 등)는 fail-open — 충돌확인 실패가 제안 자체를
      //       막으면 안 되므로 try/catch 로 감싸고 실패 시 conflicts 없이 정상 진행한다.
      // params 는 zod 추론 타입이라 index signature 가 없어 새 키(conflicts) 할당이 타입 에러가 된다.
      // 충돌을 담을 수 있도록 Record 로 복사해 제안 params 를 구성한다.
      let finalSummary = summary;
      const proposalParams: Record<string, unknown> = { ...params };
      try {
        const overlapping = await client.listEvents(
          agentId,
          params.startsAt as string,
          params.endsAt as string,
        );
        if (overlapping.length > 0) {
          // 충돌 정보를 제안 params 에 구조화해 담는다(확인 실행기/카드가 활용).
          proposalParams.conflicts = overlapping.map((e) => ({
            id: e.id,
            title: e.title,
            startsAt: e.startsAt,
            endsAt: e.endsAt,
          }));
          // summary 에 충돌 경고 한 줄을 덧붙인다 — 사용자 확인 카드에 노출되는 것은 summary 이므로
          // 카드에서 충돌을 알 수 있게 하려면 (ack 가 아니라) summary 에 넣어야 한다.
          const titles = overlapping.map((e) => e.title).join(', ');
          finalSummary = `${summary}\n[충돌] 같은 시간대에 기존 일정 ${overlapping.length}건이 있습니다: ${titles}`;
        }
      } catch {
        // fail-open: 충돌 조회 실패는 무시하고 충돌 정보 없이 제안을 진행한다.
      }

      return await writeProposal('calendar.create_event', finalSummary, proposalParams);
    },
  };

  // #397: 일정 존재 여부를 서버에서 직접 확인한다. haiku가 get_event 도구 호출 없이 환각으로
  // "존재하지 않는다"고 응답하는 비결정적 동작을 제안 핸들러 안에서 결정론적으로 차단한다.
  async function verifyEventExists(id: number): Promise<string | null> {
    try {
      await client.getEvent(agentId, id);
      return null; // 존재함 — 제안 진행 가능
    } catch {
      return `해당 일정(id: ${id})을 찾을 수 없습니다. 일정 id 를 다시 확인해주세요.`;
    }
  }

  // #333 M4: 일정 수정 제안 도구 — API 미호출, 사이드카에 수정 제안을 쓰고 ack 반환.
  // scope: THIS=이 회차, THIS_AND_FOLLOWING=이후 전체, ALL=시리즈 전체. occurrenceDate=대상 회차 시작시각.
  // #397: 수정 전 get_event 로 존재 여부 서버 확인 — haiku 환각(no tool call, "not found") 결정론적 차단.
  const proposeUpdateEventTool: McpTool = {
    name: 'propose_update_event',
    description:
      '일정 수정을 제안합니다. 직접 수정하지 않고 사용자 확인 카드용 제안만 만듭니다. summary 에 사람이 읽을 한 줄 요약을 넣으세요. 참석자를 추가/변경할 때는 attendees 배열(이메일 문자열 목록)을 반드시 포함하세요. 반복 일정은 scope 로 범위를 지정합니다(THIS=이 회차, THIS_AND_FOLLOWING=이후 전체, ALL=시리즈 전체). occurrenceDate 는 대상 회차 시작시각(ISO-8601). 승인 시 서버가 실제로 수정합니다.',
    inputSchema: proposeUpdateEventInput,
    async handler(args) {
      const { summary, ...params } = proposeUpdateEventInput.parse(args);
      // #397: 제안 전 존재 여부 확인 — 존재하지 않으면 에러 메시지 반환, 환각 차단.
      const notFound = await verifyEventExists(params.id);
      if (notFound) return notFound;
      return await writeProposal('calendar.update_event', summary, params);
    },
  };

  // #333 M4: 일정 삭제 제안 도구 — API 미호출, 사이드카에 삭제 제안을 쓰고 ack 반환.
  // scope/occurrenceDate 는 수정 제안과 동일 의미. 승인 시 서버가 실제로 삭제합니다.
  // #397: 삭제 전 get_event 로 존재 여부 서버 확인 — haiku 환각(no tool call, "not found") 결정론적 차단.
  const proposeDeleteEventTool: McpTool = {
    name: 'propose_delete_event',
    description:
      '일정 삭제를 제안합니다. 직접 삭제하지 않고 사용자 확인 카드용 제안만 만듭니다. summary 에 사람이 읽을 한 줄 요약을 넣으세요. 반복 일정은 scope 로 범위를 지정합니다(THIS=이 회차, THIS_AND_FOLLOWING=이후 전체, ALL=시리즈 전체). occurrenceDate 는 대상 회차 시작시각(ISO-8601). 승인 시 서버가 실제로 삭제합니다.',
    inputSchema: proposeDeleteEventInput,
    async handler(args) {
      const { summary, ...params } = proposeDeleteEventInput.parse(args);
      // #397: 제안 전 존재 여부 확인 — 존재하지 않으면 에러 메시지 반환, 환각 차단.
      const notFound = await verifyEventExists(params.id);
      if (notFound) return notFound;
      return await writeProposal('calendar.delete_event', summary, params);
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
    description:
      '메일 계정의 폴더 메시지 목록을 JSON 으로 반환합니다. folder 기본 INBOX, query 로 내용 검색(제목/발신/스니펫). ' +
      '안 읽은 메일만 보려면 query 에 "is:unread" 같은 검색어를 쓰지 말고 unreadOnly:true 를 사용하세요. ' +
      'accountId 는 사용자의 메일 계정 id 입니다.',
    inputSchema: listMailInput,
    async handler(args) {
      const { accountId, folder, query, unreadOnly, limit } = listMailInput.parse(args);
      return JSON.stringify(await client.listMail(agentId, accountId, folder, query, unreadOnly, limit));
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
      return await writeProposal('mail.send', summary, params);
    },
  };

  // #333 M4: 메일 계정 목록 + 수동 동기화 도구 — assistant 프로파일 전용.
  // list_mail_accounts: accountId 가 없을 때 먼저 호출해 계정 식별자를 확보한다.
  const listMailAccountsTool: McpTool = {
    name: 'list_mail_accounts',
    description:
      '사용자의 메일 계정 목록을 JSON 으로 반환합니다. list_mail 또는 propose_send_mail 호출 전 accountId 를 모를 때 먼저 호출해 계정 id 를 확인하세요.',
    inputSchema: z.object({}),
    async handler(_args) {
      return JSON.stringify(await client.listMailAccounts(agentId));
    },
  };
  // sync_mail: 서버 소유권 검증 통과 — 호출자 계정만 동기화 가능(직접 실행 안전).
  const syncMailTool: McpTool = {
    name: 'sync_mail',
    description:
      '지정 메일 계정의 새 메일을 수동으로 가져옵니다(받은편지함 동기화). accountId 는 list_mail_accounts 로 확인하세요.',
    inputSchema: syncMailInput,
    async handler(args) {
      const { accountId } = syncMailInput.parse(args);
      await client.syncMail(agentId, accountId);
      return '동기화를 완료했습니다.';
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
      return await writeProposal('contacts.delete_contact', summary, params);
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
      return await writeProposal('project.create_project', summary, params);
    },
  };
  const proposeDeleteProjectTool: McpTool = {
    name: 'propose_delete_project',
    description: '프로젝트 삭제(소프트)를 제안합니다. 직접 삭제하지 않고 확인 카드용 제안만 만듭니다. summary 에 어떤 프로젝트인지 한 줄로 넣으세요. 승인 시 서버가 삭제합니다.',
    inputSchema: proposeDeleteProjectInput,
    async handler(args) {
      const { summary, ...params } = proposeDeleteProjectInput.parse(args);
      return await writeProposal('project.delete_project', summary, params);
    },
  };
  const proposeAddProjectMemberTool: McpTool = {
    name: 'propose_add_project_member',
    description: '프로젝트 멤버 추가를 제안합니다. 직접 추가하지 않고 확인 카드용 제안만 만듭니다. summary 에 누구를 어떤 role 로 추가하는지 한 줄로 넣으세요. 승인 시 서버가 추가합니다.',
    inputSchema: proposeAddProjectMemberInput,
    async handler(args) {
      const { summary, ...params } = proposeAddProjectMemberInput.parse(args);
      return await writeProposal('project.add_member', summary, params);
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

  // #333 M4: 드라이브 폴더/파일 쓰기 도구 — 비가역성이 낮은 정리 작업(폴더 생성·이름변경·이동)은 직접 실행.
  const createFolderTool: McpTool = {
    name: 'create_folder',
    description: '드라이브 스페이스에 새 폴더를 생성합니다. parentId 를 주면 그 하위에 만들고, 생략하면 스페이스 루트에 생성합니다. 생성된 폴더를 JSON 으로 반환합니다.',
    inputSchema: createFolderInput,
    async handler(args) {
      const { spaceId, parentId, name } = createFolderInput.parse(args);
      return JSON.stringify(await client.createFolder(agentId, spaceId, parentId ?? null, name));
    },
  };
  const renameFolderTool: McpTool = {
    name: 'rename_folder',
    description: '폴더 이름을 변경합니다. 변경된 폴더를 JSON 으로 반환합니다.',
    inputSchema: renameFolderInput,
    async handler(args) {
      const { folderId, name } = renameFolderInput.parse(args);
      return JSON.stringify(await client.renameFolder(agentId, folderId, name));
    },
  };
  const moveFolderTool: McpTool = {
    name: 'move_folder',
    description: '폴더를 다른 상위 폴더로 이동합니다. targetParentId 를 생략하면 스페이스 루트로 이동합니다.',
    inputSchema: moveFolderInput,
    async handler(args) {
      const { folderId, targetParentId } = moveFolderInput.parse(args);
      await client.moveFolder(agentId, folderId, targetParentId ?? null);
      return 'ok';
    },
  };
  const moveFileTool: McpTool = {
    name: 'move_file',
    description: '파일을 다른 폴더로 이동합니다. targetFolderId 를 생략하면 스페이스 루트로 이동합니다.',
    inputSchema: moveFileInput,
    async handler(args) {
      const { fileId, targetFolderId } = moveFileInput.parse(args);
      await client.moveFile(agentId, fileId, targetFolderId ?? null);
      return 'ok';
    },
  };

  // #333 M4: 드라이브 삭제 제안 도구 — 파일/폴더 삭제는 soft-delete 이나 비가역 작업으로 분류되어 confirm 필요.
  const proposeDeleteFileTool: McpTool = {
    name: 'propose_delete_file',
    description: '파일 삭제를 제안합니다. 직접 삭제하지 않고 사용자 확인 카드용 제안만 만듭니다. 삭제는 복구 가능한 soft-delete 이지만 확인이 필요합니다. summary 에 어떤 파일을 지우는지 한 줄로 넣으세요. 승인 시 서버가 삭제합니다.',
    inputSchema: proposeDeleteFileInput,
    async handler(args) {
      const { summary, ...params } = proposeDeleteFileInput.parse(args);
      return await writeProposal('drive.delete_file', summary, params);
    },
  };
  const proposeDeleteFolderTool: McpTool = {
    name: 'propose_delete_folder',
    description: '폴더 삭제를 제안합니다. 직접 삭제하지 않고 사용자 확인 카드용 제안만 만듭니다. 삭제는 복구 가능한 soft-delete 이지만 하위 파일·폴더가 포함될 수 있어 확인이 필요합니다. summary 에 어떤 폴더를 지우는지 한 줄로 넣으세요. 승인 시 서버가 삭제합니다.',
    inputSchema: proposeDeleteFolderInput,
    async handler(args) {
      const { summary, ...params } = proposeDeleteFolderInput.parse(args);
      return await writeProposal('drive.delete_folder', summary, params);
    },
  };

  // #381: 서브에이전트 최종 답변 제출 도구 — 위임된 서브에이전트가 작업을 마치고 사용자에게 보여줄 최종 답변을 제출한다.
  // Agent tool_result 는 stream-json 에서 collapsed(축약) 되어 추출 불가하므로(run-ai-compose 주석),
  // 서브에이전트가 직접 WORKPLACE_SUBAGENT_RESPONSE_PATH 사이드카에 답을 기록하고 run-ai-compose 가 권위 답으로 읽는다.
  // first-write-guard: 첫 호출 답을 보존(중복 호출 시 덮지 않음).
  const submitResponseTool: McpTool = {
    name: 'submit_response',
    description:
      '작업을 마치고 사용자에게 보여줄 최종 답변을 제출합니다. 서브에이전트는 작업 완료 후 반드시 이 도구를 호출해 답변을 제출해야 합니다. 자유 텍스트로 끝내지 마세요. text 에 사용자에게 보여줄 한국어 최종 답변을 넣습니다.',
    inputSchema: z.object({ text: z.string().min(1) }),
    async handler(args) {
      const { text } = z.object({ text: z.string().min(1) }).parse(args);
      const sidecarPath = process.env.WORKPLACE_SUBAGENT_RESPONSE_PATH;
      if (!sidecarPath) {
        return '답변을 제출했습니다.';
      }
      const { existsSync, writeFileSync } = await import('node:fs');
      if (existsSync(sidecarPath)) {
        return '답변을 제출했습니다.';
      }
      writeFileSync(sidecarPath, JSON.stringify({ text }), 'utf8');
      return '답변을 제출했습니다.';
    },
  };

  // #333: assistant — 서브에이전트가 상속하는 전 앱 도구 union(M1: 이슈+위키읽기+표시, M2: 캘린더 읽기+제안, M3: 메시징+위키쓰기+메일+드라이브읽기, M4: 드라이브쓰기+삭제제안).
  // 도구 경계는 각 서브에이전트 .claude/agents/<name>.md frontmatter 가 강제하므로 union 노출은 안전.
  if (profile === 'assistant') {
    return [
      getIssueDetailTool,
      listIssuesTool,            // #371: 이슈 목록 조회(내 담당/필터) — issue-agent 위임용
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
      proposeUpdateEventTool, proposeDeleteEventTool, // #333 M4: 일정 수정/삭제 제안
      getChannelMessagesTool,    // #333 M3: 메시징 읽기
      addChannelMessageTool,     // #333 M3: 메시징 쓰기(내부 쓰기 직접 실행)
      listChannelsTool, discoverChannelsTool, // #350: 채널 목록/탐색(이름→channelId 해석)
      listMailTool, getMailTool, proposeSendMailTool, // #333 M3: 메일 읽기 + 발송 제안
      listMailAccountsTool, syncMailTool, // #333 M4: 메일 계정 목록 + 수동 동기화
      listContactsTool, getExternalContactTool, createExternalContactTool, updateExternalContactTool, proposeDeleteContactTool, // #333 M3: 연락처
      listProjectsTool, getProjectTool, listProjectMembersTool,
      proposeCreateProjectTool, proposeDeleteProjectTool, proposeAddProjectMemberTool, // #333 M3: 프로젝트
      listDriveSpacesTool, listDriveItemsTool, searchDriveTool, // #333 M3: 드라이브 읽기
      createFolderTool, renameFolderTool, moveFolderTool, moveFileTool, // #333 M4: 드라이브 쓰기(직접 실행)
      proposeDeleteFileTool, proposeDeleteFolderTool, // #333 M4: 드라이브 삭제 제안(confirm 필요)
      submitResponseTool,        // #381: 서브에이전트 전용 — 최종 답변 구조화 제출(사이드카 기록)
      ...buildShowTools(),
      // #460 Layer2: 도메인 단순 조회 표시 위젯 — 위임(서브에이전트 nested loop, 느림) 대신 직접 표시.
      // buildShowTools() 내부 displayed 와 동일 시맨틱 — 데이터 미반환, 프론트가 params 로 fetch.
      ...((): McpTool[] => {
        const displayed = async () => JSON.stringify({ displayed: true });
        return [
      { name: 'show_calendar', description: '지정 기간(기본 오늘)의 내 일정 목록을 화면에 표시합니다. 일정 조회/확인 요청에 사용. 생성·수정·삭제는 calendar-agent 에 위임.', inputSchema: showCalendarInput, handler: displayed },
      { name: 'show_event', description: '단일 일정 상세(eventId 지정)를 화면에 표시합니다. eventId 를 모르면 먼저 list_events 로 확보하세요.', inputSchema: showEventInput, handler: displayed },
      { name: 'show_channels', description: '내가 속한 채널·DM 목록을 화면에 표시합니다. 채널 목록/확인 요청에 사용.', inputSchema: showChannelsInput, handler: displayed },
      { name: 'show_wiki', description: '위키 페이지 목록/검색 결과를 화면에 표시합니다. query 로 검색, spaceId 로 특정 스페이스 트리.', inputSchema: showWikiInput, handler: displayed },
      { name: 'show_wiki_page', description: '단일 위키 페이지 본문(pageId 지정)을 화면에 표시합니다. pageId 를 모르면 먼저 search_wiki 로 확보하세요.', inputSchema: showWikiPageInput, handler: displayed },
      { name: 'show_contacts', description: '연락처 목록을 화면에 표시합니다. search/org/title/type 로 좁힙니다. 단순 조회 전용 — 생성·수정·삭제는 contacts-agent 위임.', inputSchema: showContactsInput, handler: displayed },
      { name: 'show_contact', description: '단일 연락처 상세(contactId 지정)를 화면에 표시합니다.', inputSchema: showContactInput, handler: displayed },
      { name: 'show_projects', description: '프로젝트 목록을 화면에 표시합니다. 단순 조회 전용 — 생성·삭제·멤버추가는 project-agent 위임.', inputSchema: showProjectsInput, handler: displayed },
      { name: 'show_project', description: '단일 프로젝트 상세·멤버(projectKey 지정)를 화면에 표시합니다.', inputSchema: showProjectInput, handler: displayed },
      { name: 'show_drive', description: '드라이브 스페이스/폴더의 파일·폴더 목록을 화면에 표시합니다. spaceId/folderId 로 좁힙니다. 단순 조회 전용 — 이동·삭제는 drive-agent 위임.', inputSchema: showDriveInput, handler: displayed },
        ];
      })(),
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
